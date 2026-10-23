import asyncio
import concurrent.futures
import os
import socket
import uuid
from typing import Any, Dict, Optional

import httpx
from redis.exceptions import RedisError
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings
from app.core.logging import logger
from app.engine.recovery import recover_stalled_resumes
from app.engine.sanitizer import sanitize_error_message, sanitize_payload
from app.engine.workflow_engine import WorkflowEngine
from app.models.base import utc_now
from app.models.workflow import Workflow
from app.models.workflow_run import WorkflowRun
from app.schemas.execution import WorkflowRunStatus
from app.services.outbound import delivery as outbound_delivery
from app.services.webhook_service import get_or_create_idempotent_run
from app.workers.celery_app import celery_app


def get_worker_session_maker():
    """Creates an isolated NullPool async session maker and engine for a worker task run."""
    engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
    session_maker = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    return engine, session_maker


def run_coroutine_sync(coro):
    """
    Executes an async coroutine synchronously.
    Handles execution safely both outside an event loop (standard Celery worker)
    and inside an active running loop (eager execution in tests or requests).
    """
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(asyncio.run, coro)
            return future.result()
    else:
        return asyncio.run(coro)


# ==============================================================================
# 1. Asynchronous Workflow DAG Execution Task
# ==============================================================================


async def _async_execute_workflow_run(
    organization_id: str,
    run_id: str,
    version_id: str,
    trigger_payload: Dict[str, Any],
    correlation_id: Optional[str] = None,
) -> Dict[str, Any]:
    org_uuid = uuid.UUID(organization_id)
    run_uuid = uuid.UUID(run_id)
    ver_uuid = uuid.UUID(version_id)
    clean_payload = sanitize_payload(trigger_payload)

    engine_db, session_maker = get_worker_session_maker()
    try:
        # Ensure run exists and transition PENDING -> RUNNING
        async with session_maker() as session:
            run = await session.get(WorkflowRun, run_uuid)
            if not run:
                logger.error(f"[Celery] Workflow run {run_id} not found")
                return {"run_id": run_id, "status": "FAILED", "error_message": "Workflow run not found"}

            if run.status == WorkflowRunStatus.PENDING.value:
                run.status = WorkflowRunStatus.RUNNING.value
                run.started_at = utc_now()
                await session.commit()

        engine = WorkflowEngine(session_factory=session_maker)
        try:
            final_run = await engine.execute_run_dag(
                organization_id=org_uuid,
                run_id=run_uuid,
                version_id=ver_uuid,
                trigger_payload=clean_payload,
            )
            return {
                "run_id": str(final_run.id),
                "status": final_run.status,
                "completed_at": final_run.completed_at.isoformat() if final_run.completed_at else None,
                "error_message": final_run.error_message,
            }
        except (OperationalError, RedisError, httpx.RequestError) as transient_err:
            logger.warning(f"[Celery] Transient error executing run {run_id}: {transient_err}. Retrying...")
            raise
        except Exception as exc:
            logger.exception(f"[Celery] Fatal error executing run {run_id}: {exc}")
            sanitized = sanitize_error_message(str(exc))
            async with session_maker() as session:
                run = await session.get(WorkflowRun, run_uuid)
                if run and run.status not in (
                    WorkflowRunStatus.COMPLETED.value,
                    WorkflowRunStatus.FAILED.value,
                    WorkflowRunStatus.CANCELLED.value,
                ):
                    run.status = WorkflowRunStatus.FAILED.value
                    run.error_message = sanitized
                    run.completed_at = utc_now()
                    await session.commit()
            return {
                "run_id": str(run_id),
                "status": "FAILED",
                "error_message": sanitized,
            }
    finally:
        await engine_db.dispose()


@celery_app.task(
    name="tasks.execute_workflow_run",
    bind=True,
    autoretry_for=(OperationalError, RedisError, httpx.RequestError),
    retry_backoff=True,
    retry_backoff_max=60,
    retry_jitter=True,
    max_retries=3,
)
def execute_workflow_run(
    self,
    organization_id: str,
    run_id: str,
    version_id: str,
    trigger_payload: Dict[str, Any],
    correlation_id: Optional[str] = None,
) -> Dict[str, Any]:
    logger.info(f"[Celery] Starting execution task for run {run_id}")
    return run_coroutine_sync(
        _async_execute_workflow_run(
            organization_id=organization_id,
            run_id=run_id,
            version_id=version_id,
            trigger_payload=trigger_payload,
            correlation_id=correlation_id,
        )
    )


# ==============================================================================
# 2. Asynchronous Human Approval Resumption Task
# ==============================================================================


