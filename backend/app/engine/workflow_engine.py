import asyncio
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.engine.base import StepExecutionContext, StepExecutionResult
from app.engine.registry import get_step_executor
from app.engine.sanitizer import sanitize_error_message, sanitize_payload
from app.models.approval import ApprovalRequest
from app.models.audit_log import AuditLog
from app.models.usage import UsageRecord
from app.models.workflow import Workflow, WorkflowVersion
from app.models.workflow_run import WorkflowRun, WorkflowStepRun
from app.models.workflow_step import WorkflowConnection, WorkflowStep
from app.schemas.execution import WorkflowRunStatus, WorkflowStepRunStatus
from app.services.workflow_validator import validate_workflow_dag


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class WorkflowEngine:
    """
    Deterministic, stateful, in-process workflow execution engine for FlowPilot.
    Executes published workflow versions in topological DAG order.
    Enforces discrete transaction boundaries per state transition.
    """

    default_step_timeout_seconds: float = 30.0

    def __init__(
        self,
        session_factory: Callable[[], AsyncSession],
        step_timeout_seconds: Optional[float] = None,
    ):
        self.session_factory = session_factory
        self.step_timeout_seconds = (
            step_timeout_seconds
            if step_timeout_seconds is not None
            else self.default_step_timeout_seconds
        )

    async def execute_new_run(
        self,
        organization_id: uuid.UUID,
        workflow_id: uuid.UUID,
        trigger_payload: Dict[str, Any],
        trigger_type: str = "MANUAL",
        correlation_id: Optional[str] = None,
    ) -> WorkflowRun:
        """
        Validates workflow eligibility and initiates a new workflow execution run.
        Transaction 1: Validates and creates WorkflowRun (PENDING -> RUNNING).
        Subsequent transactions: Steps executed deterministically.
        """
        corr_id = correlation_id or f"corr_{secrets.token_hex(16)}"
        clean_trigger_payload = sanitize_payload(trigger_payload)

        # -------------------------------------------------------------
        # Transaction 1: Pre-execution validation & Run Record Creation
        # -------------------------------------------------------------
        async with self.session_factory() as session:
            wf_stmt = select(Workflow).where(
                Workflow.id == workflow_id,
                Workflow.organization_id == organization_id,
            )
            wf = (await session.execute(wf_stmt)).scalar_one_or_none()
            if not wf:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Workflow not found",
                )

            if wf.status != "ACTIVE":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Cannot execute workflow in '{wf.status}' status. Workflow must be ACTIVE.",
                )

            if not wf.active_version_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Workflow has no active version configured",
                )

            ver_stmt = select(WorkflowVersion).where(
                WorkflowVersion.id == wf.active_version_id,
                WorkflowVersion.workflow_id == workflow_id,
            )
            ver = (await session.execute(ver_stmt)).scalar_one_or_none()
            if not ver or ver.status != "PUBLISHED":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Active workflow version is not in PUBLISHED status",
                )

            # Load steps and connections for DAG validation
            steps_stmt = select(WorkflowStep).where(WorkflowStep.workflow_version_id == ver.id)
            steps = (await session.execute(steps_stmt)).scalars().all()

            conns_stmt = select(WorkflowConnection).where(WorkflowConnection.workflow_version_id == ver.id)
            conns = (await session.execute(conns_stmt)).scalars().all()

            step_id_to_key = {s.id: s.step_key for s in steps}
            conn_dicts = [
                {
                    "source_step_key": step_id_to_key.get(c.source_step_id),
                    "target_step_key": step_id_to_key.get(c.target_step_id),
                    "condition_label": c.condition_label,
                }
                for c in conns
            ]

            val_res = validate_workflow_dag(list(steps), conn_dicts)
            if not val_res.valid:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail={"message": "Active version DAG validation failed", "errors": val_res.errors},
                )

            # Create initial WorkflowRun (PENDING -> RUNNING)
            run = WorkflowRun(
                organization_id=organization_id,
                workflow_id=workflow_id,
                workflow_version_id=ver.id,
                status=WorkflowRunStatus.RUNNING.value,
                trigger_type=trigger_type,
                trigger_payload=clean_trigger_payload,
                correlation_id=corr_id,
                started_at=utc_now(),
            )
            session.add(run)
            await session.commit()
            await session.refresh(run)
            run_id = run.id
            version_id = ver.id

        # -------------------------------------------------------------
        # Execute DAG traversal
        # -------------------------------------------------------------
        return await self._run_dag_traversal(
            organization_id=organization_id,
            run_id=run_id,
            version_id=version_id,
            trigger_payload=clean_trigger_payload,
        )

    async def execute_run_dag(
        self,
        organization_id: uuid.UUID,
        run_id: uuid.UUID,
        version_id: uuid.UUID,
        trigger_payload: Dict[str, Any],
    ) -> WorkflowRun:
        """
        Executes DAG traversal for an already initialized and committed WorkflowRun.
        Ensures execution ownership: only invoked by the winning execution.
        """
        clean_trigger_payload = sanitize_payload(trigger_payload)
        return await self._run_dag_traversal(
            organization_id=organization_id,
            run_id=run_id,
            version_id=version_id,
            trigger_payload=clean_trigger_payload,
        )

    async def resume_run(
        self,
        organization_id: uuid.UUID,
        run_id: uuid.UUID,
        reviewer_id: Optional[uuid.UUID] = None,
        approved: bool = True,
        comment: Optional[str] = None,
        approval_id: Optional[uuid.UUID] = None,
    ) -> WorkflowRun:
        """
        Resumes a paused workflow run upon human approval or rejection.
        Strictly follows the 9-step decision resolution sequence with row-locks:
        1. Acquire WorkflowRun row lock
        2. Acquire ApprovalRequest row lock
        3. Perform lazy expiration check
        4. Check already APPROVED (repeat approve -> 200 OK idempotent, reject -> 409)
        5. Check already REJECTED (repeat reject -> 200 OK idempotent, approve -> 409)
        6. Check already CANCELLED or EXPIRED -> 409
        7. If PENDING: if WorkflowRun is terminal -> 409; otherwise execute state transition
        8. Commit the approval decision / state transition
        9. Initiate DAG traversal only on winning transition; idempotent repeats never traverse
        """
        async with self.session_factory() as session:
            # 1. Acquire WorkflowRun row lock
            run_stmt = (
                select(WorkflowRun)
                .where(
                    WorkflowRun.id == run_id,
                    WorkflowRun.organization_id == organization_id,
                )
                .with_for_update()
            )
            run = (await session.execute(run_stmt)).scalar_one_or_none()
            if not run:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow run not found")

            # 2. Acquire ApprovalRequest row lock
            if approval_id:
                app_stmt = (
                    select(ApprovalRequest)
                    .where(
                        ApprovalRequest.id == approval_id,
                        ApprovalRequest.organization_id == organization_id,
                    )
                    .with_for_update()
                )
            else:
                app_stmt = (
                    select(ApprovalRequest)
                    .where(
                        ApprovalRequest.workflow_run_id == run_id,
                        ApprovalRequest.organization_id == organization_id,
                    )
                    .order_by(ApprovalRequest.created_at.desc())
                    .with_for_update()
                )
            approval = (await session.execute(app_stmt)).scalars().first()
            if not approval:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Approval request not found")

            # 3. Perform lazy expiration check
            timeout_hours = (approval.payload_snapshot or {}).get("approval_context", {}).get("timeout_hours", 24)
            created_at = approval.created_at
            if created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=timezone.utc)

            if approval.status == "PENDING" and (created_at + timedelta(hours=timeout_hours)) <= utc_now():
                approval.status = "EXPIRED"
                approval.resolved_at = utc_now()

                run.status = WorkflowRunStatus.FAILED.value
                run.error_message = f"Approval request expired after {timeout_hours} hours"
                run.completed_at = utc_now()

                step_run_stmt = select(WorkflowStepRun).where(
                    WorkflowStepRun.workflow_run_id == run.id,
                    WorkflowStepRun.step_id == approval.step_id,
                    WorkflowStepRun.status == WorkflowStepRunStatus.PAUSED.value,
                )
                paused_step_run = (await session.execute(step_run_stmt)).scalar_one_or_none()
                if paused_step_run:
                    paused_step_run.status = WorkflowStepRunStatus.FAILED.value
                    paused_step_run.error_message = f"Approval request expired after {timeout_hours} hours"
                    paused_step_run.completed_at = utc_now()

                audit_log = AuditLog(
                    organization_id=organization_id,
                    user_id=None,
                    action="approval.expired",
                    resource_type="approval_request",
                    resource_id=str(approval.id),
                    details={
                        "workflow_run_id": str(run_id),
                        "step_id": str(approval.step_id),
                        "timeout_hours": timeout_hours,
                    },
                )
                session.add(audit_log)
                await session.commit()
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Cannot resolve an expired approval request",
                )

            # 4. Check if approval is already APPROVED
            if approval.status == "APPROVED":
                if approved:
                    # Idempotent repeat: return run, zero DAG traversal (even if run is COMPLETED)
                    return run
                else:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="Cannot reject an already approved approval request",
                    )

            # 5. Check if approval is already REJECTED
            if approval.status == "REJECTED":
                if not approved:
                    # Idempotent repeat: return run, zero DAG traversal (even if run is COMPLETED)
                    return run
                else:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="Cannot approve an already rejected approval request",
                    )

            # 6. Check if approval is CANCELLED or EXPIRED
            if approval.status == "CANCELLED":
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Cannot resolve a cancelled approval request",
                )
            if approval.status == "EXPIRED":
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Cannot resolve an expired approval request",
                )

            # 7. If approval is PENDING
            if approval.status == "PENDING":
                if run.status in [
                    WorkflowRunStatus.COMPLETED.value,
                    WorkflowRunStatus.FAILED.value,
                    WorkflowRunStatus.CANCELLED.value,
                ]:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=f"Workflow run is in terminal state '{run.status}' and cannot be resumed",
                    )

                decision_str = "APPROVED" if approved else "REJECTED"
                branch_str = "approved" if approved else "rejected"
                audit_action = "approval.approved" if approved else "approval.rejected"

                approval.status = decision_str
                approval.reviewed_by = reviewer_id
                approval.comment = comment
                approval.resolved_at = utc_now()

                # Mark paused step run as COMPLETED with selected_branch
                step_run_stmt = select(WorkflowStepRun).where(
                    WorkflowStepRun.workflow_run_id == run.id,
                    WorkflowStepRun.step_id == approval.step_id,
                    WorkflowStepRun.status == WorkflowStepRunStatus.PAUSED.value,
                )
                paused_step_run = (await session.execute(step_run_stmt)).scalar_one_or_none()
                if paused_step_run:
                    paused_step_run.status = WorkflowStepRunStatus.COMPLETED.value
                    paused_step_run.output_data = {
                        "decision": decision_str,
                        "selected_branch": branch_str,
                        "approved": approved,
                        "reviewer_id": str(reviewer_id) if reviewer_id else None,
                        "comment": comment,
                        "resolved_at": approval.resolved_at.isoformat(),
                    }
                    paused_step_run.completed_at = utc_now()

                run.status = WorkflowRunStatus.RUNNING.value

                # Emit AuditLog
                audit_log = AuditLog(
                    organization_id=organization_id,
                    user_id=reviewer_id,
                    action=audit_action,
                    resource_type="approval_request",
                    resource_id=str(approval.id),
                    details={
                        "workflow_run_id": str(run_id),
                        "step_id": str(approval.step_id),
                        "reviewer_id": str(reviewer_id) if reviewer_id else None,
                        "comment": comment,
                        "decision": decision_str,
                        "selected_branch": branch_str,
                    },
                )
                session.add(audit_log)

            # 8. Commit the approval decision / state transition
            await session.commit()
            await session.refresh(run)
            version_id = run.workflow_version_id
            clean_trigger_payload = dict(run.trigger_payload or {})

        # 9. Only the request that successfully transitioned PENDING -> APPROVED/REJECTED initiates DAG traversal
        return await self._run_dag_traversal(
            organization_id=organization_id,
            run_id=run_id,
            version_id=version_id,
            trigger_payload=clean_trigger_payload,
        )

    async def cancel_run(
        self,
        organization_id: uuid.UUID,
        run_id: uuid.UUID,
    ) -> WorkflowRun:
        """
        Cancels an active or paused workflow run.
        """
        async with self.session_factory() as session:
            run_stmt = (
                select(WorkflowRun)
                .where(
                    WorkflowRun.id == run_id,
                    WorkflowRun.organization_id == organization_id,
                )
                .with_for_update()
            )
            run = (await session.execute(run_stmt)).scalar_one_or_none()
            if not run:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow run not found")

            if run.status in [
                WorkflowRunStatus.COMPLETED.value,
                WorkflowRunStatus.FAILED.value,
                WorkflowRunStatus.CANCELLED.value,
            ]:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Cannot cancel workflow run in terminal state '{run.status}'",
                )

            run.status = WorkflowRunStatus.CANCELLED.value
            run.completed_at = utc_now()

            exec_cancel_audit = AuditLog(
                organization_id=organization_id,
                user_id=None,
                action="execution.cancelled",
                resource_type="workflow_run",
                resource_id=str(run.id),
                details={"workflow_id": str(run.workflow_id), "correlation_id": run.correlation_id},
            )
            session.add(exec_cancel_audit)

            # Synchronize approval requests: cancel any pending approvals for this run
            app_stmt = (
                select(ApprovalRequest)
                .where(
                    ApprovalRequest.workflow_run_id == run_id,
                    ApprovalRequest.organization_id == organization_id,
                    ApprovalRequest.status == "PENDING",
                )
                .with_for_update()
            )
            pending_approvals = (await session.execute(app_stmt)).scalars().all()
            for pa in pending_approvals:
                pa.status = "CANCELLED"
                pa.resolved_at = utc_now()
                audit_log = AuditLog(
                    organization_id=organization_id,
                    user_id=None,
                    action="approval.cancelled",
                    resource_type="approval_request",
                    resource_id=str(pa.id),
                    details={"workflow_run_id": str(run_id), "step_id": str(pa.step_id)},
                )
                session.add(audit_log)



            await session.commit()
            await session.refresh(run)
            return run

    # =========================================================================
    # Internal DAG Traversal Engine
    # =========================================================================

    async def _run_dag_traversal(
        self,
        organization_id: uuid.UUID,
        run_id: uuid.UUID,
        version_id: uuid.UUID,
        trigger_payload: Dict[str, Any],
    ) -> WorkflowRun:
        """
        Traverses and executes the workflow DAG steps deterministically.
        Uses OR-convergence and dedicated short-lived transactions per step.
        """
        # 1. Load version DAG structure and record execution.started audit event
        async with self.session_factory() as session:
            existing_audit_stmt = select(AuditLog).where(
                AuditLog.organization_id == organization_id,
                AuditLog.action == "execution.started",
                AuditLog.resource_id == str(run_id),
            )
            existing_audit = (await session.execute(existing_audit_stmt)).scalar_one_or_none()
            if not existing_audit:
                r_stmt = select(WorkflowRun).where(WorkflowRun.id == run_id)
                current_run = (await session.execute(r_stmt)).scalar_one_or_none()
                wf_id_str = str(current_run.workflow_id) if current_run else ""
                c_id_str = current_run.correlation_id if current_run else ""
                t_type = current_run.trigger_type if current_run else "UNKNOWN"
                start_audit = AuditLog(
                    organization_id=organization_id,
                    user_id=None,
                    action="execution.started",
                    resource_type="workflow_run",
                    resource_id=str(run_id),
                    details={"workflow_id": wf_id_str, "correlation_id": c_id_str, "trigger_type": t_type},
                )
                session.add(start_audit)
                await session.commit()
            steps_stmt = (
                select(WorkflowStep)
                .where(WorkflowStep.workflow_version_id == version_id)
                .order_by(WorkflowStep.created_at.asc())
            )
            steps = (await session.execute(steps_stmt)).scalars().all()

            conns_stmt = (
                select(WorkflowConnection)
                .where(WorkflowConnection.workflow_version_id == version_id)
            )
            conns = (await session.execute(conns_stmt)).scalars().all()

            # Load existing completed/skipped step runs for this execution
            existing_runs_stmt = select(WorkflowStepRun).where(
                WorkflowStepRun.workflow_run_id == run_id
            )
            existing_step_runs = (await session.execute(existing_runs_stmt)).scalars().all()

        step_by_id: Dict[uuid.UUID, WorkflowStep] = {s.id: s for s in steps}
        step_id_to_key: Dict[uuid.UUID, str] = {s.id: s.step_key for s in steps}

        # Build Graph representation
        incoming_edges: Dict[uuid.UUID, List[WorkflowConnection]] = {s.id: [] for s in steps}
        outgoing_edges: Dict[uuid.UUID, List[WorkflowConnection]] = {s.id: [] for s in steps}
        parent_step_ids: Dict[uuid.UUID, Set[uuid.UUID]] = {s.id: set() for s in steps}

        for c in conns:
            if c.source_step_id in outgoing_edges:
                outgoing_edges[c.source_step_id].append(c)
            if c.target_step_id in incoming_edges:
                incoming_edges[c.target_step_id].append(c)
            if c.target_step_id in parent_step_ids:
                parent_step_ids[c.target_step_id].add(c.source_step_id)

        # State tracking across traversal loop
        node_status: Dict[uuid.UUID, str] = {s.id: "PENDING" for s in steps}
        edge_active: Dict[uuid.UUID, bool] = {c.id: False for c in conns}
        workflow_data: Dict[str, Any] = {}

        # Hydrate state from completed/skipped step runs (for resumes)
        completed_step_ids: Set[uuid.UUID] = set()
        for sr in existing_step_runs:
            if sr.status == WorkflowStepRunStatus.COMPLETED.value:
                node_status[sr.step_id] = "COMPLETED"
                completed_step_ids.add(sr.step_id)
                s_key = step_id_to_key.get(sr.step_id)
                if s_key:
                    workflow_data[s_key] = sr.output_data or {}

                # Activate outgoing edges based on condition or approval or default
                step_obj = step_by_id.get(sr.step_id)
                if step_obj and step_obj.step_type == "CONDITION":
                    sel_branch = (sr.output_data or {}).get("selected_branch", "true")
                    for out_conn in outgoing_edges[sr.step_id]:
                        if out_conn.condition_label == sel_branch or (
                            not out_conn.condition_label and sel_branch == "true"
                        ):
                            edge_active[out_conn.id] = True
                        else:
                            edge_active[out_conn.id] = False
                elif step_obj and step_obj.step_type == "HUMAN_APPROVAL":
                    sel_branch = (sr.output_data or {}).get("selected_branch", "approved")
                    for out_conn in outgoing_edges[sr.step_id]:
                        if out_conn.condition_label == sel_branch or (
                            not out_conn.condition_label and sel_branch == "approved"
                        ):
                            edge_active[out_conn.id] = True
                        else:
                            edge_active[out_conn.id] = False
                else:
                    for out_conn in outgoing_edges[sr.step_id]:
                        edge_active[out_conn.id] = True

            elif sr.status == WorkflowStepRunStatus.SKIPPED.value:
                node_status[sr.step_id] = "SKIPPED"
                completed_step_ids.add(sr.step_id)
                for out_conn in outgoing_edges[sr.step_id]:
                    edge_active[out_conn.id] = False
            elif sr.status == WorkflowStepRunStatus.FAILED.value:
                node_status[sr.step_id] = "FAILED"
                completed_step_ids.add(sr.step_id)
                for out_conn in outgoing_edges[sr.step_id]:
                    edge_active[out_conn.id] = False

        # -------------------------------------------------------------
        # Traversal Loop
        # -------------------------------------------------------------
        while True:
            # Check for cancellation between steps
            async with self.session_factory() as session:
                chk_run = await session.get(WorkflowRun, run_id)
                if chk_run and chk_run.status == WorkflowRunStatus.CANCELLED.value:
                    return chk_run

            # Find ready nodes: PENDING nodes whose parents are all terminal (COMPLETED or SKIPPED)
            ready_nodes: List[WorkflowStep] = []
            for s in steps:
                if node_status[s.id] == "PENDING":
                    parents = parent_step_ids[s.id]
                    if not parents:
                        # Root / trigger node
                        ready_nodes.append(s)
                    else:
                        # Ready if all parent nodes have finished
                        has_failed_parent = any(node_status.get(p_id) == "FAILED" for p_id in parents)
                        if has_failed_parent:
                            # Cannot proceed along a failed path -> mark as SKIPPED
                            node_status[s.id] = "SKIPPED"
                            for out_c in outgoing_edges[s.id]:
                                edge_active[out_c.id] = False
                            continue

                        all_parents_done = all(
                            node_status.get(p_id) in ["COMPLETED", "SKIPPED"]
                            for p_id in parents
                        )
                        if all_parents_done:
                            ready_nodes.append(s)

            if not ready_nodes:
                # No more nodes ready to execute
                break

            for curr_step in ready_nodes:
                # Check cancellation
                async with self.session_factory() as session:
                    chk_run = await session.get(WorkflowRun, run_id)
                    if chk_run and chk_run.status == WorkflowRunStatus.CANCELLED.value:
                        return chk_run

                # Determine if node should EXECUTE or be SKIPPED
                parents = parent_step_ids[curr_step.id]
                should_execute = False

                if not parents:
                    # Root / trigger always executes
                    should_execute = True
                else:
                    # OR-Convergence rule: Executes if AT LEAST ONE incoming edge is ACTIVE
                    in_conns = incoming_edges[curr_step.id]
                    should_execute = any(edge_active.get(c.id, False) for c in in_conns)

                if not should_execute:
                    # Mark step as SKIPPED
                    node_status[curr_step.id] = "SKIPPED"
                    for out_c in outgoing_edges[curr_step.id]:
                        edge_active[out_c.id] = False

                    async with self.session_factory() as session:
                        skip_run = WorkflowStepRun(
                            workflow_run_id=run_id,
                            step_id=curr_step.id,
                            status=WorkflowStepRunStatus.SKIPPED.value,
                            input_data={},
                            output_data={"skipped_reason": "All incoming branch paths were inactive"},
                            started_at=utc_now(),
                            completed_at=utc_now(),
                        )
                        session.add(skip_run)
                        await session.commit()
                    continue

                # Node should execute
                if curr_step.id in completed_step_ids:
                    # Already completed previously (e.g. from resume hydration)
                    continue

                # -----------------------------------------------------
                # Execute step with discrete transaction boundaries
                # -----------------------------------------------------
                # 1. Start Step Transaction (WorkflowStepRun -> RUNNING)
                step_start_time = time.monotonic()
                step_input_snapshot = sanitize_payload({
                    "config": curr_step.config or {},
                    "workflow_data": workflow_data,
                    "trigger_payload": trigger_payload,
                })

                async with self.session_factory() as session:
                    step_run = WorkflowStepRun(
                        workflow_run_id=run_id,
                        step_id=curr_step.id,
                        status=WorkflowStepRunStatus.RUNNING.value,
                        input_data=step_input_snapshot,
                        started_at=utc_now(),
                    )
                    session.add(step_run)
                    await session.commit()
                    await session.refresh(step_run)
                    step_run_id = step_run.id

                # 2. In-Memory Step Execution with Executor
                try:
                    executor = get_step_executor(curr_step.step_type)
                    context = StepExecutionContext(
                        organization_id=organization_id,
                        workflow_run_id=run_id,
                        step_run_id=step_run_id,
                        step_id=curr_step.id,
                        step_key=curr_step.step_key,
                        step_type=curr_step.step_type,
                        config=curr_step.config or {},
                        trigger_payload=trigger_payload,
                        workflow_data=workflow_data,
                        session_factory=self.session_factory,
                    )

                    res: StepExecutionResult = await asyncio.wait_for(
                        executor.execute(context),
                        timeout=self.step_timeout_seconds,
                    )
                except asyncio.TimeoutError:
                    res = StepExecutionResult(
                        status="FAILED",
                        error_message=f"Step execution timed out after {self.step_timeout_seconds} seconds",
                    )
                except Exception as exc:
                    res = StepExecutionResult(
                        status="FAILED",
                        error_message=sanitize_error_message(f"Unhandled step executor exception: {str(exc)}"),
                    )

                execution_duration_ms = int((time.monotonic() - step_start_time) * 1000)

                # 3. Post-execution state persistence
                if res.status == "FAILED":
                    node_status[curr_step.id] = "FAILED"
                    for out_c in outgoing_edges[curr_step.id]:
                        edge_active[out_c.id] = False

                    async with self.session_factory() as session:
                        s_run = await session.get(WorkflowStepRun, step_run_id)
                        if s_run:
                            s_run.status = WorkflowStepRunStatus.FAILED.value
                            s_run.error_message = sanitize_error_message(res.error_message)
                            s_run.execution_time_ms = execution_duration_ms
                            s_run.completed_at = utc_now()

                        w_run = await session.get(WorkflowRun, run_id)
                        if w_run:
                            w_run.status = WorkflowRunStatus.FAILED.value
                            w_run.error_message = sanitize_error_message(
                                f"Execution failed at step '{curr_step.step_key}': {res.error_message}"
                            )
                            w_run.completed_at = utc_now()

                            fail_audit = AuditLog(
                                organization_id=organization_id,
                                user_id=None,
                                action="execution.failed",
                                resource_type="workflow_run",
                                resource_id=str(w_run.id),
                                details={
                                    "workflow_id": str(w_run.workflow_id),
                                    "failed_step_key": curr_step.step_key,
                                    "error_message": sanitize_error_message(res.error_message),
                                },
                            )
                            session.add(fail_audit)

                        await session.commit()
                        await session.refresh(w_run)
                        return w_run

                elif res.status == "PAUSED":
                    # Human Approval Suspension -> WorkflowRun PAUSED
                    clean_snapshot = sanitize_payload({
                        "step_key": curr_step.step_key,
                        "step_type": curr_step.step_type,
                        "workflow_data": workflow_data,
                        "trigger_payload": trigger_payload,
                        "approval_context": res.approval_context or {},
                    })

                    async with self.session_factory() as session:
                        # 1. Acquire WorkflowRun row lock
                        w_run = await session.get(WorkflowRun, run_id, with_for_update=True)
                        if not w_run:
                            return None

                        # 2. Check for existing active PENDING approval request under lock
                        existing_stmt = (
                            select(ApprovalRequest)
                            .where(
                                ApprovalRequest.workflow_run_id == run_id,
                                ApprovalRequest.step_id == curr_step.id,
                                ApprovalRequest.status == "PENDING",
                            )
                            .with_for_update()
                        )
                        existing_approval = (await session.execute(existing_stmt)).scalar_one_or_none()

                        if not existing_approval:
                            approval_req = ApprovalRequest(
                                organization_id=organization_id,
                                workflow_run_id=run_id,
                                step_id=curr_step.id,
                                status="PENDING",
                                payload_snapshot=clean_snapshot,
                            )
                            session.add(approval_req)
                            await session.flush()

                            # Emit audit log for approval requested
                            audit_log = AuditLog(
                                organization_id=organization_id,
                                user_id=None,
                                action="approval.requested",
                                resource_type="approval_request",
                                resource_id=str(approval_req.id),
                                details={
                                    "workflow_run_id": str(run_id),
                                    "step_key": curr_step.step_key,
                                    "step_id": str(curr_step.id),
                                    "approver_role": (res.approval_context or {}).get("approver_role", "OPERATOR"),
                                    "timeout_hours": (res.approval_context or {}).get("timeout_hours", 24),
                                },
                            )
                            session.add(audit_log)

                        s_run = await session.get(WorkflowStepRun, step_run_id)
                        if s_run:
                            s_run.status = WorkflowStepRunStatus.PAUSED.value
                            s_run.output_data = sanitize_payload(res.output_data)
                            s_run.execution_time_ms = execution_duration_ms

                        w_run.status = WorkflowRunStatus.PAUSED.value

                        await session.commit()
                        await session.refresh(w_run)
                        return w_run

                else:
                    # Step COMPLETED
                    clean_output = sanitize_payload(res.output_data)
                    async with self.session_factory() as session:
                        s_run = await session.get(WorkflowStepRun, step_run_id)
                        if s_run:
                            s_run.status = WorkflowStepRunStatus.COMPLETED.value
                            s_run.output_data = clean_output
                            s_run.execution_time_ms = execution_duration_ms
                            s_run.completed_at = utc_now()

                        # Token Accounting: Persist AI tokens if consumed
                        tokens_used = (res.output_data or {}).get("tokens_used", 0)
                        if tokens_used and isinstance(tokens_used, int) and tokens_used > 0:
                            w_run = await session.get(WorkflowRun, run_id)
                            wf_id = w_run.workflow_id if w_run else None
                            usage_record = UsageRecord(
                                organization_id=organization_id,
                                metric_type="ai_tokens",
                                quantity=tokens_used,
                                workflow_id=wf_id,
                            )
                            session.add(usage_record)

                        await session.commit()

                    node_status[curr_step.id] = "COMPLETED"
                    completed_step_ids.add(curr_step.id)
                    workflow_data[curr_step.step_key] = clean_output

                    # Activate outgoing edges
                    if curr_step.step_type == "CONDITION":
                        sel_branch = res.selected_branch or "true"
                        for out_c in outgoing_edges[curr_step.id]:
                            if out_c.condition_label == sel_branch or (
                                not out_c.condition_label and sel_branch == "true"
                            ):
                                edge_active[out_c.id] = True
                            else:
                                edge_active[out_c.id] = False
                    elif curr_step.step_type == "HUMAN_APPROVAL":
                        sel_branch = (clean_output or {}).get("selected_branch", "approved")
                        for out_c in outgoing_edges[curr_step.id]:
                            if out_c.condition_label == sel_branch or (
                                not out_c.condition_label and sel_branch == "approved"
                            ):
                                edge_active[out_c.id] = True
                            else:
                                edge_active[out_c.id] = False
                    else:
                        for out_c in outgoing_edges[curr_step.id]:
                            edge_active[out_c.id] = True

        # -------------------------------------------------------------
        # Traversal Finished: Complete WorkflowRun (RUNNING -> COMPLETED)
        # -------------------------------------------------------------
        async with self.session_factory() as session:
            final_run = await session.get(WorkflowRun, run_id)
            if final_run and final_run.status == WorkflowRunStatus.RUNNING.value:
                final_run.status = WorkflowRunStatus.COMPLETED.value
                final_run.completed_at = utc_now()
                duration_ms = int((final_run.completed_at - final_run.started_at).total_seconds() * 1000) if final_run.started_at else 0
                comp_audit = AuditLog(
                    organization_id=organization_id,
                    user_id=None,
                    action="execution.completed",
                    resource_type="workflow_run",
                    resource_id=str(final_run.id),
                    details={"workflow_id": str(final_run.workflow_id), "duration_ms": duration_ms},
                )
                session.add(comp_audit)
                await session.commit()
                await session.refresh(final_run)
            return final_run
