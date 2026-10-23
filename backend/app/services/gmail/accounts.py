"""
Gmail connection lifecycle: authorize, complete (callback), disconnect.

Security properties enforced here:
- The OAuth state is random, single use, short lived, stored hashed and bound to (organization, user). The callback has
  no bearer token, so the organization and user come ONLY from that row; nothing in the callback request is trusted
  for tenancy.
- A browser nonce cookie, set on the authorize response and stored hashed with the state, stops an attacker from
  getting an admin's browser to finish a flow the attacker started.
- The user must still be an owner/admin of the organization when the callback arrives.
- The mailbox identity is the address Google returns from `users.getProfile` for the tokens just issued. A submitted
  address is never used. One mailbox can be connected to one organization at a time; a reconnect must be the same
  mailbox.
- Only the Gmail read scope is accepted; broader grants are refused. Tokens are stored encrypted with the existing
  integration credential mechanism and are never logged or returned.
"""

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import timedelta
from typing import Any, Dict, Optional, Tuple

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import settings
from app.core.encryption import decrypt_credentials, encrypt_credentials
from app.core.logging import logger
from app.models.audit_log import AuditLog
from app.models.base import utc_now
from app.models.gmail import (
    SYNC_NEEDS_REAUTH,
    SYNC_PENDING,
    WATCH_NONE,
    GmailAccount,
    OAuthState,
)
from app.models.integration import Integration
from app.models.membership import OrganizationMember, OrganizationRole
from app.services.gmail import watch as watch_service
from app.services.gmail.errors import GmailAuthError, GmailError, OAuthFlowError
from app.services.gmail.types import (
    REQUIRED_SCOPES,
    GmailClientFactory,
    OAuthClient,
    TokenSet,
)

GMAIL_TYPE = "GMAIL"
CONNECT_ROLES = {OrganizationRole.OWNER.value, OrganizationRole.ADMIN.value}
_HARMLESS_EXTRA_SCOPES = {"openid", "email", "profile"}
SessionFactory = async_sessionmaker[AsyncSession]


def hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _audit(
    session: AsyncSession,
    organization_id: uuid.UUID,
    user_id: Optional[uuid.UUID],
    action: str,
    resource_id: str,
    **details: Any,
) -> None:
    """Ids, mailbox address and stable reason codes only. Never tokens, codes or state values."""
    session.add(
        AuditLog(
            organization_id=organization_id,
            user_id=user_id,
            action=f"gmail.{action}",
            resource_type="integration",
            resource_id=resource_id,
            details=details,
        )
    )


@dataclass
class ConnectOutcome:
    ok: bool
    reason: str
    integration_id: Optional[uuid.UUID] = None
    reconnected: bool = False
    account_id: Optional[uuid.UUID] = None


def credentials_dict(tokens: TokenSet) -> Dict[str, Any]:
    return {
        "access_token": tokens.access_token,
        "refresh_token": tokens.refresh_token,
        "expiry": tokens.expiry.isoformat() if tokens.expiry else None,
        "scopes": list(tokens.scopes),
        "token_uri": tokens.token_uri,
    }


# ============================================================================ begin


async def begin_authorization(
    session: AsyncSession,
    organization_id: uuid.UUID,
    user_id: uuid.UUID,
    oauth: OAuthClient,
    integration_id: Optional[uuid.UUID] = None,
    workflow_id: Optional[uuid.UUID] = None,
) -> Tuple[str, str]:
    """Creates the single-use state. Returns (authorization_url, browser_nonce). The caller commits."""
    if not oauth.is_configured():
        raise OAuthFlowError("oauth_not_configured")
    if integration_id is not None:
        found = (
            await session.execute(
                select(Integration.id).where(
                    Integration.id == integration_id,
                    Integration.organization_id == organization_id,
                    Integration.type == GMAIL_TYPE,
                )
            )
        ).scalar_one_or_none()
        if found is None:
            raise OAuthFlowError("integration_not_found")

    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    request = oauth.authorization_url(state)
    now = utc_now()
    await session.execute(delete(OAuthState).where(OAuthState.expires_at < now - timedelta(days=1)))
    session.add(
        OAuthState(
            organization_id=organization_id,
            user_id=user_id,
            integration_id=integration_id,
            purpose="gmail",
            state_hash=hash_secret(state),
            nonce_hash=hash_secret(nonce),
            code_verifier_encrypted=encrypt_credentials({"v": request.code_verifier}, aad=organization_id.bytes),
            expires_at=now + timedelta(seconds=settings.GMAIL_OAUTH_STATE_TTL_SECONDS),
            extra={"workflow_id": str(workflow_id)} if workflow_id else None,
        )
    )
    _audit(
        session, organization_id, user_id, "connect_started", str(integration_id or ""), reconnect=bool(integration_id)
    )
    return request.url, nonce


