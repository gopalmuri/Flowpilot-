"""
Outbound delivery: gate, outbox, atomic claim, send, reconciliation and recovery.

Lifecycle (OutboundDelivery.status):

  PENDING --claim--> CLAIMED --mark--> SENDING --provider accepts--> SENT
     ^                  |                 |
     |   (lease expired |                 +-- TRANSIENT -------> FAILED_RETRYABLE --due--> (claim again)
     +-- before SENDING)|                 +-- PERMANENT -------> FAILED_PERMANENT
                        |                 +-- UNCERTAIN -> reconcile: found -> SENT
                        |                                           not found (authoritative, after grace)
                        |                                                      -> FAILED_RETRYABLE
                        |                                           otherwise -> UNKNOWN_OUTCOME
                        +-- gate fails at claim time ------------------------------> CANCELLED
  UNKNOWN_OUTCOME: never auto-resent. Reconciled later, or resolved by a person.
  SENT means "the provider accepted the message". It is not a delivery receipt.

Why CLAIMED and SENDING are separate: CLAIMED is committed before anything is sent, SENDING is committed immediately
before the provider call. A worker that dies in CLAIMED never called the provider, so the claim is released and the
send is retried. A worker that dies in SENDING may or may not have caused a send, so that is UNKNOWN_OUTCOME and is
reconciled, never resent.

The authorisation gate (`check_gate`) runs when a delivery is created AND again under row locks at claim time, so an
approval that changed in between (edited, invalidated, cancelled) stops the send. Lock order is the same everywhere:
run -> approval -> draft -> delivery.

No exactly-once claim is made. The local idempotency key and the (draft, version) uniqueness guarantee at most one
delivery RECORD and at most one local claim. Whether the provider received the message once depends on the provider;
that is why an ambiguous result is reconciled or surfaced instead of retried.
"""

import asyncio
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Callable, Dict, List, Optional, Tuple

from sqlalchemy import or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import logger
from app.models.approval import ApprovalRequest
from app.models.audit_log import AuditLog
from app.models.base import utc_now
from app.models.conversation import ReplyDraft, ReplyDraftVersion
from app.models.integration import Integration
from app.models.outbound import (
    CANCELLED,
    CLAIMED,
    DISPATCHABLE_STATES,
    FAILED_PERMANENT,
    FAILED_RETRYABLE,
    PENDING,
    SENDING,
    SENT,
    UNKNOWN_OUTCOME,
    OutboundDelivery,
)
from app.models.workflow_run import WorkflowRun
from app.models.workflow_step import WorkflowStep
from app.services.inbound import drafts as draft_service
from app.services.outbound.providers import (
    AccountRef,
    ErrorKind,
    OutboundProvider,
    ProviderError,
    ReconcileStatus,
    SendRequest,
    get_provider,
)
from app.services.outbound.routing import Route, RoutingError, resolve_route

SessionFactory = Callable[[], AsyncSession]
ProviderFactory = Callable[[str], OutboundProvider]