async def _async_resume_workflow_run(
    organization_id: str,
    run_id: str,
    reviewer_id: Optional[str] = None,
    approved: bool = True,
    comment: Optional[str] = None,
    approval_id: Optional[str] = None,
) -> Dict[str, Any]:
    org_uuid = uuid.UUID(organization_id)
    run_uuid = uuid.UUID(run_id)
    rev_uuid = uuid.UUID(reviewer_id) if reviewer_id else None
    app_uuid = uuid.UUID(approval_id) if approval_id else None

    engine_db, session_maker = get_worker_session_maker()
    try:
        engine = WorkflowEngine(session_factory=session_maker)
        try:
            final_run = await engine.resume_run(
                organization_id=org_uuid,
                run_id=run_uuid,
                reviewer_id=rev_uuid,
                approved=approved,
                comment=comment,
                approval_id=app_uuid,
            )
            return {
                "run_id": str(final_run.id),
                "status": final_run.status,
                "completed_at": final_run.completed_at.isoformat() if final_run.completed_at else None,
                "error_message": final_run.error_message,
            }
        except (OperationalError, RedisError, httpx.RequestError) as transient_err:
            logger.warning(f"[Celery] Transient error resuming run {run_id}: {transient_err}. Retrying...")
            raise
        except Exception as exc:
            logger.exception(f"[Celery] Fatal error resuming run {run_id}: {exc}")
            return {
                "run_id": str(run_id),
                "status": "FAILED",
                "error_message": sanitize_error_message(str(exc)),
            }
    finally:
        await engine_db.dispose()


@celery_app.task(
    name="tasks.resume_workflow_run",
    bind=True,
    autoretry_for=(OperationalError, RedisError, httpx.RequestError),
    retry_backoff=True,
    retry_backoff_max=60,
    retry_jitter=True,
    max_retries=3,
)
def resume_workflow_run(
    self,
    organization_id: str,
    run_id: str,
    reviewer_id: Optional[str] = None,
    approved: bool = True,
    comment: Optional[str] = None,
    approval_id: Optional[str] = None,
) -> Dict[str, Any]:
    logger.info(f"[Celery] Starting resumption task for run {run_id}, approved={approved}")
    return run_coroutine_sync(
        _async_resume_workflow_run(
            organization_id=organization_id,
            run_id=run_id,
            reviewer_id=reviewer_id,
            approved=approved,
            comment=comment,
            approval_id=approval_id,
        )
    )


# ==============================================================================
# 3. Asynchronous Webhook Event Intake Task
# ==============================================================================


async def _async_process_webhook_event(
    organization_id: str,
    workflow_id: str,
    webhook_key: str,
    payload: Dict[str, Any],
    correlation_id: Optional[str] = None,
    client_idempotency_key: Optional[str] = None,
) -> Dict[str, Any]:
    org_uuid = uuid.UUID(organization_id)
    wf_uuid = uuid.UUID(workflow_id)
    clean_payload = sanitize_payload(payload)

    engine_db, session_maker = get_worker_session_maker()
    try:
        async with session_maker() as session:
            wf = await session.get(Workflow, wf_uuid)
            if not wf or wf.organization_id != org_uuid or wf.status != "ACTIVE" or not wf.active_version_id:
                logger.error(f"[Celery] Invalid workflow for webhook processing: {workflow_id}")
                return {"error": "Invalid workflow", "status": "FAILED"}
            ver_id = wf.active_version_id

        run, is_winner, is_idempotent = await get_or_create_idempotent_run(
            session_factory=session_maker,
            organization_id=org_uuid,
            workflow_id=wf_uuid,
            version_id=ver_id,
            clean_payload=clean_payload,
            correlation_id=correlation_id or f"corr_{uuid.uuid4().hex[:16]}",
            client_idempotency_key=client_idempotency_key,
            operation_scope="webhook",
            trigger_type="WEBHOOK",
        )

        if is_winner:
            engine = WorkflowEngine(session_factory=session_maker)
            run = await engine.execute_run_dag(
                organization_id=org_uuid,
                run_id=run.id,
                version_id=ver_id,
                trigger_payload=clean_payload,
            )

        return {
            "run_id": str(run.id),
            "status": run.status,
            "is_idempotent": is_idempotent,
            "completed_at": run.completed_at.isoformat() if run.completed_at else None,
            "error_message": run.error_message,
        }
    finally:
        await engine_db.dispose()


@celery_app.task(
    name="tasks.process_webhook_event",
    bind=True,
    autoretry_for=(OperationalError, RedisError, httpx.RequestError),
    retry_backoff=True,
    retry_backoff_max=60,
    retry_jitter=True,
    max_retries=3,
)
def process_webhook_event(
    self,
    organization_id: str,
    workflow_id: str,
    webhook_key: str,
    payload: Dict[str, Any],
    correlation_id: Optional[str] = None,
    client_idempotency_key: Optional[str] = None,
) -> Dict[str, Any]:
    logger.info(f"[Celery] Processing webhook event for workflow {workflow_id}")
    return run_coroutine_sync(
        _async_process_webhook_event(
            organization_id=organization_id,
            workflow_id=workflow_id,
            webhook_key=webhook_key,
            payload=payload,
            correlation_id=correlation_id,
            client_idempotency_key=client_idempotency_key,
        )
    )


# ==============================================================================
# Recovery of decided approvals whose workflow resume was lost (worker/process died)
# ==============================================================================


async def _async_recover_stalled_approvals(older_than_seconds: int) -> Dict[str, Any]:
    engine_db, session_maker = get_worker_session_maker()
    try:
        recovered = await recover_stalled_resumes(session_maker, older_than_seconds=older_than_seconds)
        return {"recovered": [str(i) for i in recovered]}
    finally:
        await engine_db.dispose()


