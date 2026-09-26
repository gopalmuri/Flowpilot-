import math
import secrets
import uuid
from typing import List, Optional, Tuple
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_active_user, get_org_context, require_role
from app.core.database import get_db
from app.models.membership import OrganizationMember, OrganizationRole
from app.models.audit_log import AuditLog
from app.models.organization import Organization
from app.models.user import User
from app.models.workflow import Workflow, WorkflowVersion
from app.models.workflow_step import WorkflowConnection, WorkflowStep
from app.schemas.workflow import (
    StepType,
    WorkflowConnectionResponse,
    WorkflowCreateRequest,
    WorkflowListResponse,
    WorkflowResponse,
    WorkflowStatus,
    WorkflowStepResponse,
    WorkflowUpdateRequest,
    WorkflowValidationResult,
    WorkflowVersionCreateRequest,
    WorkflowVersionDetailResponse,
    WorkflowVersionStatus,
    WorkflowVersionSummaryResponse,
    WorkflowVersionUpdateRequest,
)
from app.services.workflow_validator import validate_workflow_dag

router = APIRouter(
    prefix="/organizations/{organization_id}/workflows",
    tags=["Workflows"],
)


def _build_step_response(step: WorkflowStep) -> WorkflowStepResponse:
    return WorkflowStepResponse(
        id=step.id,
        workflow_version_id=step.workflow_version_id,
        step_key=step.step_key,
        step_type=step.step_type,
        name=step.name,
        config=step.config or {},
        ui_position=step.ui_position or {"x": 0, "y": 0},
        created_at=step.created_at,
        updated_at=step.updated_at,
    )


def _build_connection_response(
    conn: WorkflowConnection,
    step_id_to_key: dict,
) -> WorkflowConnectionResponse:
    return WorkflowConnectionResponse(
        id=conn.id,
        workflow_version_id=conn.workflow_version_id,
        source_step_id=conn.source_step_id,
        target_step_id=conn.target_step_id,
        source_step_key=step_id_to_key.get(conn.source_step_id),
        target_step_key=step_id_to_key.get(conn.target_step_id),
        condition_label=conn.condition_label,
        created_at=conn.created_at,
        updated_at=conn.updated_at,
    )


def _build_version_detail_response(
    version: WorkflowVersion,
    steps: List[WorkflowStep],
    connections: List[WorkflowConnection],
) -> WorkflowVersionDetailResponse:
    step_id_to_key = {s.id: s.step_key for s in steps}
    step_responses = [_build_step_response(s) for s in steps]
    conn_responses = [_build_connection_response(c, step_id_to_key) for c in connections]

    return WorkflowVersionDetailResponse(
        id=version.id,
        workflow_id=version.workflow_id,
        version_number=version.version_number,
        status=version.status,
        definition=version.definition or {},
        created_by=version.created_by,
        created_at=version.created_at,
        updated_at=version.updated_at,
        steps=step_responses,
        connections=conn_responses,
    )


async def _get_workflow_or_404(
    db: AsyncSession,
    organization_id: uuid.UUID,
    workflow_id: uuid.UUID,
    for_update: bool = False,
) -> Workflow:
    stmt = (
        select(Workflow)
        .where(
            Workflow.id == workflow_id,
            Workflow.organization_id == organization_id,
        )
    )
    if for_update:
        stmt = stmt.with_for_update()

    result = await db.execute(stmt)
    workflow = result.scalar_one_or_none()
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow not found",
        )
    return workflow


async def _get_version_or_404(
    db: AsyncSession,
    organization_id: uuid.UUID,
    workflow_id: uuid.UUID,
    version_id: uuid.UUID,
    for_update: bool = False,
) -> Tuple[Workflow, WorkflowVersion]:
    workflow = await _get_workflow_or_404(
        db, organization_id, workflow_id, for_update=for_update
    )

    stmt = select(WorkflowVersion).where(
        WorkflowVersion.id == version_id,
        WorkflowVersion.workflow_id == workflow_id,
    )
    if for_update:
        stmt = stmt.with_for_update()

    result = await db.execute(stmt)
    version = result.scalar_one_or_none()
    if not version:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow version not found",
        )
    return workflow, version