class DeliveryRefused(Exception):
    """A delivery could not be created. `code` is stable and meant for operators and tests."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class GateFailure(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def make_idempotency_key(draft_id: uuid.UUID, version_number: int) -> str:
    return f"delivery:{draft_id}:{version_number}"


def _audit(
    session: AsyncSession, d: OutboundDelivery, action: str, user_id: Optional[uuid.UUID] = None, **details: Any
):
    """Ids, states and codes only. Never the message text, the destination or credentials."""
    session.add(
        AuditLog(
            organization_id=d.organization_id,
            user_id=user_id,
            action=f"outbound.{action}",
            resource_type="outbound_delivery",
            resource_id=str(d.id),
            details={
                "delivery_id": str(d.id),
                "draft_id": str(d.draft_id),
                "version": d.version_number,
                "attempt": d.attempt_count,
                "channel": d.channel,
                "provider": d.provider,
                "status": d.status,
                "workflow_run_id": str(d.workflow_run_id) if d.workflow_run_id else None,
                **details,
            },
        )
    )


def _backoff(attempt: int) -> timedelta:
    seconds = min(
        settings.OUTBOUND_BACKOFF_BASE_SECONDS * (2 ** max(attempt - 1, 0)), settings.OUTBOUND_BACKOFF_MAX_SECONDS
    )
    return timedelta(seconds=seconds)


def _set_error(d: OutboundDelivery, kind: str, code: str, message: str) -> None:
    d.last_error_category = kind
    d.last_error_code = code[:60]
    d.last_error_detail = message[:500]


def _release(d: OutboundDelivery) -> None:
    d.claimed_by = None
    d.lease_expires_at = None


def _fail_draft(draft: ReplyDraft) -> None:
    """A delivery that will not send leaves the draft needing a person: edit it (new approval) or investigate."""
    if draft.status in (draft_service.APPROVED, draft_service.SENDING):
        draft.status = draft_service.SEND_FAILED


# ============================================================================ authorisation gate


async def check_gate(
    session: AsyncSession,
    draft: ReplyDraft,
    delivery: Optional[OutboundDelivery] = None,
    workflow_run_id: Optional[uuid.UUID] = None,
) -> ReplyDraftVersion:
    """
    Raises GateFailure unless the draft's approval still authorises exactly this text for sending.
    The caller must hold the draft row lock. Returns the immutable version that is authorised.
    (Destination/channel/account checks are done by `resolve_route`, which the callers run next to this.)
    """
    allowed = {draft_service.APPROVED}
    if delivery is not None and delivery.consumed_at is not None:
        allowed.add(draft_service.SENDING)  # this delivery already consumed the approval on an earlier attempt
    if draft.status not in allowed:
        raise GateFailure("draft_not_approved", f"The draft is '{draft.status}', not approved for sending")

    if draft.approved_version_number is None or draft.approved_version_number != draft.current_version_number:
        raise GateFailure("approved_version_not_current", "The approved version is no longer the current version")
    if delivery is not None and delivery.version_number != draft.approved_version_number:
        raise GateFailure("version_mismatch", "The delivery is for a version that is not the approved version")

    version = await draft_service.get_version(session, draft.id, draft.approved_version_number)
    if version is None or version.organization_id != draft.organization_id:
        raise GateFailure("version_missing", "The approved version record is missing")
    if draft_service.content_hash(version.content) != version.content_hash:
        raise GateFailure("version_hash_mismatch", "The approved text no longer matches its recorded hash")
    if delivery is not None and delivery.content_hash != version.content_hash:
        raise GateFailure("delivery_hash_mismatch", "The delivery was created for different text")

    approval = None
    if draft.approval_request_id is not None:
        approval = (
            await session.execute(
                select(ApprovalRequest)
                .where(
                    ApprovalRequest.id == draft.approval_request_id,
                    ApprovalRequest.organization_id == draft.organization_id,
                )
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
    if approval is None:
        raise GateFailure("approval_missing", "The approval request for this draft was not found")
    if approval.status != "APPROVED":
        raise GateFailure("approval_not_active", f"The approval is {approval.status.lower()}")
    if delivery is not None and delivery.approval_request_id != approval.id:
        raise GateFailure("approval_superseded", "The approval changed after this delivery was created")
    if draft.decided_by is None or draft.decided_at is None:
        raise GateFailure("no_human_decision", "No human approval decision is recorded for this draft")

    if workflow_run_id is not None:
        run = (await session.execute(select(WorkflowRun).where(WorkflowRun.id == workflow_run_id))).scalar_one_or_none()
        if run is None or run.organization_id != draft.organization_id:
            raise GateFailure("run_not_in_organization", "The workflow run does not belong to this organization")
        if approval.workflow_run_id != run.id:
            raise GateFailure("run_mismatch", "The approval does not belong to this workflow run")
    return version


# ============================================================================ creation (the outbox write)


async def create_delivery(
    session: AsyncSession,
    organization_id: uuid.UUID,
    draft_id: uuid.UUID,
    workflow_run_id: Optional[uuid.UUID],
    provider_factory: ProviderFactory = get_provider,
) -> Tuple[OutboundDelivery, bool]:
    """
    Records the intent to send the draft's approved version. Idempotent: the same approved version always yields the
    same single delivery (returned with created=False). Sends nothing. The caller commits; the committed row IS the
    outbox entry that the dispatcher relays to Celery.
    """
    draft = await draft_service.lock_draft(session, organization_id, draft_id)
    if draft is None:
        raise DeliveryRefused("draft_not_found", "The draft was not found in this organization")

    try:
        version = await check_gate(session, draft, workflow_run_id=workflow_run_id)
    except GateFailure as gate:
        _refuse_audit(session, draft, gate.code)
        raise DeliveryRefused(gate.code, gate.message) from None

    existing = (
        await session.execute(
            select(OutboundDelivery).where(
                OutboundDelivery.draft_id == draft.id, OutboundDelivery.version_number == version.version_number
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing, False

    try:
        route = await resolve_route(session, draft)
        provider = provider_factory(route.provider)
        await provider.validate(
            AccountRef(route.integration_id, route.integration_type, route.account_config),
            route.channel,
            route.destination,
            route.context,
        )
    except RoutingError as err:
        _refuse_audit(session, draft, err.code)
        raise DeliveryRefused(err.code, err.message) from None
    except ProviderError as err:
        _refuse_audit(session, draft, err.code)
        raise DeliveryRefused(err.code, err.safe_message) from None

    delivery = OutboundDelivery(
        organization_id=organization_id,
        draft_id=draft.id,
        conversation_id=draft.conversation_id,
        integration_id=route.integration_id,
        approval_request_id=draft.approval_request_id,
        workflow_run_id=workflow_run_id,
        version_number=version.version_number,
        content_hash=version.content_hash,
        channel=route.channel,
        provider=route.provider,
        destination=route.destination,
        provider_context=route.context,
        idempotency_key=make_idempotency_key(draft.id, version.version_number),
        status=PENDING,
        attempt_count=0,
        max_attempts=settings.OUTBOUND_MAX_ATTEMPTS,
    )
    try:
        async with session.begin_nested():
            session.add(delivery)
            await session.flush()
    except IntegrityError:  # a concurrent creator won; there is still exactly one logical delivery
        winner = (
            await session.execute(
                select(OutboundDelivery).where(
                    OutboundDelivery.draft_id == draft.id, OutboundDelivery.version_number == version.version_number
                )
            )
        ).scalar_one()
        return winner, False
    _audit(session, delivery, "delivery_created")
    return delivery, True


def _refuse_audit(session: AsyncSession, draft: ReplyDraft, code: str) -> None:
    session.add(
        AuditLog(
            organization_id=draft.organization_id,
            user_id=None,
            action="outbound.delivery_refused",
            resource_type="reply_draft",
            resource_id=str(draft.id),
            details={"draft_id": str(draft.id), "reason": code, "draft_status": draft.status},
        )
    )


async def has_send_step(session: AsyncSession, run_id: uuid.UUID) -> bool:
    """True if the run's workflow version contains a SEND_REPLY step (so approved drafts should be sent)."""
    run = (await session.execute(select(WorkflowRun).where(WorkflowRun.id == run_id))).scalar_one_or_none()
    if run is None:
        return False
    found = (
        await session.execute(
            select(WorkflowStep.id).where(
                WorkflowStep.workflow_version_id == run.workflow_version_id, WorkflowStep.step_type == "SEND_REPLY"
            )
        )
    ).first()
    return found is not None


