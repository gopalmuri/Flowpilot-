"""
Mailbox synchronisation: Gmail history -> normalized messages -> the existing `ingest_message` pipeline.

A Pub/Sub notification only says "this mailbox changed". The actual work is always done here, by reading Gmail's
history from the last processed historyId and fetching each new message through the API. That makes the flow robust to
duplicate, delayed and missed notifications: the same sync can safely run any number of times because messages are
deduplicated by (organization, channel, Gmail message id) in `ingest_message`.

Per mailbox, one sync at a time (a lease taken with a compare-and-swap). The stored historyId only advances after a
fully successful pass, so a crash or error re-reads the same window and the dedup key absorbs the repeats.
"""

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import settings
from app.core.encryption import decrypt_credentials, encrypt_credentials
from app.core.logging import logger
from app.models.audit_log import AuditLog
from app.models.base import utc_now
from app.models.gmail import (
    SYNC_ERROR,
    SYNC_OK,
    SYNC_RESYNC,
    GmailAccount,
)
from app.models.integration import Integration
from app.schemas.inbound import NormalizedMessage
from app.services.gmail import accounts as account_service
from app.services.gmail.errors import (
    GmailAuthError,
    GmailError,
    GmailHistoryExpired,
    GmailNotFound,
    GmailTransientError,
)
from app.services.gmail.mime import ParsedEmail, clean_text, parse_email
from app.services.gmail.types import GmailApiClient, GmailClientFactory, RawMessage
from app.services.gmail.watch import history_newer
from app.services.inbound.pipeline import ingest_message

SessionFactory = async_sessionmaker[AsyncSession]
GMAIL_CHANNEL = "GMAIL"
_SKIP_LABELS = {"SENT": "sent", "DRAFT": "draft", "SPAM": "spam", "TRASH": "trash"}


@dataclass
class SyncOutcome:
    status: str  # ok | busy | disconnected | needs_reauth | retry | error
    ingested: int = 0
    duplicates: int = 0
    skipped: Dict[str, int] = field(default_factory=dict)
    resynced: bool = False
    error: Optional[str] = None
    retry_after: Optional[float] = None


@dataclass
class _Lease:
    account_id: uuid.UUID
    organization_id: uuid.UUID
    integration: Integration
    mailbox: str
    history_id: Optional[str]
    creds: Dict[str, Any]
    claimed_request: Optional[datetime]
    backfill_days: int


def classify_inbound(raw: RawMessage, parsed: ParsedEmail, mailbox: str) -> Optional[str]:
    """Returns why a message must NOT be treated as a new inbound request, or None if it should be ingested."""
    labels = set(raw.label_ids)
    for label, reason in _SKIP_LABELS.items():
        if label in labels:
            return reason
    if "INBOX" not in labels:
        return "not_inbox"
    if not parsed.from_address:
        return "no_sender"
    if parsed.from_address == mailbox.lower():
        return "self_sent"
    if parsed.auto_generated:
        return "auto_generated"
    return None


def normalize(raw: RawMessage, parsed: ParsedEmail, account_id: uuid.UUID, oversized: bool) -> NormalizedMessage:
    received = (
        datetime.fromtimestamp(raw.internal_date_ms / 1000, tz=timezone.utc)
        if raw.internal_date_ms
        else (parsed.date or utc_now())
    )
    text = parsed.text or clean_text(raw.snippet, 9500) or "(no text content)"
    metadata = parsed.metadata()
    metadata.update(
        {
            "gmail_account_id": str(account_id),
            "gmail_thread_id": raw.thread_id,
            "gmail_history_id": raw.history_id,
            "labels": raw.label_ids,
            "oversized": oversized,
        }
    )
    return NormalizedMessage(
        channel=GMAIL_CHANNEL,
        external_message_id=raw.id,
        # The Gmail thread id is the conversation: replies in one thread stay in one FlowPilot conversation.
        external_conversation_id=raw.thread_id,
        sender_identity=parsed.from_address,
        sender_name=parsed.from_name,
        sender_address=parsed.from_address,
        subject=parsed.subject or None,
        text_content=text,
        received_at=received,
        provider_metadata=metadata,
    )


async def _acquire(session_factory: SessionFactory, account_id: uuid.UUID, owner: str, now: datetime) -> "_Lease | str":
    async with session_factory() as session:
        claim = await session.execute(
            update(GmailAccount)
            .where(
                GmailAccount.id == account_id,
                GmailAccount.disconnected_at.is_(None),
                or_(GmailAccount.sync_lease_expires_at.is_(None), GmailAccount.sync_lease_expires_at < now),
            )
            .values(
                sync_lease_owner=owner,
                sync_lease_expires_at=now + _lease_delta(),
                last_sync_started_at=now,
            )
        )
        await session.commit()
        account = await session.get(GmailAccount, account_id)
        if account is None or account.disconnected_at is not None:
            return "disconnected"
        if claim.rowcount != 1:  # type: ignore[attr-defined]
            return "busy"
        integration = await session.get(Integration, account.integration_id)
        if integration is None or integration.status == "DISCONNECTED" or not integration.credentials_encrypted:
            return "needs_reauth"
        try:
            creds = decrypt_credentials(integration.credentials_encrypted, aad=account.organization_id.bytes)
        except Exception:  # noqa: BLE001 - unreadable credentials mean the user must reconnect
            return "needs_reauth"
        backfill = int((integration.config or {}).get("backfill_days", 0) or 0)
        return _Lease(
            account_id=account.id,
            organization_id=account.organization_id,
            integration=integration,
            mailbox=account.email_address,
            history_id=account.history_id,
            creds=creds,
            claimed_request=account.sync_requested_at,
            backfill_days=max(0, min(backfill, 7)),
        )