async def _build_workflow_response(
    db: AsyncSession,
    workflow: Workflow,
) -> WorkflowResponse:
    # Get version count
    count_stmt = select(func.count(WorkflowVersion.id)).where(
        WorkflowVersion.workflow_id == workflow.id
    )
    version_count = await db.scalar(count_stmt) or 0

    # Get active version summary if exists
    active_summary = None
    if workflow.active_version_id:
        v_stmt = select(WorkflowVersion).where(
            WorkflowVersion.id == workflow.active_version_id
        )
        active_version = await db.scalar(v_stmt)
        if active_version:
            active_summary = WorkflowVersionSummaryResponse(
                id=active_version.id,
                workflow_id=active_version.workflow_id,
                version_number=active_version.version_number,
                status=active_version.status,
                created_by=active_version.created_by,
                created_at=active_version.created_at,
                updated_at=active_version.updated_at,
            )

    return WorkflowResponse(
        id=workflow.id,
        organization_id=workflow.organization_id,
        name=workflow.name,
        description=workflow.description,
        status=workflow.status,
        active_version_id=workflow.active_version_id,
        webhook_key=workflow.webhook_key,
        created_by=workflow.created_by,
        created_at=workflow.created_at,
        updated_at=workflow.updated_at,
        version_count=version_count,
        active_version=active_summary,
    )


# ==============================================================================
# 1. Workflow CRUD Endpoints
# ==============================================================================

