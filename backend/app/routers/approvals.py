import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.deps import get_current_active_user, get_db, require_role
from app.engine.workflow_engine import WorkflowEngine
from app.models.approval import ApprovalRequest
from app.models.audit_log import AuditLog
from app.models.membership import OrganizationMember, OrganizationRole
from app.models.organization import Organization
from app.models.user import User
from app.models.workflow import Workflow
from app.models.workflow_run import WorkflowRun, WorkflowStepRun
from app.schemas.approval import (
    ApprovalDecisionRequest,
    ApprovalListResponse,
    ApprovalResponse,
    ApprovalStatus,
)
from app.schemas.execution import WorkflowRunStatus, WorkflowStepRunStatus

router = APIRouter(
    prefix="/organizations/{organization_id}/approvals",
    tags=["Approvals"],
)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _get_session_factory(db: AsyncSession) -> Callable[[], AsyncSession]:
    bind = getattr(db, "bind", None)
    if bind and hasattr(bind, "sync_engine"):
        return async_sessionmaker(bind=bind, class_=AsyncSession, expire_on_commit=False)
    raise RuntimeError("Active database session has no engine bind")


ROLE_LEVELS = {
    OrganizationRole.OWNER.value: 4,
    OrganizationRole.ADMIN.value: 3,
    OrganizationRole.MANAGER.value: 2,
    OrganizationRole.OPERATOR.value: 1,
    OrganizationRole.VIEWER.value: 0,
}


def _check_approver_role(caller_role: Any, required_role_str: str) -> None:
    role_str = caller_role.value if hasattr(caller_role, "value") else str(caller_role)
    if role_str.upper() == "VIEWER":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Viewers cannot approve or reject approval requests",
        )
    caller_level = ROLE_LEVELS.get(role_str.upper(), 0)
    req_level = ROLE_LEVELS.get(required_role_str.upper(), 1)
    if caller_level < req_level:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"User role '{role_str}' is insufficient. Required role: '{required_role_str}'.",
        )


async def _check_and_apply_lazy_expiration(
    approval: ApprovalRequest,
    db: AsyncSession,
) -> bool:
    """
    Checks if an approval is PENDING and has exceeded its timeout_hours.
    If expired, marks it EXPIRED, fails the associated run and step run, and emits an audit log.
    Returns True if expired.
    """
    if approval.status != "PENDING":
        return False

    timeout_hours = (approval.payload_snapshot or {}).get("approval_context", {}).get("timeout_hours", 24)
    created_at = approval.created_at
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)

    if (created_at + timedelta(hours=timeout_hours)) <= utc_now():
        approval.status = "EXPIRED"
        approval.resolved_at = utc_now()

        # Fail workflow run
        run_stmt = (
            select(WorkflowRun)
            .where(
                WorkflowRun.id == approval.workflow_run_id,
                WorkflowRun.organization_id == approval.organization_id,
            )
            .with_for_update()
        )
        run = (await db.execute(run_stmt)).scalar_one_or_none()
        if run and run.status == WorkflowRunStatus.PAUSED.value:
            run.status = WorkflowRunStatus.FAILED.value
            run.error_message = f"Approval request expired after {timeout_hours} hours"
            run.completed_at = utc_now()

        # Fail step run
        step_run_stmt = (
            select(WorkflowStepRun)
            .where(
                WorkflowStepRun.workflow_run_id == approval.workflow_run_id,
                WorkflowStepRun.step_id == approval.step_id,
                WorkflowStepRun.status == WorkflowStepRunStatus.PAUSED.value,
            )
            .with_for_update()
        )
        paused_step_run = (await db.execute(step_run_stmt)).scalar_one_or_none()
        if paused_step_run:
            paused_step_run.status = WorkflowStepRunStatus.FAILED.value
            paused_step_run.error_message = f"Approval request expired after {timeout_hours} hours"
            paused_step_run.completed_at = utc_now()

        audit_log = AuditLog(
            organization_id=approval.organization_id,
            user_id=None,
            action="approval.expired",
            resource_type="approval_request",
            resource_id=str(approval.id),
            details={
                "workflow_run_id": str(approval.workflow_run_id),
                "step_id": str(approval.step_id),
                "timeout_hours": timeout_hours,
            },
        )
        db.add(audit_log)
        await db.commit()
        return True

    return False


