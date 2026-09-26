from app.core.rate_limit import analytics_rate_limiter
import uuid
from datetime import datetime
from typing import Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user, get_org_context, require_role
from app.core.database import get_db
from app.models.audit_log import AuditLog
from app.models.membership import OrganizationMember, OrganizationRole
from app.models.organization import Organization
from app.models.user import User
from app.models.workflow import Workflow, WorkflowVersion
from app.schemas.analytics import (
    AnalyticsOverviewResponse,
    SLAConfig,
    SLAMonitoringResponse,
    SLAUpdateRequest,
    SLAVersionResponse,
    StepLatencyResponse,
    TimeSeriesResponse,
    WorkflowPerformanceResponse,
)
from app.services.analytics_service import AnalyticsService

router = APIRouter(tags=["Analytics & SLA"])


async def _verify_workflow_ownership(
    db: AsyncSession, organization_id: uuid.UUID, workflow_id: Optional[uuid.UUID]
) -> None:
    """Verifies that the optional workflow_id belongs to the specified organization."""
    if workflow_id is not None:
        stmt = select(Workflow.id).where(
            Workflow.id == workflow_id,
            Workflow.organization_id == organization_id,
        )
        res = await db.scalar(stmt)
        if not res:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Workflow not found in this organization",
            )


# ==============================================================================
# 1. Executive Overview Analytics
# ==============================================================================

