"""
Operator view and controls for outbound deliveries.

Creating a delivery is deliberately not exposed here: only an approved draft reaching a SEND_REPLY step (through the
authorisation gate) can create one.
"""

import uuid
from typing import Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user, get_db, require_role
from app.models.membership import OrganizationMember, OrganizationRole
from app.models.organization import Organization
from app.models.outbound import OutboundDelivery
from app.models.user import User
from app.schemas.outbound import (
    STATUS_LABELS,
    DeliveryError,
    DeliveryListResponse,
    DeliveryResponse,
    DeliverySummary,
    ReconcileRequest,
)
from app.services.outbound import delivery as delivery_service

router = APIRouter(prefix="/organizations/{organization_id}/deliveries", tags=["Deliveries"])

manager_up = require_role([OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.MANAGER])
admin_up = require_role([OrganizationRole.OWNER, OrganizationRole.ADMIN])


def summarize(d: OutboundDelivery) -> DeliverySummary:
    has_error = bool(d.last_error_code or d.last_error_detail)
    return DeliverySummary(
        id=d.id,
        status=d.status,
        status_label=STATUS_LABELS.get(d.status, d.status),
        version_number=d.version_number,
        attempt_count=d.attempt_count,
        max_attempts=d.max_attempts,
        next_attempt_at=d.next_attempt_at,
        sent_at=d.sent_at,
        provider_message_id=d.provider_message_id,
        error=DeliveryError(category=d.last_error_category, code=d.last_error_code, detail=d.last_error_detail)
        if has_error
        else None,
    )


def to_response(d: OutboundDelivery) -> DeliveryResponse:
    return DeliveryResponse(
        **summarize(d).model_dump(),
        organization_id=d.organization_id,
        draft_id=d.draft_id,
        conversation_id=d.conversation_id,
        workflow_run_id=d.workflow_run_id,
        integration_id=d.integration_id,
        channel=d.channel,
        provider=d.provider,
        destination=d.destination,
        content_hash_prefix=d.content_hash[:16],
        resolution=d.resolution,
        created_at=d.created_at,
        updated_at=d.updated_at,
    )


async def _get(db: AsyncSession, organization_id: uuid.UUID, delivery_id: uuid.UUID) -> OutboundDelivery:
    row = (
        await db.execute(
            select(OutboundDelivery).where(
                OutboundDelivery.id == delivery_id, OutboundDelivery.organization_id == organization_id
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delivery not found")
    return row


@router.get("", response_model=DeliveryListResponse, summary="List outbound deliveries")
async def list_deliveries(
    organization_id: uuid.UUID,
    status_filter: Optional[str] = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    org_context: Tuple[Organization, OrganizationMember] = Depends(manager_up),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(OutboundDelivery).where(OutboundDelivery.organization_id == organization_id)
    if status_filter and status_filter.upper() != "ALL":
        stmt = stmt.where(OutboundDelivery.status == status_filter.upper())
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar() or 0
    rows = (
        (
            await db.execute(
                stmt.order_by(OutboundDelivery.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
            )
        )
        .scalars()
        .all()
    )
    return DeliveryListResponse(items=[to_response(r) for r in rows], total=total, page=page, page_size=page_size)


@router.get("/{delivery_id}", response_model=DeliveryResponse, summary="Get one outbound delivery")
async def get_delivery(
    organization_id: uuid.UUID,
    delivery_id: uuid.UUID,
    org_context: Tuple[Organization, OrganizationMember] = Depends(manager_up),
    db: AsyncSession = Depends(get_db),
):
    return to_response(await _get(db, organization_id, delivery_id))


async def _act(db: AsyncSession, action, *args) -> OutboundDelivery:
    try:
        result = await action(db, *args)
    except delivery_service.ActionRefused as err:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=err.message) from None
    if result is None:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delivery not found")
    await db.commit()
    await db.refresh(result)
    return result


@router.post("/{delivery_id}/cancel", response_model=DeliveryResponse, summary="Cancel a delivery that has not started")
async def cancel_delivery(
    organization_id: uuid.UUID,
    delivery_id: uuid.UUID,
    org_context: Tuple[Organization, OrganizationMember] = Depends(manager_up),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    user_id = current_user.id
    return to_response(await _act(db, delivery_service.cancel_delivery, organization_id, delivery_id, user_id))


@router.post("/{delivery_id}/retry", response_model=DeliveryResponse, summary="Retry a failed delivery now")
async def retry_delivery(
    organization_id: uuid.UUID,
    delivery_id: uuid.UUID,
    org_context: Tuple[Organization, OrganizationMember] = Depends(manager_up),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    user_id = current_user.id
    return to_response(await _act(db, delivery_service.retry_now, organization_id, delivery_id, user_id))


@router.post(
    "/{delivery_id}/reconcile",
    response_model=DeliveryResponse,
    summary="Resolve an UNKNOWN_OUTCOME after checking with the provider",
)
async def reconcile_delivery(
    organization_id: uuid.UUID,
    delivery_id: uuid.UUID,
    req: ReconcileRequest,
    org_context: Tuple[Organization, OrganizationMember] = Depends(admin_up),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    user_id = current_user.id
    return to_response(
        await _act(
            db,
            delivery_service.resolve_unknown,
            organization_id,
            delivery_id,
            user_id,
            req.outcome,
            req.provider_message_id,
        )
    )
