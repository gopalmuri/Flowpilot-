"""
Recovery for approvals that were decided but whose workflow was never driven on (process died between the
decision commit and the DAG traversal).

A decision stamps `resume_claimed_at` in the same transaction as the decision, and `resume_completed_at` once the
run has been driven on. A decided approval with a stale claim and no completion is therefore a lost resume.
Each recovery takes the row with a compare-and-swap on the claim timestamp, so when several workers recover at once
exactly one of them resumes a given approval, and a resume that already completed is never repeated.
"""

import uuid
from datetime import timedelta
from typing import Callable, List

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import logger
from app.engine.workflow_engine import WorkflowEngine
from app.models.approval import ApprovalRequest
from app.models.base import utc_now
from app.models.workflow_run import WorkflowRun
from app.schemas.execution import WorkflowRunStatus


async def recover_stalled_resumes(
    session_factory: Callable[[], AsyncSession],
    older_than_seconds: int = 300,
    limit: int = 50,
) -> List[uuid.UUID]:
    """Resumes runs whose approval decision committed but whose traversal never completed. Returns recovered ids."""
    cutoff = utc_now() - timedelta(seconds=older_than_seconds)
    async with session_factory() as session:
        candidates = (
            await session.execute(
                select(ApprovalRequest.id, ApprovalRequest.organization_id, ApprovalRequest.resume_claimed_at)
                .where(
                    ApprovalRequest.status.in_(["APPROVED", "REJECTED"]),
                    ApprovalRequest.resume_claimed_at.is_not(None),
                    ApprovalRequest.resume_completed_at.is_(None),
                    ApprovalRequest.resume_claimed_at <= cutoff,
                )
                .order_by(ApprovalRequest.resume_claimed_at.asc())
                .limit(limit)
            )
        ).all()

    engine = WorkflowEngine(session_factory=session_factory)
    recovered: List[uuid.UUID] = []
    for approval_id, organization_id, old_claim in candidates:
        async with session_factory() as session:
            claim = await session.execute(
                update(ApprovalRequest)
                .where(
                    ApprovalRequest.id == approval_id,
                    ApprovalRequest.resume_claimed_at == old_claim,
                    ApprovalRequest.resume_completed_at.is_(None),
                )
                .values(resume_claimed_at=utc_now())
            )
            await session.commit()
            if claim.rowcount != 1:  # type: ignore[attr-defined]
                continue  # another worker took it, or it completed meanwhile
            approval = await session.get(ApprovalRequest, approval_id)
            run = await session.get(WorkflowRun, approval.workflow_run_id) if approval else None
            if approval is None or run is None:
                continue
            run_id, version_id = run.id, run.workflow_version_id
            payload = dict(run.trigger_payload or {})
            needs_traversal = run.status == WorkflowRunStatus.RUNNING.value

        if needs_traversal:
            logger.warning(f"Recovering stalled approval resume {approval_id} (run {run_id})")
            await engine._run_dag_traversal(
                organization_id=organization_id, run_id=run_id, version_id=version_id, trigger_payload=payload
            )
        await engine.mark_resume_completed(organization_id, approval_id, recovered=True)
        recovered.append(approval_id)
    return recovered