def _lease_delta():
    from datetime import timedelta

    return timedelta(seconds=settings.GMAIL_SYNC_LEASE_SECONDS)


async def _release(
    session_factory: SessionFactory,
    lease: _Lease,
    owner: str,
    *,
    new_history_id: Optional[str] = None,
    success: bool = False,
    state: Optional[str] = None,
    error: Optional[str] = None,
    keep_dirty: bool = False,
    creds_snapshot: Optional[Dict[str, Any]] = None,
) -> None:
    """Writes the result of a sync and drops the lease (only if this worker still holds it)."""
    now = utc_now()
    async with session_factory() as session:
        account = (
            await session.execute(select(GmailAccount).where(GmailAccount.id == lease.account_id).with_for_update())
        ).scalar_one_or_none()
        if account is None or account.disconnected_at is not None:
            return  # disconnected mid-sync: leave everything as the disconnect set it
        if account.sync_lease_owner == owner:
            account.sync_lease_owner = None
            account.sync_lease_expires_at = None
        if success:
            if history_newer(new_history_id, account.history_id):
                account.history_id = new_history_id
            account.last_sync_at = now
            account.last_sync_error = None
            account.consecutive_failures = 0
            account.sync_state = SYNC_OK
            if lease.claimed_request is not None and (
                account.sync_requested_at is None or account.sync_requested_at <= lease.claimed_request
            ):
                account.sync_requested_at = None  # a notification that arrived during the sync keeps it dirty
        else:
            account.consecutive_failures += 1
            account.last_sync_error = (error or "error")[:200]
            if state:
                account.sync_state = state
            if keep_dirty:
                account.sync_requested_at = now
        if creds_snapshot is not None and creds_snapshot != lease.creds:
            integration = await session.get(Integration, account.integration_id)
            if integration is not None and integration.credentials_encrypted:
                integration.credentials_encrypted = encrypt_credentials(
                    creds_snapshot, aad=account.organization_id.bytes
                )
        await session.commit()


async def sync_mailbox(
    session_factory: SessionFactory,
    account_id: uuid.UUID,
    client_factory: GmailClientFactory,
    owner: str,
    now: Optional[datetime] = None,
    dispatch: Optional[Callable[..., None]] = None,
) -> SyncOutcome:
    now = now or utc_now()
    lease = await _acquire(session_factory, account_id, owner, now)
    if isinstance(lease, str):
        if lease == "needs_reauth":
            await account_service.mark_needs_reauth(session_factory, account_id)
        return SyncOutcome(status=lease)

    client = client_factory(lease.creds)
    outcome = SyncOutcome(status="ok")
    try:
        new_history = await _run_sync(session_factory, client, lease, outcome, dispatch)
    except GmailAuthError as err:
        await _release(session_factory, lease, owner, error=err.code, creds_snapshot=client.credentials_snapshot())
        await account_service.mark_needs_reauth(session_factory, account_id, err.code)
        return SyncOutcome(status="needs_reauth", error=err.code)
    except GmailTransientError as err:
        await _release(
            session_factory,
            lease,
            owner,
            error=err.code,
            keep_dirty=True,
            creds_snapshot=client.credentials_snapshot(),
        )
        return SyncOutcome(status="retry", error=err.code, retry_after=err.retry_after)
    except GmailError as err:
        await _release(session_factory, lease, owner, state=SYNC_ERROR, error=err.code, keep_dirty=False)
        return SyncOutcome(status="error", error=err.code)
    except Exception as exc:  # noqa: BLE001 - record the type only; messages could contain content
        logger.error(f"Unexpected error syncing Gmail account {account_id}: {type(exc).__name__}")
        await _release(session_factory, lease, owner, state=SYNC_ERROR, error="unexpected_error", keep_dirty=True)
        return SyncOutcome(status="error", error="unexpected_error")

    await _release(
        session_factory,
        lease,
        owner,
        new_history_id=new_history,
        success=True,
        creds_snapshot=client.credentials_snapshot(),
    )
    return outcome