@router.get(
    "/organizations/{organization_id}/analytics/overview",
    response_model=AnalyticsOverviewResponse,
    summary="Get execution KPI overview",
)
async def get_analytics_overview(
    organization_id: uuid.UUID,
    request: Request,
    response: Response,
    workflow_id: Optional[uuid.UUID] = Query(None, description="Optional workflow filter"),
    range: Optional[str] = Query("24h", description="Time range: 24h, 7d, 30d, 90d, custom"),
    start_time: Optional[datetime] = Query(None, description="UTC ISO-8601 start timestamp"),
    end_time: Optional[datetime] = Query(None, description="UTC ISO-8601 end timestamp"),
    org_context: Tuple[Organization, OrganizationMember] = Depends(get_org_context),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns aggregated execution volume, duration percentiles (p50/p95/p99), and SLA compliance metrics.
    Accessible by all organization members (VIEWER, OPERATOR, MANAGER, ADMIN, OWNER).
    """
    await analytics_rate_limiter(request, response)
    await _verify_workflow_ownership(db, organization_id, workflow_id)
    return await AnalyticsService.get_overview(
        db=db,
        organization_id=organization_id,
        workflow_id=workflow_id,
        time_range=range,
        start_time=start_time,
        end_time=end_time,
    )


# ==============================================================================
# 2. Time-Series Analytics
# ==============================================================================

@router.get(
    "/organizations/{organization_id}/analytics/time-series",
    response_model=TimeSeriesResponse,
    summary="Get execution time-series data with continuous buckets",
)
async def get_time_series(
    organization_id: uuid.UUID,
    workflow_id: Optional[uuid.UUID] = Query(None, description="Optional workflow filter"),
    range: Optional[str] = Query("24h", description="Time range: 24h, 7d, 30d, 90d, custom"),
    start_time: Optional[datetime] = Query(None, description="UTC ISO-8601 start timestamp"),
    end_time: Optional[datetime] = Query(None, description="UTC ISO-8601 end timestamp"),
    granularity: Optional[str] = Query(None, description="Bucket interval: hourly, daily, weekly"),
    org_context: Tuple[Organization, OrganizationMember] = Depends(get_org_context),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns continuous time-series buckets with zero-filled gaps for execution volumes and duration trends.
    Accessible by all organization members.
    """
    await _verify_workflow_ownership(db, organization_id, workflow_id)
    return await AnalyticsService.get_time_series(
        db=db,
        organization_id=organization_id,
        workflow_id=workflow_id,
        time_range=range,
        start_time=start_time,
        end_time=end_time,
        granularity=granularity,
    )


# ==============================================================================
# 3. Workflow Performance Analytics
# ==============================================================================

@router.get(
    "/organizations/{organization_id}/analytics/workflows",
    response_model=WorkflowPerformanceResponse,
    summary="Get paginated workflow-level performance metrics",
)
async def get_workflow_performance(
    organization_id: uuid.UUID,
    range: Optional[str] = Query("24h", description="Time range: 24h, 7d, 30d, 90d, custom"),
    start_time: Optional[datetime] = Query(None, description="UTC ISO-8601 start timestamp"),
    end_time: Optional[datetime] = Query(None, description="UTC ISO-8601 end timestamp"),
    sort_by: str = Query("executions", pattern="^(executions|failure_rate|avg_duration|breaches)$"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    org_context: Tuple[Organization, OrganizationMember] = Depends(get_org_context),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns paginated execution statistics, duration percentiles, and SLA compliance rates per workflow.
    Accessible by all organization members.
    """
    return await AnalyticsService.get_workflow_performance(
        db=db,
        organization_id=organization_id,
        time_range=range,
        start_time=start_time,
        end_time=end_time,
        sort_by=sort_by,
        sort_order=sort_order,
        page=page,
        page_size=page_size,
    )


# ==============================================================================
# 4. Step Latency and Bottleneck Analytics
# ==============================================================================

@router.get(
    "/organizations/{organization_id}/analytics/steps",
    response_model=StepLatencyResponse,
    summary="Get bounded step latency and failure metrics",
)
async def get_step_latency(
    organization_id: uuid.UUID,
    workflow_id: Optional[uuid.UUID] = Query(None, description="Optional workflow filter"),
    range: Optional[str] = Query("24h", description="Time range: 24h, 7d, 30d, 90d, custom"),
    start_time: Optional[datetime] = Query(None, description="UTC ISO-8601 start timestamp"),
    end_time: Optional[datetime] = Query(None, description="UTC ISO-8601 end timestamp"),
    limit: int = Query(20, ge=1, description="Requested limit (clamped to max 100)"),
    sort_by: str = Query("avg_latency", pattern="^(avg_latency|p95_latency|failure_rate|execution_count)$"),
    org_context: Tuple[Organization, OrganizationMember] = Depends(get_org_context),
    db: AsyncSession = Depends(get_db),
):
    """
    Identifies slowest and most error-prone steps across workflow executions.
    Bounded to a maximum of 100 steps. Accessible by all organization members.
    """
    await _verify_workflow_ownership(db, organization_id, workflow_id)
    return await AnalyticsService.get_step_latency(
        db=db,
        organization_id=organization_id,
        workflow_id=workflow_id,
        time_range=range,
        start_time=start_time,
        end_time=end_time,
        limit=limit,
        sort_by=sort_by,
    )


# ==============================================================================
# 5. SLA Monitoring & Health Analytics
# ==============================================================================

@router.get(
    "/organizations/{organization_id}/analytics/sla",
    response_model=SLAMonitoringResponse,
    summary="Get organization and per-workflow SLA health status",
)
async def get_sla_monitoring(
    organization_id: uuid.UUID,
    request: Request,
    response: Response,
    workflow_id: Optional[uuid.UUID] = Query(None, description="Optional workflow filter"),
    range: Optional[str] = Query("24h", description="Time range: 24h, 7d, 30d, 90d, custom"),
    start_time: Optional[datetime] = Query(None, description="UTC ISO-8601 start timestamp"),
    end_time: Optional[datetime] = Query(None, description="UTC ISO-8601 end timestamp"),
    org_context: Tuple[Organization, OrganizationMember] = Depends(get_org_context),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns comprehensive SLA monitoring metrics including healthy, warning, and breached counts.
    Accessible by all organization members.
    """
    await analytics_rate_limiter(request, response)
    await _verify_workflow_ownership(db, organization_id, workflow_id)
    return await AnalyticsService.get_sla_monitoring(
        db=db,
        organization_id=organization_id,
        workflow_id=workflow_id,
        time_range=range,
        start_time=start_time,
        end_time=end_time,
    )


# ==============================================================================
# 6. Version-Scoped SLA Configuration
# ==============================================================================

@router.put(
    "/organizations/{organization_id}/workflows/{workflow_id}/versions/{version_id}/sla",
    response_model=SLAVersionResponse,
    summary="Configure SLA thresholds for a draft workflow version",
)
async def update_version_sla(
    organization_id: uuid.UUID,
    workflow_id: uuid.UUID,
    version_id: uuid.UUID,
    req: SLAUpdateRequest,
    org_context: Tuple[Organization, OrganizationMember] = Depends(
        require_role([OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.MANAGER])
    ),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Configures SLA thresholds on a DRAFT workflow version.
    Strictly forbids modifying PUBLISHED versions (enforces Phase 14 immutability).
    Emits an append-only 'workflow.sla_updated' audit event atomically.
    Requires MANAGER, ADMIN, or OWNER role.
    """
    # 1. Fetch workflow and verify tenant ownership
    wf_stmt = select(Workflow).where(
        Workflow.id == workflow_id,
        Workflow.organization_id == organization_id,
    )
    workflow = (await db.execute(wf_stmt)).scalar_one_or_none()
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow not found",
        )

    # 2. Fetch version
    v_stmt = select(WorkflowVersion).where(
        WorkflowVersion.id == version_id,
        WorkflowVersion.workflow_id == workflow.id,
    )
    version = (await db.execute(v_stmt)).scalar_one_or_none()
    if not version:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow version not found",
        )

    # 3. Strictly enforce immutability: published versions cannot have SLA modified
    if version.status.upper() == "PUBLISHED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Published workflow versions are immutable. Create a new draft version to update SLA targets.",
        )

    # 4. Atomic update of definition["sla"]
    old_sla = version.definition.get("sla") if version.definition else None
    new_sla = {
        "target_seconds": req.target_seconds,
        "warning_threshold_seconds": req.warning_threshold_seconds,
        "enabled": req.enabled,
    }

    updated_definition = dict(version.definition) if version.definition else {}
    updated_definition["sla"] = new_sla
    version.definition = updated_definition

    # 5. Append-only audit logging (strictly numeric/config metadata, ZERO secrets)
    audit_entry = AuditLog(
        organization_id=organization_id,
        user_id=current_user.id,
        action="workflow.sla_updated",
        resource_type="workflow",
        resource_id=str(workflow.id),
        details={
            "workflow_id": str(workflow.id),
            "version_id": str(version.id),
            "version_number": version.version_number,
            "old_sla": old_sla,
            "new_sla": new_sla,
        },
    )
    db.add(audit_entry)

    await db.commit()
    await db.refresh(version)

    return SLAVersionResponse(
        workflow_id=workflow.id,
        version_id=version.id,
        version_number=version.version_number,
        status=version.status,
        sla=SLAConfig(**new_sla),
    )