@celery_app.task(name="tasks.recover_stalled_approvals")
def recover_stalled_approvals(older_than_seconds: int = 300) -> Dict[str, Any]:
    return run_coroutine_sync(_async_recover_stalled_approvals(older_than_seconds))


# ==============================================================================
# Outbound delivery (outbox relay, delivery attempts, stale-state recovery)
# ==============================================================================


def _worker_id() -> str:
    return f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}"


async def _async_deliver(delivery_id: str) -> str:
    engine_db, session_maker = get_worker_session_maker()
    try:
        return await outbound_delivery.process_delivery(session_maker, uuid.UUID(delivery_id), _worker_id())
    finally:
        await engine_db.dispose()


@celery_app.task(name="tasks.deliver_outbound")
def deliver_outbound(delivery_id: str) -> str:
    """One delivery attempt. Safe to run twice for the same id: only one run can claim the delivery."""
    return run_coroutine_sync(_async_deliver(delivery_id))


async def _async_dispatch() -> list:
    engine_db, session_maker = get_worker_session_maker()
    try:
        ids = await outbound_delivery.dispatch_due(session_maker, enqueue=lambda i: deliver_outbound.delay(i))
        return [str(i) for i in ids]
    finally:
        await engine_db.dispose()


@celery_app.task(name="tasks.dispatch_outbound_deliveries")
def dispatch_outbound_deliveries() -> list:
    """Outbox relay: enqueue committed deliveries that are due (or whose earlier enqueue was lost)."""
    return run_coroutine_sync(_async_dispatch())


async def _async_recover_deliveries() -> Dict[str, Any]:
    engine_db, session_maker = get_worker_session_maker()
    try:
        return await outbound_delivery.recover_stale(session_maker)
    finally:
        await engine_db.dispose()


@celery_app.task(name="tasks.recover_stale_deliveries")
def recover_stale_deliveries() -> Dict[str, Any]:
    """Releases stale claims, marks lost sends UNKNOWN_OUTCOME and reconciles them. Never resends on a guess."""
    return run_coroutine_sync(_async_recover_deliveries())


# ==============================================================================
# Gmail (mailbox sync, watch renewal) and scheduler heartbeat
# ==============================================================================


async def _async_sync_gmail(account_id: str) -> Dict[str, Any]:
    from app.services.gmail.client import default_client_factory
    from app.services.gmail.sync import sync_mailbox

    engine_db, session_maker = get_worker_session_maker()
    try:
        outcome = await sync_mailbox(session_maker, uuid.UUID(account_id), default_client_factory, _worker_id())
        return {
            "status": outcome.status,
            "ingested": outcome.ingested,
            "duplicates": outcome.duplicates,
            "skipped": outcome.skipped,
            "resynced": outcome.resynced,
            "error": outcome.error,
            "retry_after": outcome.retry_after,
        }
    finally:
        await engine_db.dispose()


@celery_app.task(name="tasks.sync_gmail_mailbox", bind=True, max_retries=5)
def sync_gmail_mailbox(self, account_id: str) -> Dict[str, Any]:
    """Syncs one mailbox from its stored historyId. Safe to run any number of times for the same mailbox."""
    result = run_coroutine_sync(_async_sync_gmail(account_id))
    if result["status"] == "retry":
        countdown = result.get("retry_after") or min(30 * (2**self.request.retries), 900)
        raise self.retry(countdown=countdown)
    return result


async def _async_sync_due_gmail() -> list:
    from app.services.gmail.sync import find_due_accounts

    engine_db, session_maker = get_worker_session_maker()
    try:
        ids = await find_due_accounts(session_maker)
        return [str(i) for i in ids]
    finally:
        await engine_db.dispose()


@celery_app.task(name="tasks.sync_due_gmail_mailboxes")
def sync_due_gmail_mailboxes() -> list:
    """Periodic: enqueue a sync for every mailbox with a pending notification or past its poll interval."""
    ids = run_coroutine_sync(_async_sync_due_gmail())
    for account_id in ids:
        sync_gmail_mailbox.delay(account_id)
    return ids


async def _async_renew_gmail_watches() -> Dict[str, int]:
    from app.services.gmail.client import default_client_factory
    from app.services.gmail.watch import renew_due_watches

    engine_db, session_maker = get_worker_session_maker()
    try:
        return await renew_due_watches(session_maker, default_client_factory)
    finally:
        await engine_db.dispose()


@celery_app.task(name="tasks.renew_gmail_watches")
def renew_gmail_watches() -> Dict[str, int]:
    """Periodic: re-register mailbox watches that are missing or close to expiring."""
    return run_coroutine_sync(_async_renew_gmail_watches())


@celery_app.task(name="tasks.scheduler_heartbeat")
def scheduler_heartbeat() -> str:
    """Periodic: proves the scheduler and a worker are both alive (read by the Gmail status endpoint)."""
    from app.core.scheduler_health import record_tick

    record_tick()
    return "ok"