# ============================================================================ complete


async def _unique_name(session: AsyncSession, organization_id: uuid.UUID, base: str) -> str:
    name, n = base, 1
    while (
        await session.execute(
            select(Integration.id).where(Integration.organization_id == organization_id, Integration.name == name)
        )
    ).first():
        n += 1
        name = f"{base} ({n})"
    return name


async def complete_authorization(
    session_factory: SessionFactory,
    state: Optional[str],
    nonce: Optional[str],
    code: Optional[str],
    provider_error: Optional[str],
    oauth: OAuthClient,
    client_factory: GmailClientFactory,
) -> ConnectOutcome:
    if not state:
        return ConnectOutcome(False, "invalid_state")
    now = utc_now()

    # 1. Validate and consume the state atomically (before any code exchange, so a replay cannot win).
    async with session_factory() as session:
        row = (
            await session.execute(
                select(OAuthState).where(OAuthState.state_hash == hash_secret(state)).with_for_update()
            )
        ).scalar_one_or_none()
        if row is None or row.purpose != "gmail":
            return ConnectOutcome(False, "invalid_state")
        if row.consumed_at is not None:
            return ConnectOutcome(False, "state_reused")
        if row.expires_at < now:
            return ConnectOutcome(False, "state_expired")
        if not nonce or hash_secret(nonce) != row.nonce_hash:
            # Leave the state unconsumed: an attacker without the nonce must not be able to burn the real flow.
            return ConnectOutcome(False, "browser_mismatch")
        row.consumed_at = now
        organization_id, user_id = row.organization_id, row.user_id
        reconnect_integration_id = row.integration_id
        requested_workflow = (row.extra or {}).get("workflow_id")
        try:
            verifier = decrypt_credentials(row.code_verifier_encrypted, aad=organization_id.bytes)["v"]
        except Exception:  # noqa: BLE001
            row.failure_reason = "state_corrupt"
            await session.commit()
            return ConnectOutcome(False, "invalid_state")
        await session.commit()

    async def fail(reason: str) -> ConnectOutcome:
        async with session_factory() as s:
            stored = await s.execute(select(OAuthState).where(OAuthState.state_hash == hash_secret(state)))
            record = stored.scalar_one_or_none()
            if record is not None:
                record.failure_reason = reason
            _audit(s, organization_id, user_id, "connect_failed", str(reconnect_integration_id or ""), reason=reason)
            await s.commit()
        return ConnectOutcome(False, reason)

    # 2. The user must (still) be allowed to connect mailboxes for this organization.
    async with session_factory() as session:
        member = (
            await session.execute(
                select(OrganizationMember).where(
                    OrganizationMember.organization_id == organization_id, OrganizationMember.user_id == user_id
                )
            )
        ).scalar_one_or_none()
    if member is None or member.role not in CONNECT_ROLES:
        return await fail("not_authorized")

    if provider_error:
        return await fail("access_denied" if provider_error == "access_denied" else "provider_error")
    if not code:
        return await fail("invalid_request")

    # 3. Exchange the code and validate what was granted.
    try:
        tokens = await oauth.exchange_code(code, verifier)
    except OAuthFlowError as err:
        return await fail(err.code)
    granted = set(tokens.scopes)
    creds = credentials_dict(tokens)
    refusal: Optional[str] = None
    if not set(REQUIRED_SCOPES) <= granted:
        refusal = "missing_scope"
    elif granted - set(REQUIRED_SCOPES) - _HARMLESS_EXTRA_SCOPES:
        refusal = "unexpected_scope"  # least privilege: refuse broader grants
    elif not tokens.refresh_token:
        refusal = "no_refresh_token"
    if refusal:
        await _revoke_quietly(client_factory, creds)  # do not leave a grant we refuse to use
        return await fail(refusal)

    # 4. The mailbox is whatever Google says these tokens belong to.
    client = client_factory(creds)
    try:
        profile = await client.get_profile()
    except GmailAuthError:
        await _revoke_quietly(client_factory, creds)
        return await fail("profile_unauthorized")
    except GmailError:
        await _revoke_quietly(client_factory, creds)
        return await fail("profile_failed")
    mailbox = profile.email_address.strip().lower()
    if "@" not in mailbox:
        await _revoke_quietly(client_factory, creds)
        return await fail("no_mailbox_identity")

    # 5. Persist.
    outcome = await _persist_connection(
        session_factory,
        organization_id,
        user_id,
        reconnect_integration_id,
        requested_workflow,
        mailbox,
        profile.history_id,
        creds,
        sorted(granted),
    )
    if not outcome.ok:
        await _revoke_quietly(client_factory, creds)  # we will not use these tokens
        return await fail(outcome.reason)

    # 6. Register the watch (best effort: polling keeps the mailbox current if Pub/Sub is unavailable).
    try:
        assert outcome.account_id is not None
        await watch_service.register_watch(session_factory, outcome.account_id, client_factory)
    except Exception:  # noqa: BLE001
        logger.warning("Gmail watch registration after connect failed; polling will cover the mailbox")
    return outcome


