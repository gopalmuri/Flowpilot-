"""
Mailbox watch lifecycle.

`users.watch` makes Gmail publish a Pub/Sub message when the mailbox changes. A watch lasts about a week, so it is
re-registered before it expires. When no Pub/Sub topic is configured (local development) the watch is simply not used
and the mailbox is kept current by polling.

Each registration takes a short per-mailbox lease with a compare-and-swap, so two renewal jobs (or a renewal and a
connect) cannot register the same mailbox at the same time even if more than one scheduler were ever running.
"""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import settings
from app.core.encryption import decrypt_credentials, encrypt_credentials
from app.core.logging import logger
from app.models.audit_log import AuditLog
from app.models.base import utc_now
from app.models.gmail import (
    SYNC_NEEDS_REAUTH,
    WATCH_ACTIVE,
    WATCH_FAILED,
    WATCH_NONE,
    WATCH_NOT_CONFIGURED,
    GmailAccount,
)
from app.models.integration import Integration
from app.services.gmail.errors import GmailAuthError, GmailError
from app.services.gmail.types import GmailClientFactory

SessionFactory = async_sessionmaker[AsyncSession]
WATCH_LEASE_SECONDS = 300


def history_newer(candidate: Optional[str], current: Optional[str]) -> bool:
    """historyId is an unsigned 64-bit number carried as a string."""
    if not candidate:
        return False
    if not current:
        return True
    try:
        return int(candidate) > int(current)
    except ValueError:
        return False


async def register_watch(
    session_factory: SessionFactory,
    account_id: uuid.UUID,
    client_factory: GmailClientFactory,
    now: Optional[datetime] = None,
) -> str:
    """Registers (or renews) the mailbox watch. Returns the resulting watch_status."""
    now = now or utc_now()
    if not settings.GMAIL_PUBSUB_TOPIC:
        async with session_factory() as session:
            account = await session.get(GmailAccount, account_id)
            if account is not None and account.disconnected_at is None and account.watch_status != WATCH_NOT_CONFIGURED:
                account.watch_status = WATCH_NOT_CONFIGURED
                account.watch_error = None
                await session.commit()
        return WATCH_NOT_CONFIGURED

    async with session_factory() as session:
        claim = await session.execute(
            update(GmailAccount)
            .where(
                GmailAccount.id == account_id,
                GmailAccount.disconnected_at.is_(None),
                or_(GmailAccount.watch_lease_until.is_(None), GmailAccount.watch_lease_until < now),
            )
            .values(watch_lease_until=now + timedelta(seconds=WATCH_LEASE_SECONDS))
        )
        await session.commit()
        if claim.rowcount != 1:  # type: ignore[attr-defined]
            return "skipped"  # another registration is running, or the mailbox was disconnected
        account = await session.get(GmailAccount, account_id)
        assert account is not None
        integration = await session.get(Integration, account.integration_id)
        if integration is None or not integration.credentials_encrypted:
            return "skipped"
        creds: Dict[str, Any] = decrypt_credentials(
            integration.credentials_encrypted, aad=account.organization_id.bytes
        )
        organization_id, integration_id = account.organization_id, account.integration_id

    client = client_factory(creds)
    status, error = WATCH_FAILED, None
    expiration: Optional[datetime] = None
    history_id: Optional[str] = None
    try:
        result = await client.watch(settings.GMAIL_PUBSUB_TOPIC)
        expiration = datetime.fromtimestamp(result.expiration_ms / 1000, tz=timezone.utc)
        history_id = result.history_id
        status = WATCH_ACTIVE
    except GmailAuthError as err:
        status, error = WATCH_NONE, err.code
    except GmailError as err:
        error = err.code

    async with session_factory() as session:
        account = await session.get(GmailAccount, account_id)
        if account is None or account.disconnected_at is not None:
            return "skipped"
        account.watch_lease_until = None
        account.watch_status = status
        account.watch_error = error
        if status == WATCH_ACTIVE:
            account.watch_expiration = expiration
            account.watch_registered_at = now
            if not account.history_id:
                account.history_id = history_id
        elif error == GmailAuthError.code:
            account.sync_state = SYNC_NEEDS_REAUTH
            account.last_sync_error = error
            integration = await session.get(Integration, account.integration_id)
            if integration is not None and integration.status == "CONNECTED":
                integration.status = "ERROR"
        snapshot = client.credentials_snapshot()
        if snapshot != creds:  # tokens were refreshed during the call
            integration = await session.get(Integration, integration_id)
            if integration is not None and integration.credentials_encrypted:
                integration.credentials_encrypted = encrypt_credentials(snapshot, aad=organization_id.bytes)
        session.add(
            AuditLog(
                organization_id=organization_id,
                user_id=None,
                action="gmail.watch_registered" if status == WATCH_ACTIVE else "gmail.watch_failed",
                resource_type="integration",
                resource_id=str(integration_id),
                details={"status": status, "reason": error, "expires": expiration.isoformat() if expiration else None},
            )
        )
        await session.commit()
    if status != WATCH_ACTIVE:
        logger.warning(f"Gmail watch not active for account {account_id}: {error}")
    return status


async def renew_due_watches(
    session_factory: SessionFactory, client_factory: GmailClientFactory, now: Optional[datetime] = None
) -> Dict[str, int]:
    """Re-registers watches that are missing, failed, or within the renewal window of expiring."""
    now = now or utc_now()
    if not settings.GMAIL_PUBSUB_TOPIC:
        return {"renewed": 0, "failed": 0, "skipped": 0}
    horizon = now + timedelta(hours=settings.GMAIL_WATCH_RENEW_BEFORE_HOURS)
    async with session_factory() as session:
        ids: List[uuid.UUID] = list(
            (
                await session.execute(
                    select(GmailAccount.id).where(
                        GmailAccount.disconnected_at.is_(None),
                        GmailAccount.sync_state != SYNC_NEEDS_REAUTH,
                        or_(
                            GmailAccount.watch_expiration.is_(None),
                            GmailAccount.watch_expiration < horizon,
                            GmailAccount.watch_status.in_([WATCH_FAILED, WATCH_NONE, WATCH_NOT_CONFIGURED]),
                        ),
                    )
                )
            ).scalars()
        )
    counts = {"renewed": 0, "failed": 0, "skipped": 0}
    for account_id in ids:
        outcome = await register_watch(session_factory, account_id, client_factory, now)
        if outcome == WATCH_ACTIVE:
            counts["renewed"] += 1
        elif outcome == "skipped":
            counts["skipped"] += 1
        else:
            counts["failed"] += 1
    return counts