@router.post(
    "",
    response_model=WorkflowResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new workflow",
)
async def create_workflow(
    organization_id: uuid.UUID,
    req: WorkflowCreateRequest,
    org_context: Tuple[Organization, OrganizationMember] = Depends(
        require_role([OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.MANAGER])
    ),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Creates a new workflow in DRAFT status with an initial empty DRAFT version 1.
    Generates a secure unique webhook_key.
    Enforces multi-tenant isolation and role authorization.
    """
    org, member = org_context

    new_workflow = Workflow(
        organization_id=organization_id,
        name=req.name.strip(),
        description=req.description.strip() if req.description else None,
        status=WorkflowStatus.DRAFT.value,
        webhook_key=secrets.token_urlsafe(32),
        created_by=current_user.id,
    )
    db.add(new_workflow)
    await db.flush()

    # Create initial version 1 (Draft)
    initial_version = WorkflowVersion(
        workflow_id=new_workflow.id,
        version_number=1,
        status=WorkflowVersionStatus.DRAFT.value,
        definition={"steps": [], "connections": []},
        created_by=current_user.id,
    )
    db.add(initial_version)

    audit_entry = AuditLog(
        organization_id=organization_id,
        user_id=current_user.id,
        action="workflow.created",
        resource_type="workflow",
        resource_id=str(new_workflow.id),
        details={"name": new_workflow.name},
    )
    db.add(audit_entry)

    await db.commit()
    await db.refresh(new_workflow)

    return await _build_workflow_response(db, new_workflow)


@router.get(
    "",
    response_model=WorkflowListResponse,
    summary="List workflows for organization",
)
async def list_workflows(
    organization_id: uuid.UUID,
    workflow_status: Optional[WorkflowStatus] = Query(None, alias="status"),
    search: Optional[str] = Query(None, max_length=100),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    org_context: Tuple[Organization, OrganizationMember] = Depends(get_org_context),
    db: AsyncSession = Depends(get_db),
):
    """
    Lists workflows belonging strictly to organization_id.
    Supports filtering by status, search by name, and pagination.
    """
    org, member = org_context

    stmt = select(Workflow).where(Workflow.organization_id == organization_id)

    if workflow_status:
        stmt = stmt.where(Workflow.status == workflow_status.value)
    if search:
        stmt = stmt.where(Workflow.name.ilike(f"%{search.strip()}%"))

    # Total count
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = await db.scalar(count_stmt) or 0

    # Pagination
    offset = (page - 1) * page_size
    stmt = stmt.order_by(Workflow.updated_at.desc()).offset(offset).limit(page_size)
    result = await db.execute(stmt)
    workflows = result.scalars().all()

    items = [await _build_workflow_response(db, wf) for wf in workflows]
    total_pages = math.ceil(total / page_size) if total > 0 else 1

    return WorkflowListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get(
    "/{workflow_id}",
    response_model=WorkflowResponse,
    summary="Get workflow details",
)
async def get_workflow(
    organization_id: uuid.UUID,
    workflow_id: uuid.UUID,
    org_context: Tuple[Organization, OrganizationMember] = Depends(get_org_context),
    db: AsyncSession = Depends(get_db),
):
    """
    Retrieves workflow metadata, active version, and version count.
    """
    workflow = await _get_workflow_or_404(db, organization_id, workflow_id)
    return await _build_workflow_response(db, workflow)


@router.put(
    "/{workflow_id}",
    response_model=WorkflowResponse,
    summary="Update workflow metadata",
)
async def update_workflow(
    organization_id: uuid.UUID,
    workflow_id: uuid.UUID,
    req: WorkflowUpdateRequest,
    org_context: Tuple[Organization, OrganizationMember] = Depends(
        require_role([OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.MANAGER])
    ),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Updates workflow name and description.
    """
    workflow = await _get_workflow_or_404(db, organization_id, workflow_id)

    updated_fields = []
    if req.name is not None:
        workflow.name = req.name.strip()
        updated_fields.append("name")
    if req.description is not None:
        workflow.description = req.description.strip()
        updated_fields.append("description")

    audit_entry = AuditLog(
        organization_id=organization_id,
        user_id=current_user.id,
        action="workflow.updated",
        resource_type="workflow",
        resource_id=str(workflow.id),
        details={"name": workflow.name, "updated_fields": updated_fields},
    )
    db.add(audit_entry)

    await db.commit()
    await db.refresh(workflow)
    return await _build_workflow_response(db, workflow)


@router.delete(
    "/{workflow_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete workflow (hard cascade deletion)",
)
async def delete_workflow(
    organization_id: uuid.UUID,
    workflow_id: uuid.UUID,
    org_context: Tuple[Organization, OrganizationMember] = Depends(
        require_role([OrganizationRole.OWNER, OrganizationRole.ADMIN])
    ),
    db: AsyncSession = Depends(get_db),
):
    """
    Permanently deletes a workflow and all child versions/steps/connections/runs.
    Restricted to OWNER and ADMIN roles only.
    """
    workflow = await _get_workflow_or_404(db, organization_id, workflow_id)
    await db.delete(workflow)
    await db.commit()
    return None


@router.post(
    "/{workflow_id}/enable",
    response_model=WorkflowResponse,
    summary="Enable/activate workflow",
)
async def enable_workflow(
    organization_id: uuid.UUID,
    workflow_id: uuid.UUID,
    org_context: Tuple[Organization, OrganizationMember] = Depends(
        require_role([OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.MANAGER])
    ),
    db: AsyncSession = Depends(get_db),
):
    """
    Activates a workflow. Requires an active published version.
    """
    workflow = await _get_workflow_or_404(db, organization_id, workflow_id)

    if not workflow.active_version_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot enable workflow without a published active version",
        )

    workflow.status = WorkflowStatus.ACTIVE.value
    await db.commit()
    await db.refresh(workflow)
    return await _build_workflow_response(db, workflow)


@router.post(
    "/{workflow_id}/disable",
    response_model=WorkflowResponse,
    summary="Disable/pause workflow",
)
async def disable_workflow(
    organization_id: uuid.UUID,
    workflow_id: uuid.UUID,
    org_context: Tuple[Organization, OrganizationMember] = Depends(
        require_role([OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.MANAGER])
    ),
    db: AsyncSession = Depends(get_db),
):
    """
    Pauses an active workflow, preventing new runs from starting.
    """
    workflow = await _get_workflow_or_404(db, organization_id, workflow_id)
    workflow.status = WorkflowStatus.PAUSED.value
    await db.commit()
    await db.refresh(workflow)
    return await _build_workflow_response(db, workflow)


