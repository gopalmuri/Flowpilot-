import math
import uuid
from datetime import datetime
from typing import Optional, Tuple
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_org_context, require_role
from app.core.database import get_db
from app.engine.sanitizer import sanitize_payload
from app.models.audit_log import AuditLog
from app.models.membership import OrganizationMember, OrganizationRole
from app.models.organization import Organization
from app.models.user import User
from app.schemas.audit import (
    AuditLogDetailResponse,
    AuditLogListResponse,
    AuditLogResponse,
)

router = APIRouter(
    prefix="/organizations/{organization_id}/audit-logs",
    tags=["Audit Logs"],
)


@router.get(
    "",
    response_model=AuditLogListResponse,
    summary="List organization audit logs with filtering and pagination",
)
async def list_organization_audit_logs(
    organization_id: uuid.UUID,
    action: Optional[str] = Query(None, description="Filter by canonical audit action (e.g. execution.completed)"),
    resource_type: Optional[str] = Query(None, description="Filter by resource type (e.g. workflow_run, workflow)"),
    resource_id: Optional[str] = Query(None, description="Filter by specific resource identifier"),
    user_id: Optional[uuid.UUID] = Query(None, description="Filter by actor user ID"),
    from_date: Optional[datetime] = Query(None, description="Filter events created at or after timestamp"),
    to_date: Optional[datetime] = Query(None, description="Filter events created at or before timestamp"),
    search: Optional[str] = Query(None, description="Case-insensitive text search matching action or resource_id"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    org_context: Tuple[Organization, OrganizationMember] = Depends(
        require_role([
            OrganizationRole.OWNER,
            OrganizationRole.ADMIN,
            OrganizationRole.MANAGER,
        ])
    ),
    db: AsyncSession = Depends(get_db),
):
    """
    Retrieves a paginated list of organization audit events.
    Access restricted to OWNER, ADMIN, and MANAGER roles.
    OPERATOR and VIEWER roles receive 403 Forbidden.
    Enforces strict tenant isolation and deterministic pagination.
    """
    stmt = (
        select(AuditLog, User.email, User.full_name)
        .outerjoin(User, AuditLog.user_id == User.id)
        .where(AuditLog.organization_id == organization_id)
    )

    if action:
        stmt = stmt.where(AuditLog.action == action)
    if resource_type:
        stmt = stmt.where(AuditLog.resource_type == resource_type)
    if resource_id:
        stmt = stmt.where(AuditLog.resource_id == resource_id)
    if user_id:
        stmt = stmt.where(AuditLog.user_id == user_id)
    if from_date:
        stmt = stmt.where(AuditLog.created_at >= from_date)
    if to_date:
        stmt = stmt.where(AuditLog.created_at <= to_date)
    if search:
        s = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                AuditLog.action.ilike(s),
                AuditLog.resource_id.ilike(s),
            )
        )

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = await db.scalar(count_stmt) or 0

    offset = (page - 1) * page_size
    stmt = stmt.order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).offset(offset).limit(page_size)
    results = (await db.execute(stmt)).all()

    items = []
    for log_entry, user_email, user_full_name in results:
        items.append(
            AuditLogResponse(
                id=log_entry.id,
                organization_id=log_entry.organization_id,
                user_id=log_entry.user_id,
                actor_name=user_full_name,
                actor_email=user_email,
                action=log_entry.action,
                resource_type=log_entry.resource_type,
                resource_id=log_entry.resource_id,
                details=sanitize_payload(log_entry.details or {}),
                ip_address=log_entry.ip_address,
                created_at=log_entry.created_at,
            )
        )

    total_pages = math.ceil(total / page_size) if total > 0 else 1
    return AuditLogListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get(
    "/{audit_id}",
    response_model=AuditLogDetailResponse,
    summary="Get single audit log entry detail",
)
async def get_audit_log_detail(
    organization_id: uuid.UUID,
    audit_id: uuid.UUID,
    org_context: Tuple[Organization, OrganizationMember] = Depends(
        require_role([
            OrganizationRole.OWNER,
            OrganizationRole.ADMIN,
            OrganizationRole.MANAGER,
        ])
    ),
    db: AsyncSession = Depends(get_db),
):
    """
    Retrieves full details for a single audit log event.
    Enforces multi-tenant boundary and RBAC access checks.
    """
    stmt = (
        select(AuditLog, User.email, User.full_name)
        .outerjoin(User, AuditLog.user_id == User.id)
        .where(
            AuditLog.id == audit_id,
            AuditLog.organization_id == organization_id,
        )
    )
    result = (await db.execute(stmt)).first()
    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Audit log entry not found",
        )

    log_entry, user_email, user_full_name = result
    return AuditLogDetailResponse(
        id=log_entry.id,
        organization_id=log_entry.organization_id,
        user_id=log_entry.user_id,
        actor_name=user_full_name,
        actor_email=user_email,
        action=log_entry.action,
        resource_type=log_entry.resource_type,
        resource_id=log_entry.resource_id,
        details=sanitize_payload(log_entry.details or {}),
        ip_address=log_entry.ip_address,
        created_at=log_entry.created_at,
    )