async def _build_approval_response(
    approval: ApprovalRequest,
    db: AsyncSession,
) -> ApprovalResponse:
    timeout_hours = (approval.payload_snapshot or {}).get("approval_context", {}).get("timeout_hours", 24)
    approver_role = (approval.payload_snapshot or {}).get("approval_context", {}).get("approver_role", "OPERATOR")
    step_key = (approval.payload_snapshot or {}).get("step_key")

    created_at = approval.created_at
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)

    time_remaining_seconds: Optional[int] = None
    if approval.status == "PENDING":
        rem = int((created_at + timedelta(hours=timeout_hours) - utc_now()).total_seconds())
        time_remaining_seconds = max(0, rem)

    # Lookup workflow name
    wf_name: Optional[str] = None
    run_stmt = select(WorkflowRun.workflow_id).where(WorkflowRun.id == approval.workflow_run_id)
    wf_id = (await db.execute(run_stmt)).scalar_one_or_none()
    if wf_id:
        wf_name_stmt = select(Workflow.name).where(Workflow.id == wf_id)
        wf_name = (await db.execute(wf_name_stmt)).scalar_one_or_none()

    return ApprovalResponse(
        id=approval.id,
        organization_id=approval.organization_id,
        workflow_run_id=approval.workflow_run_id,
        step_id=approval.step_id,
        status=approval.status,
        payload_snapshot=approval.payload_snapshot or {},
        reviewed_by=approval.reviewed_by,
        comment=approval.comment,
        resolved_at=approval.resolved_at,
        created_at=approval.created_at,
        updated_at=approval.updated_at,
        time_remaining_seconds=time_remaining_seconds,
        approver_role=approver_role,
        workflow_name=wf_name,
        step_key=step_key,
    )


# ==============================================================================
# 1. List Organization Approvals
# ==============================================================================