@router.post(
    "/{workflow_id}/archive",
    response_model=WorkflowResponse,
    summary="Archive workflow (soft deletion)",
)
async def archive_workflow(
    organization_id: uuid.UUID,
    workflow_id: uuid.UUID,
    org_context: Tuple[Organization, OrganizationMember] = Depends(
        require_role([OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.MANAGER])
    ),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Archives a workflow (soft deletion). Prevents new executions while
    preserving all workflow versions, steps, execution runs, and audit logs.
    """
    workflow = await _get_workflow_or_404(db, organization_id, workflow_id)
    workflow.status = WorkflowStatus.ARCHIVED.value

    audit_entry = AuditLog(
        organization_id=organization_id,
        user_id=current_user.id,
        action="workflow.archived",
        resource_type="workflow",
        resource_id=str(workflow.id),
        details={"name": workflow.name, "status": "ARCHIVED"},
    )
    db.add(audit_entry)

    await db.commit()
    await db.refresh(workflow)
    return await _build_workflow_response(db, workflow)


# ==============================================================================
# 2. Workflow Version Endpoints
# ==============================================================================

@router.get(
    "/{workflow_id}/versions",
    response_model=List[WorkflowVersionSummaryResponse],
    summary="List versions for workflow",
)
async def list_workflow_versions(
    organization_id: uuid.UUID,
    workflow_id: uuid.UUID,
    org_context: Tuple[Organization, OrganizationMember] = Depends(get_org_context),
    db: AsyncSession = Depends(get_db),
):
    """
    Lists all versions for a workflow ordered by version number descending.
    """
    await _get_workflow_or_404(db, organization_id, workflow_id)

    stmt = (
        select(WorkflowVersion)
        .where(WorkflowVersion.workflow_id == workflow_id)
        .order_by(WorkflowVersion.version_number.desc())
    )
    result = await db.execute(stmt)
    versions = result.scalars().all()
    return versions


@router.get(
    "/{workflow_id}/versions/{version_id}",
    response_model=WorkflowVersionDetailResponse,
    summary="Get workflow version details",
)
async def get_workflow_version(
    organization_id: uuid.UUID,
    workflow_id: uuid.UUID,
    version_id: uuid.UUID,
    org_context: Tuple[Organization, OrganizationMember] = Depends(get_org_context),
    db: AsyncSession = Depends(get_db),
):
    """
    Retrieves full details for a workflow version, including all steps and connections.
    """
    workflow, version = await _get_version_or_404(
        db, organization_id, workflow_id, version_id
    )

    steps_stmt = (
        select(WorkflowStep)
        .where(WorkflowStep.workflow_version_id == version.id)
        .order_by(WorkflowStep.created_at.asc())
    )
    steps = (await db.execute(steps_stmt)).scalars().all()

    conns_stmt = (
        select(WorkflowConnection)
        .where(WorkflowConnection.workflow_version_id == version.id)
        .order_by(WorkflowConnection.created_at.asc())
    )
    conns = (await db.execute(conns_stmt)).scalars().all()

    return _build_version_detail_response(version, list(steps), list(conns))


@router.post(
    "/{workflow_id}/versions",
    response_model=WorkflowVersionDetailResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new draft version",
)
async def create_workflow_version(
    organization_id: uuid.UUID,
    workflow_id: uuid.UUID,
    req: WorkflowVersionCreateRequest,
    org_context: Tuple[Organization, OrganizationMember] = Depends(
        require_role([OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.MANAGER])
    ),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Creates a new draft version with an incremented version number.
    Optionally clones steps and connections from a base_version_id.
    """
    workflow = await _get_workflow_or_404(db, organization_id, workflow_id)

    # Server-side version number calculation
    max_v_stmt = select(func.max(WorkflowVersion.version_number)).where(
        WorkflowVersion.workflow_id == workflow_id
    )
    max_version = await db.scalar(max_v_stmt) or 0
    next_version = max_version + 1

    new_version = WorkflowVersion(
        workflow_id=workflow.id,
        version_number=next_version,
        status=WorkflowVersionStatus.DRAFT.value,
        definition={"steps": [], "connections": []},
        created_by=current_user.id,
    )
    db.add(new_version)
    await db.flush()

    new_steps = []
    new_connections = []

    # Clone from base version if requested
    if req.base_version_id:
        base_v_stmt = select(WorkflowVersion).where(
            WorkflowVersion.id == req.base_version_id,
            WorkflowVersion.workflow_id == workflow.id,
        )
        base_version = (await db.execute(base_v_stmt)).scalar_one_or_none()
        if not base_version:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Base workflow version not found",
            )

        # Clone steps
        base_step_stmt = select(WorkflowStep).where(
            WorkflowStep.workflow_version_id == base_version.id
        )
        base_steps = (await db.execute(base_step_stmt)).scalars().all()

        step_id_map = {}
        for bs in base_steps:
            cloned_step = WorkflowStep(
                workflow_version_id=new_version.id,
                step_key=bs.step_key,
                step_type=bs.step_type,
                name=bs.name,
                config=dict(bs.config) if bs.config else {},
                ui_position=dict(bs.ui_position) if bs.ui_position else {"x": 0, "y": 0},
            )
            db.add(cloned_step)
            await db.flush()
            step_id_map[bs.id] = cloned_step.id
            new_steps.append(cloned_step)

        # Clone connections
        base_conn_stmt = select(WorkflowConnection).where(
            WorkflowConnection.workflow_version_id == base_version.id
        )
        base_conns = (await db.execute(base_conn_stmt)).scalars().all()

        for bc in base_conns:
            if bc.source_step_id in step_id_map and bc.target_step_id in step_id_map:
                cloned_conn = WorkflowConnection(
                    workflow_version_id=new_version.id,
                    source_step_id=step_id_map[bc.source_step_id],
                    target_step_id=step_id_map[bc.target_step_id],
                    condition_label=bc.condition_label,
                )
                db.add(cloned_conn)
                new_connections.append(cloned_conn)

        # Mirror base definition
        new_version.definition = dict(base_version.definition) if base_version.definition else {}

    await db.commit()
    await db.refresh(new_version)

    return _build_version_detail_response(new_version, new_steps, new_connections)