async def _revoke_quietly(client_factory: GmailClientFactory, creds: Dict[str, Any]) -> None:
    try:
        await client_factory(creds).revoke()
    except Exception:  # noqa: BLE001 - best effort; never surface provider text
        logger.warning("Could not revoke a refused Gmail grant")


async def _persist_connection(
    session_factory: SessionFactory,
    organization_id: uuid.UUID,
    user_id: uuid.UUID,
    reconnect_integration_id: Optional[uuid.UUID],
    requested_workflow: Optional[str],
    mailbox: str,
    history_id: str,
    creds: Dict[str, Any],
    scopes: list,
) -> ConnectOutcome:
    now = utc_now()
    async with session_factory() as session:
        active = (
            await session.execute(
                select(GmailAccount)
                .where(GmailAccount.email_address == mailbox, GmailAccount.disconnected_at.is_(None))
                .with_for_update()
            )
        ).scalar_one_or_none()
        if active is not None and active.organization_id != organization_id:
            return ConnectOutcome(False, "mailbox_in_use")  # never reveal which organization

        account: Optional[GmailAccount] = None
        integration: Optional[Integration] = None
        reconnected = False
        if reconnect_integration_id is not None:
            account = (
                await session.execute(
                    select(GmailAccount)
                    .where(
                        GmailAccount.integration_id == reconnect_integration_id,
                        GmailAccount.organization_id == organization_id,
                    )
                    .with_for_update()
                )
            ).scalar_one_or_none()
            if account is None:
                return ConnectOutcome(False, "integration_not_found")
            if account.email_address != mailbox:
                return ConnectOutcome(False, "mailbox_mismatch")  # a reconnect cannot swap the mailbox
            reconnected = True
        elif active is not None:
            account, reconnected = active, True
        else:
            account = (
                await session.execute(
                    select(GmailAccount)
                    .where(GmailAccount.organization_id == organization_id, GmailAccount.email_address == mailbox)
                    .order_by(GmailAccount.connected_at.desc())
                    .limit(1)
                    .with_for_update()
                )
            ).scalar_one_or_none()
            reconnected = account is not None

        was_disconnected = account is not None and account.disconnected_at is not None
        encrypted = encrypt_credentials(creds, aad=organization_id.bytes)
        if account is not None:
            integration = (
                await session.execute(
                    select(Integration)
                    .where(Integration.id == account.integration_id, Integration.organization_id == organization_id)
                    .with_for_update()
                )
            ).scalar_one_or_none()
        if integration is None:
            integration = Integration(
                organization_id=organization_id,
                type=GMAIL_TYPE,
                name=await _unique_name(session, organization_id, f"Gmail {mailbox}"),
                status="CONNECTED",
                credentials_encrypted=encrypted,
                config={},
            )
            session.add(integration)
            await session.flush()
        integration.credentials_encrypted = encrypted
        integration.status = "CONNECTED"
        config = dict(integration.config or {})
        config["email_address"] = mailbox
        if requested_workflow:
            config["workflow_id"] = requested_workflow
        integration.config = config

        if account is None:
            account = GmailAccount(
                organization_id=organization_id,
                integration_id=integration.id,
                email_address=mailbox,
                granted_scopes=scopes,
                connected_by=user_id,
                connected_at=now,
                history_id=history_id,  # policy: only mail that arrives after connecting is ingested
                sync_state=SYNC_PENDING,
                watch_status=WATCH_NONE,
            )
            session.add(account)
        else:
            account.granted_scopes = scopes
            account.connected_by = user_id
            account.disconnected_at = None
            account.sync_state = SYNC_PENDING
            account.last_sync_error = None
            account.consecutive_failures = 0
            account.sync_lease_owner = None
            account.sync_lease_expires_at = None
            if was_disconnected or not account.history_id:
                # Mail that arrived while disconnected is deliberately not back-filled.
                account.history_id = history_id
                account.connected_at = now
        try:
            await session.flush()
        except IntegrityError:
            await session.rollback()
            return ConnectOutcome(False, "mailbox_in_use")
        _audit(
            session,
            organization_id,
            user_id,
            "reconnected" if reconnected else "connected",
            str(integration.id),
            mailbox=mailbox,
            scopes=scopes,
        )
        await session.commit()
        return ConnectOutcome(True, "connected", integration.id, reconnected, account.id)