async def _run_sync(
    session_factory: SessionFactory,
    client: GmailApiClient,
    lease: _Lease,
    outcome: SyncOutcome,
    dispatch: Optional[Callable[..., None]],
) -> Optional[str]:
    """Returns the historyId to store on success."""
    if not lease.history_id:
        # First sync with no baseline: only mail from now on, unless a small backfill was asked for.
        profile = await client.get_profile()
        if lease.backfill_days:
            ids = await client.list_messages(f"newer_than:{lease.backfill_days}d", settings.GMAIL_MAX_MESSAGES_PER_SYNC)
            await _process(session_factory, client, lease, list(reversed(ids)), outcome, dispatch)
        return profile.history_id

    message_ids: List[str] = []
    latest: Optional[str] = lease.history_id
    page_token: Optional[str] = None
    try:
        while True:
            page = await client.list_history(lease.history_id, page_token)
            for mid in page.message_ids:
                if mid not in message_ids:
                    message_ids.append(mid)
            if history_newer(page.history_id, latest):
                latest = page.history_id
            page_token = page.next_page_token
            if not page_token:
                break
    except GmailHistoryExpired:
        return await _controlled_resync(session_factory, client, lease, outcome, dispatch)

    await _process(session_factory, client, lease, message_ids, outcome, dispatch)
    return latest


async def _controlled_resync(
    session_factory: SessionFactory,
    client: GmailApiClient,
    lease: _Lease,
    outcome: SyncOutcome,
    dispatch: Optional[Callable[..., None]],
) -> Optional[str]:
    """
    The stored historyId is too old (Gmail keeps roughly a week) or invalid. Take a fresh baseline FIRST, then list a
    bounded recent window and ingest anything not seen yet. Taking the baseline before listing means nothing arriving
    in between is lost (it shows up again in history and is deduplicated).
    """
    outcome.resynced = True
    async with session_factory() as session:
        account = await session.get(GmailAccount, lease.account_id)
        if account is not None:
            account.sync_state = SYNC_RESYNC
            session.add(
                AuditLog(
                    organization_id=lease.organization_id,
                    user_id=None,
                    action="gmail.resync",
                    resource_type="integration",
                    resource_id=str(lease.integration.id),
                    details={"reason": "history_expired", "window_days": settings.GMAIL_RESYNC_WINDOW_DAYS},
                )
            )
            await session.commit()
    profile = await client.get_profile()
    ids = await client.list_messages(
        f"newer_than:{settings.GMAIL_RESYNC_WINDOW_DAYS}d", settings.GMAIL_MAX_MESSAGES_PER_SYNC
    )
    await _process(session_factory, client, lease, list(reversed(ids)), outcome, dispatch)
    return profile.history_id


async def _process(
    session_factory: SessionFactory,
    client: GmailApiClient,
    lease: _Lease,
    message_ids: List[str],
    outcome: SyncOutcome,
    dispatch: Optional[Callable[..., None]],
) -> None:
    for message_id in message_ids:
        try:
            raw = await client.get_raw_message(message_id)
        except GmailNotFound:
            outcome.skipped["missing"] = outcome.skipped.get("missing", 0) + 1  # deleted before we read it
            continue
        oversized = len(raw.raw) > settings.GMAIL_MAX_RAW_BYTES
        parsed = parse_email(b"" if oversized else raw.raw)
        if oversized:  # too large to parse safely: ingest from Gmail's own snippet and sender headers only
            parsed = _oversized_stub(raw)
        reason = classify_inbound(raw, parsed, lease.mailbox)
        if reason:
            outcome.skipped[reason] = outcome.skipped.get(reason, 0) + 1
            continue
        message = normalize(raw, parsed, lease.account_id, oversized)
        result = await ingest_message(session_factory, lease.integration, message, dispatch)
        if result.status == "duplicate":
            outcome.duplicates += 1
        else:
            outcome.ingested += 1


def _oversized_stub(raw: RawMessage) -> ParsedEmail:
    headers = parse_email(raw.raw[:65536])  # headers sit at the start; parse only a small prefix
    headers.text = clean_text(raw.snippet, 9500)
    headers.attachments = []
    return headers


async def find_due_accounts(session_factory: SessionFactory, now: Optional[datetime] = None) -> List[uuid.UUID]:
    """
    Mailboxes that need a sync: a notification is pending (the durable signal), or nothing has been synced for a poll
    interval (the safety net for missed notifications and for deployments without Pub/Sub). Mailboxes that need
    reauthorization or are disconnected are never returned.
    """
    from datetime import timedelta

    from app.models.gmail import SYNC_NEEDS_REAUTH

    now = now or utc_now()
    stale_before = now - timedelta(seconds=settings.GMAIL_POLL_INTERVAL_SECONDS)
    async with session_factory() as session:
        rows = await session.execute(
            select(GmailAccount.id).where(
                GmailAccount.disconnected_at.is_(None),
                GmailAccount.sync_state != SYNC_NEEDS_REAUTH,
                or_(GmailAccount.sync_lease_expires_at.is_(None), GmailAccount.sync_lease_expires_at < now),
                or_(
                    GmailAccount.sync_requested_at.is_not(None),
                    GmailAccount.last_sync_at.is_(None),
                    GmailAccount.last_sync_at < stale_before,
                ),
            )
        )
        return list(rows.scalars())