@router.put(
    "/{workflow_id}/versions/{version_id}",
    response_model=WorkflowVersionDetailResponse,
    summary="Update steps and connections of a draft version",
)
async def update_workflow_version(
    organization_id: uuid.UUID,
    workflow_id: uuid.UUID,
    version_id: uuid.UUID,
    req: WorkflowVersionUpdateRequest,
    org_context: Tuple[Organization, OrganizationMember] = Depends(
        require_role([OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.MANAGER])
    ),
    db: AsyncSession = Depends(get_db),
):
    """
    Updates the steps and connections of a draft workflow version.
    Published versions are strictly immutable and cannot be updated.
    """
    workflow, version = await _get_version_or_404(
        db, organization_id, workflow_id, version_id, for_update=True
    )

    if version.status == WorkflowVersionStatus.PUBLISHED.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Published workflow versions are immutable. Create a new draft version to make changes.",
        )

    # Clean existing steps and connections for this draft version
    await db.execute(
        delete(WorkflowConnection).where(
            WorkflowConnection.workflow_version_id == version.id
        )
    )
    await db.execute(
        delete(WorkflowStep).where(WorkflowStep.workflow_version_id == version.id)
    )
    await db.flush()

    # Re-insert steps
    key_to_step_map = {}
    created_steps = []

    for s_in in req.steps:
        new_step = WorkflowStep(
            workflow_version_id=version.id,
            step_key=s_in.step_key,
            step_type=s_in.step_type,
            name=s_in.name,
            config=s_in.config,
            ui_position=s_in.ui_position,
        )
        db.add(new_step)
        await db.flush()
        key_to_step_map[s_in.step_key] = new_step
        created_steps.append(new_step)

    # Re-insert connections
    created_connections = []
    for c_in in req.connections:
        src_step = key_to_step_map.get(c_in.source_step_key)
        tgt_step = key_to_step_map.get(c_in.target_step_key)

        if not src_step or not tgt_step:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Connection references nonexistent step: {c_in.source_step_key} -> {c_in.target_step_key}",
            )

        new_conn = WorkflowConnection(
            workflow_version_id=version.id,
            source_step_id=src_step.id,
            target_step_id=tgt_step.id,
            condition_label=c_in.condition_label,
        )
        db.add(new_conn)
        created_connections.append(new_conn)

    # Save JSON definition snapshot (preserving SLA if set)
    existing_def = dict(version.definition) if version.definition else {}
    new_def = {
        "steps": [s.model_dump() for s in req.steps],
        "connections": [c.model_dump() for c in req.connections],
    }
    if "sla" in existing_def:
        new_def["sla"] = existing_def["sla"]
    version.definition = new_def

    await db.commit()
    await db.refresh(version)

    return _build_version_detail_response(version, created_steps, created_connections)