# ============================================================================ disconnect


async def disconnect(
    session_factory: SessionFactory,
    organization_id: uuid.UUID,
    integration_id: uuid.UUID,
    user_id: Optional[uuid.UUID],
    client_factory: GmailClientFactory,
) -> bool:
    """
    Stops the watch and revokes the grant at Google (best effort), then discards the stored credentials and stops all
    synchronisation. Returns False if there is no such Gmail integration in this organization.
    """
    async with session_factory() as session:
        integration = (
            await session.execute(
                select(Integration).where(
                    Integration.id == integration_id,
                    Integration.organization_id == organization_id,
                    Integration.type == GMAIL_TYPE,
                )
            )
        ).scalar_one_or_none()
        if integration is None:
            return False
        creds: Optional[Dict[str, Any]] = None
        if integration.credentials_encrypted:
            try:
                creds = decrypt_credentials(integration.credentials_encrypted, aad=organization_id.bytes)
            except Exception:  # noqa: BLE001 - unreadable credentials are discarded all the same
                creds = None

    if creds:
        client = client_factory(creds)
        for step in (client.stop_watch, client.revoke):
            try:
                await step()
            except Exception as exc:  # noqa: BLE001 - disconnect must succeed locally even if Google is unreachable
                logger.warning(f"Gmail disconnect step {step.__name__} failed ({type(exc).__name__})")

    async with session_factory() as session:
        integration = (
            await session.execute(
                select(Integration)
                .where(Integration.id == integration_id, Integration.organization_id == organization_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if integration is None:
            return False
        account = (
            await session.execute(
                select(GmailAccount).where(GmailAccount.integration_id == integration_id).with_for_update()
            )
        ).scalar_one_or_none()
        integration.credentials_encrypted = None
        integration.status = "DISCONNECTED"
        if account is not None and account.disconnected_at is None:
            account.disconnected_at = utc_now()
            account.watch_status = WATCH_NONE
            account.watch_expiration = None
            account.sync_requested_at = None
            account.sync_lease_owner = None
            account.sync_lease_expires_at = None
        _audit(
            session,
            organization_id,
            user_id,
            "disconnected",
            str(integration_id),
            mailbox=account.email_address if account else None,
            revoked=bool(creds),
        )
        await session.commit()
    return True


async def mark_needs_reauth(
    session_factory: SessionFactory, account_id: uuid.UUID, code: str = "reauthorization_required"
) -> None:
    """Credentials stopped working: flag the mailbox and its integration so the UI asks for a reconnect."""
    async with session_factory() as session:
        account = await session.get(GmailAccount, account_id)
        if account is None or account.disconnected_at is not None:
            return
        integration = await session.get(Integration, account.integration_id)
        account.sync_state = SYNC_NEEDS_REAUTH
        account.last_sync_error = code
        account.watch_status = WATCH_NONE
        if integration is not None and integration.status == "CONNECTED":
            integration.status = "ERROR"
        _audit(
            session, account.organization_id, None, "reauthorization_required", str(account.integration_id), reason=code
        )
        await session.commit()