@router.get(
    "",
    response_model=ApprovalListResponse,
    summary="List approval requests for an organization",
)
async def list_approvals(
    organization_id: uuid.UUID,
    status_filter: Optional[str] = Query("PENDING", alias="status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    org_context: Tuple[Organization, OrganizationMember] = Depends(
        require_role([
            OrganizationRole.OWNER,
            OrganizationRole.ADMIN,
            OrganizationRole.MANAGER,
            OrganizationRole.OPERATOR,
            OrganizationRole.VIEWER,
        ])
    ),
    db: AsyncSession = Depends(get_db),
):
    """
    Lists approval requests with optional status filtering.
    Evaluates lazy expiration on pending approvals before returning results.
    """
    # 1. Check lazy expirations on all pending approvals for this tenant
    pending_stmt = select(ApprovalRequest).where(
        ApprovalRequest.organization_id == organization_id,
        ApprovalRequest.status == "PENDING",
    )
    pending_items = (await db.execute(pending_stmt)).scalars().all()
    for item in pending_items:
        await _check_and_apply_lazy_expiration(item, db)

    # 2. Build filtered query
    stmt = select(ApprovalRequest).where(ApprovalRequest.organization_id == organization_id)
    if status_filter and status_filter.upper() != "ALL":
        stmt = stmt.where(ApprovalRequest.status == status_filter.upper())

    # Count total
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = (await db.execute(count_stmt)).scalar() or 0

    # Paginate
    stmt = stmt.order_by(ApprovalRequest.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    approvals = (await db.execute(stmt)).scalars().all()

    items = [await _build_approval_response(a, db) for a in approvals]

    return ApprovalListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


# ==============================================================================
# 2. Get Approval Detail
# ==============================================================================

@router.get(
    "/{approval_id}",
    response_model=ApprovalResponse,
    summary="Get detailed snapshot of an approval request",
)
async def get_approval(
    organization_id: uuid.UUID,
    approval_id: uuid.UUID,
    org_context: Tuple[Organization, OrganizationMember] = Depends(
        require_role([
            OrganizationRole.OWNER,
            OrganizationRole.ADMIN,
            OrganizationRole.MANAGER,
            OrganizationRole.OPERATOR,
            OrganizationRole.VIEWER,
        ])
    ),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns approval details. Performs lazy expiration evaluation if pending.
    """
    stmt = select(ApprovalRequest).where(
        ApprovalRequest.id == approval_id,
        ApprovalRequest.organization_id == organization_id,
    )
    approval = (await db.execute(stmt)).scalar_one_or_none()
    if not approval:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Approval request not found",
        )

    await _check_and_apply_lazy_expiration(approval, db)
    return await _build_approval_response(approval, db)


# ==============================================================================
# 3. Approve Request
# ==============================================================================

@router.post(
    "/{approval_id}/approve",
    response_model=ApprovalResponse,
    summary="Approve a pending human approval request",
)
async def approve_request(
    organization_id: uuid.UUID,
    approval_id: uuid.UUID,
    req: ApprovalDecisionRequest = ApprovalDecisionRequest(),
    org_context: Tuple[Organization, OrganizationMember] = Depends(
        require_role([
            OrganizationRole.OWNER,
            OrganizationRole.ADMIN,
            OrganizationRole.MANAGER,
            OrganizationRole.OPERATOR,
        ])
    ),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Approves the pending request.
    Verifies caller role against required approver_role.
    Resumes DAG execution on 'approved' branch.
    """
    org, member = org_context

    stmt = select(ApprovalRequest).where(
        ApprovalRequest.id == approval_id,
        ApprovalRequest.organization_id == organization_id,
    )
    approval = (await db.execute(stmt)).scalar_one_or_none()
    if not approval:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Approval request not found",
        )

    # Check required role
    req_role = (approval.payload_snapshot or {}).get("approval_context", {}).get("approver_role", "OPERATOR")
    _check_approver_role(member.role, req_role)

    # Resume run through engine
    factory = _get_session_factory(db)
    engine = WorkflowEngine(session_factory=factory)
    await engine.resume_run(
        organization_id=organization_id,
        run_id=approval.workflow_run_id,
        reviewer_id=current_user.id,
        approved=True,
        comment=req.comment,
        approval_id=approval_id,
    )

    # Reload approval record
    await db.refresh(approval)
    return await _build_approval_response(approval, db)


# ==============================================================================
# 4. Reject Request
# ==============================================================================

@router.post(
    "/{approval_id}/reject",
    response_model=ApprovalResponse,
    summary="Reject a pending human approval request",
)
async def reject_request(
    organization_id: uuid.UUID,
    approval_id: uuid.UUID,
    req: ApprovalDecisionRequest = ApprovalDecisionRequest(),
    org_context: Tuple[Organization, OrganizationMember] = Depends(
        require_role([
            OrganizationRole.OWNER,
            OrganizationRole.ADMIN,
            OrganizationRole.MANAGER,
            OrganizationRole.OPERATOR,
        ])
    ),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Rejects the pending request.
    Verifies caller role against required approver_role.
    Resumes DAG execution on 'rejected' branch (non-fatal).
    """
    org, member = org_context

    stmt = select(ApprovalRequest).where(
        ApprovalRequest.id == approval_id,
        ApprovalRequest.organization_id == organization_id,
    )
    approval = (await db.execute(stmt)).scalar_one_or_none()
    if not approval:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Approval request not found",
        )

    # Check required role
    req_role = (approval.payload_snapshot or {}).get("approval_context", {}).get("approver_role", "OPERATOR")
    _check_approver_role(member.role, req_role)

    # Resume run through engine with approved=False
    factory = _get_session_factory(db)
    engine = WorkflowEngine(session_factory=factory)
    await engine.resume_run(
        organization_id=organization_id,
        run_id=approval.workflow_run_id,
        reviewer_id=current_user.id,
        approved=False,
        comment=req.comment,
        approval_id=approval_id,
    )

    # Reload approval record
    await db.refresh(approval)
    return await _build_approval_response(approval, db)