@router.post(
    "/{workflow_id}/versions/{version_id}/validate",
    response_model=WorkflowValidationResult,
    summary="Validate workflow version without publishing",
)
async def validate_workflow_version(
    organization_id: uuid.UUID,
    workflow_id: uuid.UUID,
    version_id: uuid.UUID,
    org_context: Tuple[Organization, OrganizationMember] = Depends(get_org_context),
    db: AsyncSession = Depends(get_db),
):
    """
    Performs dry-run DAG validation for a workflow version.
    Returns HTTP 200 with valid, errors, and warnings.
    """
    workflow, version = await _get_version_or_404(
        db, organization_id, workflow_id, version_id
    )

    steps_stmt = select(WorkflowStep).where(
        WorkflowStep.workflow_version_id == version.id
    )
    steps = (await db.execute(steps_stmt)).scalars().all()

    conns_stmt = select(WorkflowConnection).where(
        WorkflowConnection.workflow_version_id == version.id
    )
    conns = (await db.execute(conns_stmt)).scalars().all()

    step_id_to_key = {s.id: s.step_key for s in steps}
    conn_dicts = [
        {
            "source_step_key": step_id_to_key.get(c.source_step_id),
            "target_step_key": step_id_to_key.get(c.target_step_id),
            "condition_label": c.condition_label,
        }
        for c in conns
    ]

    return validate_workflow_dag(list(steps), conn_dicts)


@router.post(
    "/{workflow_id}/versions/{version_id}/publish",
    response_model=WorkflowResponse,
    summary="Publish validated workflow version",
)
async def publish_workflow_version(
    organization_id: uuid.UUID,
    workflow_id: uuid.UUID,
    version_id: uuid.UUID,
    org_context: Tuple[Organization, OrganizationMember] = Depends(
        require_role([OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.MANAGER])
    ),
    db: AsyncSession = Depends(get_db),
):
    """
    Validates and publishes a draft workflow version.
    Enforces concurrency-safe publishing via database row locking.
    If validation fails, returns HTTP 422 with structured validation errors.
    If valid, sets version status to PUBLISHED, workflow status to ACTIVE, and commits.
    """
    # Use row lock to protect against concurrent publishing
    workflow, version = await _get_version_or_404(
        db, organization_id, workflow_id, version_id, for_update=True
    )

    if version.status == WorkflowVersionStatus.PUBLISHED.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Workflow version is already published",
        )

    # Load steps and connections
    steps_stmt = select(WorkflowStep).where(
        WorkflowStep.workflow_version_id == version.id
    )
    steps = (await db.execute(steps_stmt)).scalars().all()

    conns_stmt = select(WorkflowConnection).where(
        WorkflowConnection.workflow_version_id == version.id
    )
    conns = (await db.execute(conns_stmt)).scalars().all()

    step_id_to_key = {s.id: s.step_key for s in steps}
    conn_dicts = [
        {
            "source_step_key": step_id_to_key.get(c.source_step_id),
            "target_step_key": step_id_to_key.get(c.target_step_id),
            "condition_label": c.condition_label,
        }
        for c in conns
    ]

    # Validate DAG
    val_result = validate_workflow_dag(list(steps), conn_dicts)
    if not val_result.valid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "message": "Workflow version validation failed",
                "errors": val_result.errors,
                "warnings": val_result.warnings,
            },
        )

    # Publish version and activate workflow
    version.status = WorkflowVersionStatus.PUBLISHED.value
    workflow.active_version_id = version.id
    workflow.status = WorkflowStatus.ACTIVE.value

    await db.commit()
    await db.refresh(workflow)

    return await _build_workflow_response(db, workflow)
