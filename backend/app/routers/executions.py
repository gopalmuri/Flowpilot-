import math
import secrets
import uuid
from datetime import datetime, timezone
from typing import List, Optional, Tuple
from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.deps import get_current_active_user, get_org_context, require_role
from app.core.database import async_session_maker, get_db
from app.engine.sanitizer import sanitize_error_message, sanitize_payload
from app.engine.workflow_engine import WorkflowEngine
from app.models.approval import ApprovalRequest
from app.models.membership import OrganizationMember, OrganizationRole
from app.models.organization import Organization
from app.models.user import User
from app.models.workflow import Workflow, WorkflowVersion
from app.models.workflow_run import WorkflowRun, WorkflowStepRun
from app.models.workflow_step import WorkflowStep
from app.schemas.execution import (
    ExecutionApprovalSummaryResponse,
    WorkflowRunCreateRequest,
    WorkflowRunDetailResponse,
    WorkflowRunListResponse,
    WorkflowRunResponse,
    WorkflowRunResumeRequest,
    WorkflowRunStatus,
    WorkflowStepRunResponse,
)
from app.workers.tasks import execute_workflow_run, resume_workflow_run

router = APIRouter(
    prefix="/organizations/{organization_id}",
    tags=["Workflow Executions"],
)


def _get_session_factory(db: AsyncSession):
    bind = getattr(db, "bind", None)
    if bind and hasattr(bind, "sync_engine"):
        return async_sessionmaker(
            bind=bind,
            class_=AsyncSession,
            expire_on_commit=False,
            autocommit=False,
            autoflush=False,
        )
    return async_session_maker


def _get_engine(db: AsyncSession) -> WorkflowEngine:
    return WorkflowEngine(session_factory=_get_session_factory(db))


async def _build_run_detail(db: AsyncSession, run: WorkflowRun) -> WorkflowRunDetailResponse:
    # Query workflow name
    wf_stmt = select(Workflow.name).where(Workflow.id == run.workflow_id)
    wf_name = (await db.execute(wf_stmt)).scalar_one_or_none()

    # Calculate duration_ms
    duration_ms = None
    if run.completed_at and run.started_at:
        duration_ms = int((run.completed_at - run.started_at).total_seconds() * 1000)
    elif run.started_at:
        duration_ms = int((datetime.now(timezone.utc) - run.started_at).total_seconds() * 1000)

    # Query step runs joined with step to get step_key and step_type
    stmt = (
        select(WorkflowStepRun, WorkflowStep.step_key, WorkflowStep.step_type)
        .outerjoin(WorkflowStep, WorkflowStepRun.step_id == WorkflowStep.id)
        .where(WorkflowStepRun.workflow_run_id == run.id)
        .order_by(WorkflowStepRun.started_at.asc(), WorkflowStepRun.id.asc())
    )
    results = (await db.execute(stmt)).all()

    step_responses = []
    for step_run, step_key, step_type in results:
        step_responses.append(
            WorkflowStepRunResponse(
                id=step_run.id,
                workflow_run_id=step_run.workflow_run_id,
                step_id=step_run.step_id,
                step_key=step_key,
                step_type=step_type,
                status=step_run.status,
                input_data=sanitize_payload(step_run.input_data or {}),
                output_data=sanitize_payload(step_run.output_data or {}),
                error_message=sanitize_error_message(step_run.error_message),
                execution_time_ms=step_run.execution_time_ms,
                started_at=step_run.started_at,
                completed_at=step_run.completed_at,
            )
        )

    # Query approvals for this run
    app_stmt = (
        select(ApprovalRequest, User.email, User.full_name)
        .outerjoin(User, ApprovalRequest.reviewed_by == User.id)
        .where(
            ApprovalRequest.workflow_run_id == run.id,
            ApprovalRequest.organization_id == run.organization_id,
        )
        .order_by(ApprovalRequest.created_at.asc(), ApprovalRequest.id.asc())
    )
    app_results = (await db.execute(app_stmt)).all()
    approval_responses = []
    for app_req, u_email, u_name in app_results:
        approval_responses.append(
            ExecutionApprovalSummaryResponse(
                id=app_req.id,
                workflow_run_id=app_req.workflow_run_id,
                step_id=app_req.step_id,
                status=app_req.status,
                reviewed_by=app_req.reviewed_by,
                reviewer_email=u_email,
                reviewer_name=u_name,
                comment=app_req.comment,
                created_at=app_req.created_at,
                resolved_at=app_req.resolved_at,
            )
        )

    return WorkflowRunDetailResponse(
        id=run.id,
        organization_id=run.organization_id,
        workflow_id=run.workflow_id,
        workflow_version_id=run.workflow_version_id,
        workflow_name=wf_name,
        status=run.status,
        trigger_type=run.trigger_type,
        trigger_payload=sanitize_payload(run.trigger_payload or {}),
        correlation_id=run.correlation_id,
        error_message=sanitize_error_message(run.error_message),
        duration_ms=duration_ms,
        started_at=run.started_at,
        completed_at=run.completed_at,
        created_at=run.created_at,
        updated_at=run.updated_at,
        step_runs=step_responses,
        approvals=approval_responses,
    )