async def create_after_reapproval(session: AsyncSession, draft: ReplyDraft, approval: ApprovalRequest) -> None:
    """
    A re-approved edit happens after the workflow run finished, so no step will create its delivery. If the workflow
    sends replies, create it here (same gate, same idempotency). A refusal is already audited and is not an error.
    """
    # Persist the caller's pending changes first: the gate re-reads rows with populate_existing and would otherwise
    # overwrite the not-yet-flushed approval/draft state with what the database still has.
    await session.flush()
    if not await has_send_step(session, approval.workflow_run_id):
        return
    try:
        await create_delivery(session, draft.organization_id, draft.id, approval.workflow_run_id)
    except DeliveryRefused:
        pass


async def cancel_unconsumed(session: AsyncSession, draft: ReplyDraft, reason: str) -> int:
    """Cancels deliveries that never started (so an edit/invalidated approval can't be sent by a queued task)."""
    rows = (
        (
            await session.execute(
                select(OutboundDelivery)
                .where(
                    OutboundDelivery.draft_id == draft.id,
                    OutboundDelivery.status.in_(list(DISPATCHABLE_STATES)),
                    OutboundDelivery.consumed_at.is_(None),
                )
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    for d in rows:
        d.status = CANCELLED
        _set_error(d, "gate", reason, "Cancelled because the approval no longer authorises this text")
        _audit(session, d, "delivery_cancelled", reason=reason)
    return len(rows)


# ============================================================================ outbox relay


async def dispatch_due(
    session_factory: SessionFactory,
    enqueue: Callable[[str], Any],
    limit: int = 100,
    now: Optional[datetime] = None,
) -> List[uuid.UUID]:
    """
    Outbox relay. Marks due deliveries as enqueued (committed first) and then hands them to the broker.
    A row that was enqueued but never claimed (broker lost it, worker down) is re-enqueued after the visibility
    window, so a committed delivery request cannot silently disappear. Duplicate tasks are harmless: only one can
    win the claim.
    """
    now = now or utc_now()
    stale_before = now - timedelta(seconds=settings.OUTBOUND_ENQUEUE_VISIBILITY_SECONDS)
    async with session_factory() as session:
        rows = (
            (
                await session.execute(
                    select(OutboundDelivery)
                    .where(
                        OutboundDelivery.status.in_(list(DISPATCHABLE_STATES)),
                        or_(OutboundDelivery.next_attempt_at.is_(None), OutboundDelivery.next_attempt_at <= now),
                        or_(OutboundDelivery.enqueued_at.is_(None), OutboundDelivery.enqueued_at < stale_before),
                    )
                    .order_by(OutboundDelivery.created_at.asc())
                    .limit(limit)
                    .with_for_update(skip_locked=True)
                )
            )
            .scalars()
            .all()
        )
        ids = [r.id for r in rows]
        for r in rows:
            r.enqueued_at = now
        await session.commit()
    for delivery_id in ids:
        enqueue(str(delivery_id))
    return ids


# ============================================================================ claim / send / finish


@dataclass
class ClaimedWork:
    delivery_id: uuid.UUID
    organization_id: uuid.UUID
    draft_id: uuid.UUID
    version_number: int
    body: str
    subject: Optional[str]
    destination: str
    channel: str
    context: Dict[str, Any]
    idempotency_key: str
    attempt: int
    account: AccountRef
    provider_name: str

    def request(self, with_body: bool = True) -> SendRequest:
        return SendRequest(
            delivery_id=self.delivery_id,
            idempotency_key=self.idempotency_key,
            channel=self.channel,
            destination=self.destination,
            body=self.body if with_body else "",
            subject=self.subject,
            context=self.context,
            attempt=self.attempt,
            account=self.account,
        )


async def _lock_pair(session: AsyncSession, delivery_id: uuid.UUID) -> Optional[Tuple[ReplyDraft, OutboundDelivery]]:
    """Locks draft then delivery (the codebase lock order). Returns None if the delivery does not exist."""
    head = (
        await session.execute(select(OutboundDelivery).where(OutboundDelivery.id == delivery_id))
    ).scalar_one_or_none()
    if head is None:
        return None
    draft = await draft_service.lock_draft(session, head.organization_id, head.draft_id)
    delivery = (
        await session.execute(
            select(OutboundDelivery)
            .where(OutboundDelivery.id == delivery_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    if draft is None:
        return None
    return draft, delivery


async def _claim(
    session_factory: SessionFactory, delivery_id: uuid.UUID, worker_id: str, provider_factory: ProviderFactory
) -> Optional[ClaimedWork]:
    """Gate, then atomically claim and consume the approval. Exactly one concurrent caller can succeed."""
    now = utc_now()
    async with session_factory() as session:
        pair = await _lock_pair(session, delivery_id)
        if pair is None:
            return None
        draft, d = pair
        if d.status not in DISPATCHABLE_STATES:
            return None  # someone else claimed it, or it is finished
        if d.next_attempt_at is not None and d.next_attempt_at > now:
            return None  # not due yet

        try:
            version = await check_gate(session, draft, delivery=d, workflow_run_id=d.workflow_run_id)
        except GateFailure as gate:
            d.status = CANCELLED
            _release(d)
            _set_error(d, "gate", gate.code, gate.message)
            _audit(session, d, "delivery_cancelled", reason=gate.code)
            await session.commit()
            return None

        try:
            route: Route = await resolve_route(session, draft)
            if (route.destination, route.channel, route.integration_id) != (d.destination, d.channel, d.integration_id):
                raise RoutingError("route_changed", "The destination or sending account changed since approval")
            provider_factory(route.provider)  # raises ProviderError if this provider is not enabled
        except (RoutingError, ProviderError) as err:
            code = err.code
            message = err.message if isinstance(err, RoutingError) else err.safe_message
            d.attempt_count += 1
            _set_error(d, "routing", code, message)
            if code == "route_changed" or d.attempt_count >= d.max_attempts or isinstance(err, ProviderError):
                d.status = FAILED_PERMANENT
                _fail_draft(draft)
                _audit(session, d, "delivery_failed_permanent", reason=code)
            else:
                d.status = FAILED_RETRYABLE
                d.next_attempt_at = now + _backoff(d.attempt_count)
                d.enqueued_at = None
                _audit(session, d, "delivery_failed_retryable", reason=code)
            await session.commit()
            return None

        # Consume the approval: APPROVED -> SENDING (edits are blocked from here on).
        if draft.status == draft_service.APPROVED:
            draft.status = draft_service.SENDING
        if d.consumed_at is None:
            d.consumed_at = now
        d.status = CLAIMED
        d.claimed_by = worker_id
        d.claimed_at = now
        d.lease_expires_at = now + timedelta(seconds=settings.OUTBOUND_LEASE_SECONDS)
        d.attempt_count += 1
        _audit(session, d, "delivery_claimed", worker=worker_id)

        # The body comes from the immutable approved version row read under this same lock.
        work = ClaimedWork(
            delivery_id=d.id,
            organization_id=d.organization_id,
            draft_id=d.draft_id,
            version_number=d.version_number,
            body=version.content,
            subject=route.subject,
            destination=d.destination,
            channel=d.channel,
            context=dict(d.provider_context or {}),
            idempotency_key=d.idempotency_key,
            attempt=d.attempt_count,
            account=AccountRef(route.integration_id, route.integration_type, route.account_config),
            provider_name=route.provider,
        )
        await session.commit()
        return work


async def _mark_sending(session_factory: SessionFactory, work: ClaimedWork, worker_id: str) -> Optional[datetime]:
    now = utc_now()
    async with session_factory() as session:
        result = await session.execute(
            update(OutboundDelivery)
            .where(
                OutboundDelivery.id == work.delivery_id,
                OutboundDelivery.status == CLAIMED,
                OutboundDelivery.claimed_by == worker_id,
            )
            .values(
                status=SENDING,
                attempt_started_at=now,
                lease_expires_at=now + timedelta(seconds=settings.OUTBOUND_LEASE_SECONDS),
            )
        )
        if result.rowcount != 1:  # type: ignore[attr-defined]
            await session.rollback()
            return None
        d = await session.get(OutboundDelivery, work.delivery_id)
        assert d is not None
        _audit(session, d, "delivery_attempt_started", worker=worker_id)
        await session.commit()
        return now


async def _finish_sent(
    session_factory: SessionFactory,
    delivery_id: uuid.UUID,
    worker_id: Optional[str],
    provider_message_id: str,
    resolution: Optional[str],
    from_states: Tuple[str, ...] = (SENDING, UNKNOWN_OUTCOME),
) -> bool:
    async with session_factory() as session:
        pair = await _lock_pair(session, delivery_id)
        if pair is None:
            return False
        draft, d = pair
        if d.status not in from_states or (worker_id is not None and d.claimed_by != worker_id):
            return False
        d.status = SENT
        d.sent_at = utc_now()
        d.provider_message_id = provider_message_id
        d.resolution = resolution
        d.last_error_category = d.last_error_code = d.last_error_detail = None
        _release(d)
        if draft.status in (draft_service.SENDING, draft_service.APPROVED):
            draft.status = draft_service.SENT
        _audit(
            session,
            d,
            "delivery_sent",
            provider_message_id=provider_message_id,
            resolution=resolution,
            provider_accepted=True,
            delivery_confirmed=False,  # acceptance only; no delivery receipt is claimed
        )
        await session.commit()
        return True


async def _finish_failed(
    session_factory: SessionFactory,
    delivery_id: uuid.UUID,
    worker_id: Optional[str],
    kind: ErrorKind,
    code: str,
    message: str,
    from_states: Tuple[str, ...] = (SENDING,),
    resolution: Optional[str] = None,
) -> Optional[str]:
    """TRANSIENT -> retry with backoff (bounded). PERMANENT -> terminal. Both need a person only when terminal."""
    async with session_factory() as session:
        pair = await _lock_pair(session, delivery_id)
        if pair is None:
            return None
        draft, d = pair
        if d.status not in from_states or (worker_id is not None and d.claimed_by != worker_id):
            return None
        _set_error(d, kind.value, code, message)
        d.resolution = resolution
        _release(d)
        if kind == ErrorKind.PERMANENT:
            d.status = FAILED_PERMANENT
            _fail_draft(draft)
            _audit(session, d, "delivery_failed_permanent", reason=code)
        elif d.attempt_count >= d.max_attempts:
            _set_error(d, kind.value, "retries_exhausted", f"Gave up after {d.attempt_count} attempts ({code})")
            d.status = FAILED_PERMANENT
            _fail_draft(draft)
            _audit(session, d, "delivery_failed_permanent", reason="retries_exhausted", last_code=code)
        else:
            d.status = FAILED_RETRYABLE
            d.next_attempt_at = utc_now() + _backoff(d.attempt_count)
            d.enqueued_at = None
            _audit(session, d, "delivery_failed_retryable", reason=code, next_attempt_at=d.next_attempt_at.isoformat())
        await session.commit()
        return d.status


async def _finish_unknown(
    session_factory: SessionFactory, delivery_id: uuid.UUID, worker_id: Optional[str], code: str, message: str
) -> bool:
    async with session_factory() as session:
        pair = await _lock_pair(session, delivery_id)
        if pair is None:
            return False
        _, d = pair
        if d.status != SENDING or (worker_id is not None and d.claimed_by != worker_id):
            return False
        d.status = UNKNOWN_OUTCOME
        d.lease_expires_at = None  # claimed_by is kept so a late, genuine success report can still be recorded
        _set_error(d, ErrorKind.UNCERTAIN.value, code, message)
        _audit(session, d, "delivery_unknown_outcome", reason=code)
        await session.commit()
        return True


async def _resolve_uncertain(
    session_factory: SessionFactory,
    provider: OutboundProvider,
    work: ClaimedWork,
    worker_id: str,
    started_at: datetime,
    code: str,
    message: str,
) -> str:
    """After an ambiguous send: ask the provider. Never resend on a guess."""
    account = work.account
    if provider.supports_reconciliation(account):
        try:
            outcome = await provider.reconcile(work.request(with_body=False))
        except Exception:  # noqa: BLE001 - a failing lookup is simply inconclusive
            outcome = None
        if outcome is not None and outcome.status == ReconcileStatus.FOUND and outcome.provider_message_id:
            await _finish_sent(
                session_factory, work.delivery_id, worker_id, outcome.provider_message_id, "auto_reconciled"
            )
            return "sent_after_reconcile"
        if (
            outcome is not None
            and outcome.status == ReconcileStatus.NOT_FOUND
            and provider.reconciliation_is_authoritative(account)
        ):
            if (utc_now() - started_at).total_seconds() >= settings.OUTBOUND_RECONCILE_GRACE_SECONDS:
                await _finish_failed(
                    session_factory,
                    work.delivery_id,
                    worker_id,
                    ErrorKind.TRANSIENT,
                    "confirmed_not_accepted",
                    "The provider confirmed it did not accept the message; a resend is safe",
                    resolution="auto_reconciled",
                )
                return "retry_after_reconcile"
    await _finish_unknown(session_factory, work.delivery_id, worker_id, code, message)
    return "unknown_outcome"


async def process_delivery(
    session_factory: SessionFactory,
    delivery_id: uuid.UUID,
    worker_id: str,
    provider_factory: ProviderFactory = get_provider,
) -> str:
    """
    One attempt at one delivery (the body of the Celery task). Returns a short outcome label for logs and tests.
    Only exceptions derived from Exception are treated as provider results; a process-level failure (BaseException)
    deliberately leaves the row where it is so the recovery rules decide, never a guess.
    """
    work = await _claim(session_factory, delivery_id, worker_id, provider_factory)
    if work is None:
        return "skipped"
    started_at = await _mark_sending(session_factory, work, worker_id)
    if started_at is None:
        return "lost_claim"  # the claim went stale and was released; nothing was sent

    try:
        provider = provider_factory(work.provider_name)
        result = await asyncio.wait_for(
            provider.send(work.request()), timeout=settings.OUTBOUND_PROVIDER_TIMEOUT_SECONDS
        )
    except ProviderError as err:
        if err.kind == ErrorKind.UNCERTAIN:
            return await _resolve_uncertain(
                session_factory,
                provider_factory(work.provider_name),
                work,
                worker_id,
                started_at,
                err.code,
                err.safe_message,
            )
        final = await _finish_failed(session_factory, delivery_id, worker_id, err.kind, err.code, err.safe_message)
        return "failed_permanent" if final == FAILED_PERMANENT else "failed_retryable"
    except asyncio.TimeoutError:
        return await _resolve_uncertain(
            session_factory,
            provider_factory(work.provider_name),
            work,
            worker_id,
            started_at,
            "provider_timeout",
            "The provider did not answer in time; outcome unknown",
        )
    except Exception as exc:  # noqa: BLE001 - anything unexpected after the request started is ambiguous
        logger.error(f"Unexpected error during outbound send {delivery_id}: {type(exc).__name__}")
        return await _resolve_uncertain(
            session_factory,
            provider_factory(work.provider_name),
            work,
            worker_id,
            started_at,
            "unexpected_error",
            f"Unexpected {type(exc).__name__} during send; outcome unknown",
        )

    recorded = await _finish_sent(session_factory, delivery_id, worker_id, result.provider_message_id, None)
    return "sent" if recorded else "sent_not_recorded"


# ============================================================================ recovery


async def reconcile_unknown(
    session_factory: SessionFactory, provider_factory: ProviderFactory = get_provider, limit: int = 50
) -> Dict[str, int]:
    """Asks the provider about UNKNOWN_OUTCOME deliveries. Resolves only on a definite answer; never resends blindly."""
    resolved = {"sent": 0, "retry": 0, "still_unknown": 0}
    async with session_factory() as session:
        ids = list(
            (
                await session.execute(
                    select(OutboundDelivery.id)
                    .where(OutboundDelivery.status == UNKNOWN_OUTCOME)
                    .order_by(OutboundDelivery.updated_at.asc())
                    .limit(limit)
                )
            ).scalars()
        )
    for delivery_id in ids:
        async with session_factory() as session:
            d = await session.get(OutboundDelivery, delivery_id)
            if d is None or d.status != UNKNOWN_OUTCOME or d.integration_id is None:
                continue
            account_row = await session.get(Integration, d.integration_id)
            if account_row is None or account_row.organization_id != d.organization_id:
                resolved["still_unknown"] += 1
                continue
            account = AccountRef(account_row.id, account_row.type, dict(account_row.config or {}))
            work = ClaimedWork(
                d.id, d.organization_id, d.draft_id, d.version_number, "", None, d.destination, d.channel,
                dict(d.provider_context or {}), d.idempotency_key, d.attempt_count, account, d.provider,
            )  # fmt: skip
            started = d.attempt_started_at
        try:
            provider = provider_factory(work.provider_name)
            if not provider.supports_reconciliation(account):
                resolved["still_unknown"] += 1
                continue
            outcome = await provider.reconcile(work.request(with_body=False))
        except Exception:  # noqa: BLE001
            resolved["still_unknown"] += 1
            continue
        if outcome.status == ReconcileStatus.FOUND and outcome.provider_message_id:
            if await _finish_sent(
                session_factory, delivery_id, None, outcome.provider_message_id, "auto_reconciled",
                from_states=(UNKNOWN_OUTCOME,),
            ):  # fmt: skip
                resolved["sent"] += 1
        elif (
            outcome.status == ReconcileStatus.NOT_FOUND
            and provider.reconciliation_is_authoritative(account)
            and started is not None
            and (utc_now() - started).total_seconds() >= settings.OUTBOUND_RECONCILE_GRACE_SECONDS
        ):
            if await _finish_failed(
                session_factory, delivery_id, None, ErrorKind.TRANSIENT, "confirmed_not_accepted",
                "The provider confirmed it did not accept the message; a resend is safe",
                from_states=(UNKNOWN_OUTCOME,), resolution="auto_reconciled",
            ):  # fmt: skip
                resolved["retry"] += 1
        else:
            resolved["still_unknown"] += 1
    return resolved


async def recover_stale(
    session_factory: SessionFactory, provider_factory: ProviderFactory = get_provider, now: Optional[datetime] = None
) -> Dict[str, Any]:
    """
    - CLAIMED with an expired lease: the provider was never called, so release the claim and retry.
    - SENDING with an expired lease: the worker died around the provider call, so the outcome is UNKNOWN_OUTCOME.
    - UNKNOWN_OUTCOME: reconcile with the provider when it supports that. Never resend on a guess.
    Each transition is a compare-and-swap on the row's current state, so concurrent recoveries cannot double-apply.
    """
    now = now or utc_now()
    released = 0
    marked_unknown = 0
    async with session_factory() as session:
        stale = (
            await session.execute(
                select(OutboundDelivery.id, OutboundDelivery.status, OutboundDelivery.claimed_by).where(
                    OutboundDelivery.status.in_([CLAIMED, SENDING]),
                    OutboundDelivery.lease_expires_at.is_not(None),
                    OutboundDelivery.lease_expires_at < now,
                )
            )
        ).all()
    for delivery_id, state, claimed_by in stale:
        async with session_factory() as session:
            if state == CLAIMED:
                values: Dict[str, Any] = {
                    "status": PENDING,
                    "claimed_by": None,
                    "lease_expires_at": None,
                    "enqueued_at": None,
                }
            else:
                values = {"status": UNKNOWN_OUTCOME, "lease_expires_at": None}
            cas = await session.execute(
                update(OutboundDelivery)
                .where(
                    OutboundDelivery.id == delivery_id,
                    OutboundDelivery.status == state,
                    OutboundDelivery.claimed_by == claimed_by,
                    OutboundDelivery.lease_expires_at < now,
                )
                .values(**values)
            )
            if cas.rowcount != 1:  # type: ignore[attr-defined]
                await session.rollback()
                continue
            d = await session.get(OutboundDelivery, delivery_id)
            assert d is not None
            if state == CLAIMED:
                released += 1
                _audit(session, d, "stale_claim_released", previous_worker=claimed_by)
            else:
                marked_unknown += 1
                _set_error(
                    d,
                    ErrorKind.UNCERTAIN.value,
                    "worker_lost_during_send",
                    "The worker stopped during the send; outcome unknown",
                )
                _audit(
                    session, d, "delivery_unknown_outcome", reason="worker_lost_during_send", previous_worker=claimed_by
                )
            await session.commit()
    reconciled = await reconcile_unknown(session_factory, provider_factory)
    return {"released_claims": released, "marked_unknown": marked_unknown, "reconciled": reconciled}


# ============================================================================ operator actions


class ActionRefused(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


async def _locked(session: AsyncSession, organization_id: uuid.UUID, delivery_id: uuid.UUID):
    pair = await _lock_pair(session, delivery_id)
    if pair is None or pair[1].organization_id != organization_id:
        return None
    return pair


async def cancel_delivery(
    session: AsyncSession, organization_id: uuid.UUID, delivery_id: uuid.UUID, user_id: uuid.UUID
) -> Optional[OutboundDelivery]:
    pair = await _locked(session, organization_id, delivery_id)
    if pair is None:
        return None
    draft, d = pair
    if d.status not in DISPATCHABLE_STATES:
        raise ActionRefused(f"A delivery that is {d.status.lower()} cannot be cancelled")
    d.status = CANCELLED
    _release(d)
    _set_error(d, "operator", "cancelled_by_user", "Cancelled by an operator")
    if d.consumed_at is not None:
        _fail_draft(draft)
    _audit(session, d, "delivery_cancelled", user_id=user_id, reason="cancelled_by_user")
    return d


async def retry_now(
    session: AsyncSession, organization_id: uuid.UUID, delivery_id: uuid.UUID, user_id: uuid.UUID
) -> Optional[OutboundDelivery]:
    pair = await _locked(session, organization_id, delivery_id)
    if pair is None:
        return None
    _, d = pair
    if d.status != FAILED_RETRYABLE:
        raise ActionRefused(f"Only a delivery waiting to retry can be retried now (it is {d.status.lower()})")
    d.next_attempt_at = utc_now()
    d.enqueued_at = None
    _audit(session, d, "delivery_retry_requested", user_id=user_id)
    return d


async def resolve_unknown(
    session: AsyncSession,
    organization_id: uuid.UUID,
    delivery_id: uuid.UUID,
    user_id: uuid.UUID,
    outcome: str,
    provider_message_id: Optional[str],
) -> Optional[OutboundDelivery]:
    """A person checked with the provider. 'SENT' records acceptance; 'NOT_SENT' explicitly authorises one resend."""
    pair = await _locked(session, organization_id, delivery_id)
    if pair is None:
        return None
    draft, d = pair
    if d.status != UNKNOWN_OUTCOME:
        raise ActionRefused(f"Only an unknown outcome can be resolved manually (it is {d.status.lower()})")
    if outcome == "SENT":
        d.status = SENT
        d.sent_at = utc_now()
        d.provider_message_id = provider_message_id or None
        d.resolution = "manual_sent"
        _release(d)
        if draft.status in (draft_service.SENDING, draft_service.APPROVED):
            draft.status = draft_service.SENT
        _audit(
            session, d, "delivery_reconciled", user_id=user_id, resolution="manual_sent",
            provider_accepted=True, delivery_confirmed=False,
        )  # fmt: skip
    else:
        d.status = FAILED_RETRYABLE
        d.max_attempts = max(d.max_attempts, d.attempt_count + 1)  # one extra attempt, explicitly authorised
        d.next_attempt_at = utc_now()
        d.enqueued_at = None
        d.resolution = "manual_not_sent"
        _release(d)
        _audit(session, d, "delivery_reconciled", user_id=user_id, resolution="manual_not_sent")
    return d
