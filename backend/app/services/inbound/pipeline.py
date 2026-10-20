"""
Channel-agnostic inbound pipeline.

Adapters (portfolio form now; Gmail and WhatsApp later) convert provider events into a
NormalizedMessage and call `ingest_message`. Everything after that is shared:
dedup, persistence, tenant binding and starting the configured workflow.
"""

import secrets
import uuid
from dataclasses import dataclass
from typing import Any, Callable, Dict, Optional

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.logging import logger
from app.engine.sanitizer import sanitize_payload
from app.models.audit_log import AuditLog
from app.models.base import utc_now
from app.models.conversation import Conversation, InboundMessage
from app.models.integration import Integration
from app.models.workflow import Workflow, WorkflowVersion
from app.schemas.inbound import NormalizedMessage
from app.services.webhook_service import get_or_create_idempotent_run

PROCESSING_RECEIVED = "RECEIVED"
PROCESSING_QUEUED = "QUEUED"
PROCESSING_NO_WORKFLOW = "NO_WORKFLOW"


@dataclass
class IngestResult:
    status: str  # accepted | duplicate
    message_id: uuid.UUID
    workflow_run_id: Optional[uuid.UUID]
    correlation_id: Optional[str]


def _default_dispatch(**kwargs: Any) -> None:
    from app.workers.tasks import execute_workflow_run

    execute_workflow_run.delay(**kwargs)


async def _resolve_active_workflow(
    session: AsyncSession, integration: Integration
) -> Optional[tuple[Workflow, WorkflowVersion]]:
    """Returns the workflow configured on the integration, only if it belongs to the same org and is live."""
    raw_id = (integration.config or {}).get("workflow_id")
    if not raw_id:
        return None
    try:
        workflow_id = uuid.UUID(str(raw_id))
    except ValueError:
        return None

    wf = (
        await session.execute(
            select(Workflow).where(
                Workflow.id == workflow_id,
                Workflow.organization_id == integration.organization_id,
            )
        )
    ).scalar_one_or_none()
    if not wf or wf.status != "ACTIVE" or not wf.active_version_id:
        return None
    ver = (
        await session.execute(
            select(WorkflowVersion).where(
                WorkflowVersion.id == wf.active_version_id,
                WorkflowVersion.workflow_id == wf.id,
            )
        )
    ).scalar_one_or_none()
    if not ver or ver.status != "PUBLISHED":
        return None
    return wf, ver


async def _get_or_create_conversation(
    session: AsyncSession, integration: Integration, msg: NormalizedMessage
) -> Conversation:
    where = (
        Conversation.organization_id == integration.organization_id,
        Conversation.integration_id == integration.id,
        Conversation.channel == msg.channel,
        Conversation.external_conversation_id == msg.external_conversation_id,
    )
    existing = (await session.execute(select(Conversation).where(*where))).scalar_one_or_none()
    if existing:
        return existing
    try:
        async with session.begin_nested():
            conv = Conversation(
                organization_id=integration.organization_id,
                integration_id=integration.id,
                channel=msg.channel,
                external_conversation_id=msg.external_conversation_id,
                sender_identity=msg.sender_identity,
            )
            session.add(conv)
            await session.flush()
            return conv
    except IntegrityError:
        return (await session.execute(select(Conversation).where(*where))).scalar_one()


def build_trigger_payload(msg: NormalizedMessage, message: InboundMessage) -> Dict[str, Any]:
    """Payload handed to the workflow. `message` and `subject` keys match what AI steps already read."""
    return sanitize_payload(
        {
            "channel": msg.channel,
            "inbound_message_id": str(message.id),
            "conversation_id": str(message.conversation_id),
            "sender_name": msg.sender_name,
            "sender_address": msg.sender_address,
            "subject": msg.subject,
            "message": msg.text_content,
            **msg.extra,
        }
    )


async def ingest_message(
    session_factory: async_sessionmaker,
    integration: Integration,
    msg: NormalizedMessage,
    dispatch: Optional[Callable[..., None]] = None,
) -> IngestResult:
    """
    Persist one inbound message exactly once and start its workflow.

    Safe to call repeatedly for the same provider message: the unique
    (organization, channel, external_message_id) key makes the second call a no-op,
    and the workflow run is itself idempotency-keyed so a crash between the two
    steps is healed by the next delivery.
    """
    dispatch = dispatch or _default_dispatch
    org_id = integration.organization_id
    duplicate = False

    async with session_factory() as session:
        conv = await _get_or_create_conversation(session, integration, msg)
        try:
            async with session.begin_nested():
                message = InboundMessage(
                    organization_id=org_id,
                    conversation_id=conv.id,
                    integration_id=integration.id,
                    channel=msg.channel,
                    external_message_id=msg.external_message_id,
                    sender_name=msg.sender_name,
                    sender_address=msg.sender_address,
                    subject=msg.subject,
                    text_content=msg.text_content,
                    provider_metadata=msg.provider_metadata or None,
                    received_at=msg.received_at or utc_now(),
                    processing_status=PROCESSING_RECEIVED,
                    correlation_id=f"corr_{secrets.token_hex(16)}",
                )
                session.add(message)
                await session.flush()
        except IntegrityError:
            duplicate = True
            message = (
                await session.execute(
                    select(InboundMessage).where(
                        InboundMessage.organization_id == org_id,
                        InboundMessage.channel == msg.channel,
                        InboundMessage.external_message_id == msg.external_message_id,
                    )
                )
            ).scalar_one()

        if not duplicate:
            session.add(
                AuditLog(
                    organization_id=org_id,
                    user_id=None,
                    action="inbound.received",
                    resource_type="inbound_message",
                    resource_id=str(message.id),
                    details={"channel": msg.channel, "integration_id": str(integration.id)},
                )
            )
        await session.commit()

        # A previous delivery that already started a run is fully handled.
        if duplicate and message.workflow_run_id:
            return IngestResult("duplicate", message.id, message.workflow_run_id, message.correlation_id)

        resolved = await _resolve_active_workflow(session, integration)
        if not resolved:
            message.processing_status = PROCESSING_NO_WORKFLOW
            await session.commit()
            logger.warning(f"Inbound message {message.id} stored; no active workflow configured on integration")
            return IngestResult("duplicate" if duplicate else "accepted", message.id, None, message.correlation_id)
        workflow, version = resolved
        trigger_payload = build_trigger_payload(msg, message)
        message_id = message.id
        correlation_id = message.correlation_id or f"corr_{secrets.token_hex(16)}"

    run, is_winner, _ = await get_or_create_idempotent_run(
        session_factory=session_factory,
        organization_id=org_id,
        workflow_id=workflow.id,
        version_id=version.id,
        clean_payload=trigger_payload,
        correlation_id=correlation_id,
        client_idempotency_key=f"{msg.channel}:{msg.external_message_id}",
        operation_scope="inbound",
        trigger_type="WEBHOOK",
    )

    async with session_factory() as session:
        row = await session.get(InboundMessage, message_id)
        if row and row.workflow_run_id is None:
            row.workflow_run_id = run.id
            row.processing_status = PROCESSING_QUEUED
            await session.commit()

    if is_winner:
        dispatch(
            organization_id=str(org_id),
            run_id=str(run.id),
            version_id=str(version.id),
            trigger_payload=trigger_payload,
            correlation_id=run.correlation_id,
        )

    return IngestResult("duplicate" if duplicate else "accepted", message_id, run.id, run.correlation_id)