# ==============================================================================
# 1. Trigger / Start Workflow Execution
# ==============================================================================

@router.post(
    "/workflows/{workflow_id}/runs",
    response_model=WorkflowRunDetailResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Trigger a new execution run for a workflow",
)
async def trigger_workflow_run(
    organization_id: uuid.UUID,
    workflow_id: uuid.UUID,
    req: WorkflowRunCreateRequest,
    async_dispatch: bool = Query(False, description="Dispatch execution asynchronously to Celery background worker"),
    x_async_dispatch: Optional[str] = Header(None, alias="X-Async-Dispatch"),
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
    Initiates an execution run for an ACTIVE published workflow.
    Allowed roles: OWNER, ADMIN, MANAGER, OPERATOR. VIEWER receives 403.
    Supports ?async_dispatch=true or X-Async-Dispatch: true for Celery queueing.
    """
    is_async = async_dispatch or (x_async_dispatch and x_async_dispatch.lower() == "true")

    if is_async:
        wf_stmt = select(Workflow).where(
            Workflow.id == workflow_id,
            Workflow.organization_id == organization_id,
        )
        wf = (await db.execute(wf_stmt)).scalar_one_or_none()
        if not wf:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow not found")
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
        ver = (await db.execute(ver_stmt)).scalar_one_or_none()
        if not ver or ver.status != "PUBLISHED":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Active workflow version is not in PUBLISHED status",
            )

        corr_id = req.correlation_id or f"corr_{secrets.token_hex(16)}"
        clean_trigger_payload = sanitize_payload(req.trigger_payload)

        run = WorkflowRun(
            organization_id=organization_id,
            workflow_id=workflow_id,
            workflow_version_id=ver.id,
            status=WorkflowRunStatus.PENDING.value,
            trigger_type="MANUAL",
            trigger_payload=clean_trigger_payload,
            correlation_id=corr_id,
            started_at=datetime.now(timezone.utc),
        )
        db.add(run)
        await db.commit()
        await db.refresh(run)

        execute_workflow_run.delay(
            str(organization_id),
            str(run.id),
            str(ver.id),
            clean_trigger_payload,
            corr_id,
        )
        return await _build_run_detail(db, run)

    # Synchronous path (default)
    engine = _get_engine(db)
    run = await engine.execute_new_run(
        organization_id=organization_id,
        workflow_id=workflow_id,
        trigger_payload=req.trigger_payload,
        trigger_type="MANUAL",
        correlation_id=req.correlation_id,
    )

    return await _build_run_detail(db, run)


# ==============================================================================
# 2a. List Workflow Runs (Workflow Scoped)
# ==============================================================================

@router.get(
    "/workflows/{workflow_id}/runs",
    response_model=WorkflowRunListResponse,
    summary="List execution runs for a specific workflow",
)
async def list_workflow_runs(
    organization_id: uuid.UUID,
    workflow_id: uuid.UUID,
    run_status: Optional[WorkflowRunStatus] = Query(None, alias="status"),
    trigger_type: Optional[str] = Query(None),
    correlation_id: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    from_date: Optional[datetime] = Query(None),
    to_date: Optional[datetime] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    org_context: Tuple[Organization, OrganizationMember] = Depends(get_org_context),
    db: AsyncSession = Depends(get_db),
):
    """
    Lists execution runs for a specific workflow with optional status, trigger, date, and correlation filters.
    """
    wf_stmt = select(Workflow).where(
        Workflow.id == workflow_id,
        Workflow.organization_id == organization_id,
    )
    wf = (await db.execute(wf_stmt)).scalar_one_or_none()
    if not wf:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow not found",
        )

    stmt = select(WorkflowRun).where(
        WorkflowRun.organization_id == organization_id,
        WorkflowRun.workflow_id == workflow_id,
    )
    if run_status:
        stmt = stmt.where(WorkflowRun.status == run_status.value)
    if trigger_type:
        stmt = stmt.where(WorkflowRun.trigger_type == trigger_type.upper())
    if correlation_id:
        stmt = stmt.where(WorkflowRun.correlation_id.ilike(f"%{correlation_id.strip()}%"))
    if from_date:
        stmt = stmt.where(WorkflowRun.started_at >= from_date)
    if to_date:
        stmt = stmt.where(WorkflowRun.started_at <= to_date)
    if search:
        s = f"%{search.strip()}%"
        stmt = stmt.where(WorkflowRun.correlation_id.ilike(s))

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = await db.scalar(count_stmt) or 0

    offset = (page - 1) * page_size
    stmt = stmt.order_by(WorkflowRun.started_at.desc(), WorkflowRun.id.desc()).offset(offset).limit(page_size)
    runs = (await db.execute(stmt)).scalars().all()

    items = []
    now = datetime.now(timezone.utc)
    for r in runs:
        duration_ms = None
        if r.completed_at and r.started_at:
            duration_ms = int((r.completed_at - r.started_at).total_seconds() * 1000)
        elif r.started_at:
            duration_ms = int((now - r.started_at).total_seconds() * 1000)

        items.append(
            WorkflowRunResponse(
                id=r.id,
                organization_id=r.organization_id,
                workflow_id=r.workflow_id,
                workflow_version_id=r.workflow_version_id,
                workflow_name=wf.name,
                status=r.status,
                trigger_type=r.trigger_type,
                trigger_payload=sanitize_payload(r.trigger_payload or {}),
                correlation_id=r.correlation_id,
                error_message=sanitize_error_message(r.error_message),
                duration_ms=duration_ms,
                started_at=r.started_at,
                completed_at=r.completed_at,
                created_at=r.created_at,
                updated_at=r.updated_at,
            )
        )

    total_pages = math.ceil(total / page_size) if total > 0 else 1
    return WorkflowRunListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


# ==============================================================================
# 2b. List All Organization Runs (Global Search & Filter)
# ==============================================================================

@router.get(
    "/runs",
    response_model=WorkflowRunListResponse,
    summary="List all workflow runs across the organization",
)
async def list_organization_runs(
    organization_id: uuid.UUID,
    run_status: Optional[WorkflowRunStatus] = Query(None, alias="status"),
    workflow_id: Optional[uuid.UUID] = Query(None),
    trigger_type: Optional[str] = Query(None),
    correlation_id: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    from_date: Optional[datetime] = Query(None),
    to_date: Optional[datetime] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    org_context: Tuple[Organization, OrganizationMember] = Depends(get_org_context),
    db: AsyncSession = Depends(get_db),
):
    """
    Lists execution runs across all workflows in the organization.
    Supports status, workflow, trigger type, correlation ID, text search, and date range filters with deterministic pagination.
    """
    stmt = (
        select(WorkflowRun, Workflow.name)
        .outerjoin(Workflow, WorkflowRun.workflow_id == Workflow.id)
        .where(WorkflowRun.organization_id == organization_id)
    )
    if workflow_id:
        stmt = stmt.where(WorkflowRun.workflow_id == workflow_id)
    if run_status:
        stmt = stmt.where(WorkflowRun.status == run_status.value)
    if trigger_type:
        stmt = stmt.where(WorkflowRun.trigger_type == trigger_type.upper())
    if correlation_id:
        stmt = stmt.where(WorkflowRun.correlation_id.ilike(f"%{correlation_id.strip()}%"))
    if from_date:
        stmt = stmt.where(WorkflowRun.started_at >= from_date)
    if to_date:
        stmt = stmt.where(WorkflowRun.started_at <= to_date)
    if search:
        s = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                WorkflowRun.correlation_id.ilike(s),
                Workflow.name.ilike(s),
            )
        )

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = await db.scalar(count_stmt) or 0

    offset = (page - 1) * page_size
    stmt = stmt.order_by(WorkflowRun.started_at.desc(), WorkflowRun.id.desc()).offset(offset).limit(page_size)
    runs_with_name = (await db.execute(stmt)).all()

    items = []
    now = datetime.now(timezone.utc)
    for r, wf_name in runs_with_name:
        duration_ms = None
        if r.completed_at and r.started_at:
            duration_ms = int((r.completed_at - r.started_at).total_seconds() * 1000)
        elif r.started_at:
            duration_ms = int((now - r.started_at).total_seconds() * 1000)

        items.append(
            WorkflowRunResponse(
                id=r.id,
                organization_id=r.organization_id,
                workflow_id=r.workflow_id,
                workflow_version_id=r.workflow_version_id,
                workflow_name=wf_name,
                status=r.status,
                trigger_type=r.trigger_type,
                trigger_payload=sanitize_payload(r.trigger_payload or {}),
                correlation_id=r.correlation_id,
                error_message=sanitize_error_message(r.error_message),
                duration_ms=duration_ms,
                started_at=r.started_at,
                completed_at=r.completed_at,
                created_at=r.created_at,
                updated_at=r.updated_at,
            )
        )

    total_pages = math.ceil(total / page_size) if total > 0 else 1
    return WorkflowRunListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


# ==============================================================================
# 3. Get Workflow Run Detail
# ==============================================================================

@router.get(
    "/runs/{run_id}",
    response_model=WorkflowRunDetailResponse,
    summary="Get execution details and step results for a specific run",
)
async def get_run_detail(
    organization_id: uuid.UUID,
    run_id: uuid.UUID,
    org_context: Tuple[Organization, OrganizationMember] = Depends(get_org_context),
    db: AsyncSession = Depends(get_db),
):
    """
    Retrieves full execution details for a workflow run, including all step runs and human approvals.
    Enforces tenant isolation.
    """
    stmt = select(WorkflowRun).where(
        WorkflowRun.id == run_id,
        WorkflowRun.organization_id == organization_id,
    )
    run = (await db.execute(stmt)).scalar_one_or_none()
    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow run not found",
        )

    return await _build_run_detail(db, run)


# ==============================================================================
# 4. Cancel Workflow Run
# ==============================================================================

@router.post(
    "/runs/{run_id}/cancel",
    response_model=WorkflowRunResponse,
    summary="Cancel active or paused workflow run",
)
async def cancel_run(
    organization_id: uuid.UUID,
    run_id: uuid.UUID,
    org_context: Tuple[Organization, OrganizationMember] = Depends(
        require_role([
            OrganizationRole.OWNER,
            OrganizationRole.ADMIN,
            OrganizationRole.MANAGER,
            OrganizationRole.OPERATOR,
        ])
    ),
    db: AsyncSession = Depends(get_db),
):
    """
    Cancels an active or paused workflow run.
    Allowed roles: OWNER, ADMIN, MANAGER, OPERATOR. VIEWER receives 403.
    """
    engine = _get_engine(db)
    run = await engine.cancel_run(organization_id=organization_id, run_id=run_id)

    duration_ms = None
    if run.completed_at and run.started_at:
        duration_ms = int((run.completed_at - run.started_at).total_seconds() * 1000)

    wf_stmt = select(Workflow.name).where(Workflow.id == run.workflow_id)
    wf_name = (await db.execute(wf_stmt)).scalar_one_or_none()

    return WorkflowRunResponse(
        id=run.id,
        organization_id=run.organization_id,
        workflow_id=run.workflow_id,
        workflow_version_id=run.workflow_version_id,
        workflow_name=wf_name,
        status=run.status,
        trigger_type=run.trigger_type,
        trigger_payload=sanitize_payload(run.trigger_payload or {}),
        correlation_id=run.correlation_id,
        error_message=sanitize_error_message(run.error_message),
        duration_ms=duration_ms,
        started_at=run.started_at,
        completed_at=run.completed_at,
        created_at=run.created_at,
        updated_at=run.updated_at,
    )


# ==============================================================================
# 5. Resume / Approve Workflow Run
# ==============================================================================

@router.post(
    "/runs/{run_id}/resume",
    response_model=WorkflowRunDetailResponse,
    summary="Resume or resolve paused human approval workflow run",
)
async def resume_run(
    organization_id: uuid.UUID,
    run_id: uuid.UUID,
    req: WorkflowRunResumeRequest,
    async_dispatch: bool = Query(False, description="Dispatch resumption asynchronously to Celery background worker"),
    x_async_dispatch: Optional[str] = Header(None, alias="X-Async-Dispatch"),
    org_context: Tuple[Organization, OrganizationMember] = Depends(
        require_role([
            OrganizationRole.OWNER,
            OrganizationRole.ADMIN,
            OrganizationRole.MANAGER,
        ])
    ),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Resumes a paused workflow run upon human review.
    Allowed roles: OWNER, ADMIN, MANAGER. OPERATOR and VIEWER receive 403.
    Supports ?async_dispatch=true or X-Async-Dispatch: true for Celery queueing.
    """
    is_async = async_dispatch or (x_async_dispatch and x_async_dispatch.lower() == "true")

    if is_async:
        run_stmt = select(WorkflowRun).where(
            WorkflowRun.id == run_id,
            WorkflowRun.organization_id == organization_id,
        )
        run = (await db.execute(run_stmt)).scalar_one_or_none()
        if not run:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow run not found")
        if run.status != WorkflowRunStatus.PAUSED.value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot resume run with status '{run.status}'. Only PAUSED runs can be resumed.",
            )

        resume_workflow_run.delay(
            str(organization_id),
            str(run_id),
            str(current_user.id),
            req.approved,
            req.comment,
        )

        return await _build_run_detail(db, run)

    # Synchronous path (default)
    factory = _get_session_factory(db)
    engine = WorkflowEngine(session_factory=factory)
    run = await engine.resume_run(
        organization_id=organization_id,
        run_id=run_id,
        reviewer_id=current_user.id,
        approved=req.approved,
        comment=req.comment,
    )

    async with factory() as session:
        return await _build_run_detail(session, run)
