import uuid
from datetime import datetime, timezone
from typing import Optional, Tuple
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user, get_db, require_role
from app.core.encryption import decrypt_credentials, encrypt_credentials
from app.models.audit_log import AuditLog
from app.models.integration import Integration
from app.models.membership import OrganizationMember, OrganizationRole
from app.models.organization import Organization
from app.models.user import User
from app.schemas.integration import (
    IntegrationCreateRequest,
    IntegrationListResponse,
    IntegrationResponse,
    IntegrationStatus,
    IntegrationTestResponse,
    IntegrationType,
    IntegrationUpdateRequest,
)
from app.services.crm.mock_crm_service import MockCRMService
from app.services.slack.slack_service import SlackService

router = APIRouter(
    prefix="/organizations/{organization_id}/integrations",
    tags=["Integrations"],
)

admin_only = require_role([OrganizationRole.OWNER, OrganizationRole.ADMIN])
manager_or_above = require_role([
    OrganizationRole.OWNER,
    OrganizationRole.ADMIN,
    OrganizationRole.MANAGER,
])
all_members = require_role([
    OrganizationRole.OWNER,
    OrganizationRole.ADMIN,
    OrganizationRole.MANAGER,
    OrganizationRole.OPERATOR,
    OrganizationRole.VIEWER,
])


def _to_integration_response(item: Integration) -> IntegrationResponse:
    has_creds = bool(item.credentials_encrypted and len(item.credentials_encrypted) > 0)
    return IntegrationResponse(
        id=item.id,
        organization_id=item.organization_id,
        type=IntegrationType(item.type),
        name=item.name,
        status=IntegrationStatus(item.status),
        has_credentials=has_creds,
        config=item.config or {},
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


@router.get(
    "",
    response_model=IntegrationListResponse,
    summary="List integrations for organization",
)
async def list_integrations(
    organization_id: uuid.UUID,
    org_context: Tuple[Organization, OrganizationMember] = Depends(all_members),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(Integration)
        .where(Integration.organization_id == organization_id)
        .order_by(Integration.created_at.desc())
    )
    result = await db.execute(stmt)
    items = result.scalars().all()

    return IntegrationListResponse(
        items=[_to_integration_response(item) for item in items],
        total=len(items),
    )


@router.post(
    "",
    response_model=IntegrationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Connect or create integration",
)
async def create_integration(
    organization_id: uuid.UUID,
    payload: IntegrationCreateRequest,
    org_context: Tuple[Organization, OrganizationMember] = Depends(admin_only),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    name_clean = payload.name.strip()

    # Uniqueness check on (organization_id, name)
    existing_stmt = select(Integration).where(
        Integration.organization_id == organization_id,
        func.lower(Integration.name) == name_clean.lower(),
    )
    existing = (await db.execute(existing_stmt)).scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"An integration named '{name_clean}' already exists in this organization.",
        )

    # Encrypt credentials if provided
    encrypted_bytes = None
    if payload.credentials:
        encrypted_bytes = encrypt_credentials(payload.credentials, aad=organization_id.bytes)

    new_integration = Integration(
        organization_id=organization_id,
        type=payload.type.value,
        name=name_clean,
        status=IntegrationStatus.CONNECTED.value,
        credentials_encrypted=encrypted_bytes,
        config=payload.config or {},
    )
    db.add(new_integration)
    await db.flush()

    # Emit audit log
    audit_log = AuditLog(
        organization_id=organization_id,
        user_id=current_user.id,
        action="integration.created",
        resource_type="integration",
        resource_id=str(new_integration.id),
        details={
            "name": new_integration.name,
            "type": new_integration.type,
            "has_credentials": bool(encrypted_bytes),
        },
    )
    db.add(audit_log)
    await db.commit()
    await db.refresh(new_integration)

    return _to_integration_response(new_integration)


@router.get(
    "/{integration_id}",
    response_model=IntegrationResponse,
    summary="Get integration details",
)
async def get_integration(
    organization_id: uuid.UUID,
    integration_id: uuid.UUID,
    org_context: Tuple[Organization, OrganizationMember] = Depends(all_members),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Integration).where(
        Integration.id == integration_id,
        Integration.organization_id == organization_id,
    )
    integration = (await db.execute(stmt)).scalar_one_or_none()
    if not integration:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Integration not found",
        )

    return _to_integration_response(integration)


@router.put(
    "/{integration_id}",
    response_model=IntegrationResponse,
    summary="Update integration configuration or rotate credentials",
)
async def update_integration(
    organization_id: uuid.UUID,
    integration_id: uuid.UUID,
    payload: IntegrationUpdateRequest,
    org_context: Tuple[Organization, OrganizationMember] = Depends(admin_only),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Integration).where(
        Integration.id == integration_id,
        Integration.organization_id == organization_id,
    )
    integration = (await db.execute(stmt)).scalar_one_or_none()
    if not integration:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Integration not found",
        )

    if payload.name:
        name_clean = payload.name.strip()
        if name_clean.lower() != integration.name.lower():
            # Check name collision
            existing_stmt = select(Integration).where(
                Integration.organization_id == organization_id,
                func.lower(Integration.name) == name_clean.lower(),
                Integration.id != integration_id,
            )
            existing = (await db.execute(existing_stmt)).scalar_one_or_none()
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"An integration named '{name_clean}' already exists in this organization.",
                )
        integration.name = name_clean

    if payload.status:
        integration.status = payload.status.value

    if payload.config is not None:
        integration.config = payload.config

    # Credential lifecycle: replace, clear, or preserve
    if payload.credentials is not None and len(payload.credentials) > 0:
        integration.credentials_encrypted = encrypt_credentials(
            payload.credentials,
            aad=organization_id.bytes,
        )
    elif payload.clear_credentials or (payload.credentials is not None and len(payload.credentials) == 0):
        integration.credentials_encrypted = None
    # else: preserve existing credentials_encrypted

    audit_log = AuditLog(
        organization_id=organization_id,
        user_id=current_user.id,
        action="integration.updated",
        resource_type="integration",
        resource_id=str(integration.id),
        details={
            "name": integration.name,
            "type": integration.type,
            "status": integration.status,
            "has_credentials": bool(integration.credentials_encrypted),
        },
    )
    db.add(audit_log)
    await db.commit()
    await db.refresh(integration)

    return _to_integration_response(integration)


@router.delete(
    "/{integration_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Disconnect integration",
)
async def delete_integration(
    organization_id: uuid.UUID,
    integration_id: uuid.UUID,
    org_context: Tuple[Organization, OrganizationMember] = Depends(admin_only),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Integration).where(
        Integration.id == integration_id,
        Integration.organization_id == organization_id,
    )
    integration = (await db.execute(stmt)).scalar_one_or_none()
    if not integration:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Integration not found",
        )

    await db.delete(integration)

    audit_log = AuditLog(
        organization_id=organization_id,
        user_id=current_user.id,
        action="integration.deleted",
        resource_type="integration",
        resource_id=str(integration_id),
        details={
            "name": integration.name,
            "type": integration.type,
        },
    )
    db.add(audit_log)
    await db.commit()

    return None


@router.post(
    "/{integration_id}/test",
    response_model=IntegrationTestResponse,
    summary="Test integration handshake and latency",
)
async def test_integration(
    organization_id: uuid.UUID,
    integration_id: uuid.UUID,
    org_context: Tuple[Organization, OrganizationMember] = Depends(manager_or_above),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Integration).where(
        Integration.id == integration_id,
        Integration.organization_id == organization_id,
    )
    integration = (await db.execute(stmt)).scalar_one_or_none()
    if not integration:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Integration not found",
        )

    creds = {}
    if integration.credentials_encrypted:
        try:
            creds = decrypt_credentials(
                integration.credentials_encrypted,
                aad=organization_id.bytes,
            )
        except Exception:
            return IntegrationTestResponse(
                status="error",
                latency_ms=0.0,
                message="Failed to decrypt integration credentials. Key mismatch or corrupted data.",
                tested_at=datetime.now(timezone.utc),
            )

    try:
        if integration.type == IntegrationType.MOCK_CRM.value:
            crm_svc = MockCRMService()
            test_res = await crm_svc.test_connection(str(organization_id), credentials=creds)
        elif integration.type == IntegrationType.SLACK.value:
            slack_svc = SlackService()
            webhook_url = creds.get("webhook_url") or integration.config.get("webhook_url")
            if not webhook_url:
                return IntegrationTestResponse(
                    status="error",
                    latency_ms=0.0,
                    message="No webhook_url found in credentials or configuration.",
                    tested_at=datetime.now(timezone.utc),
                )
            test_res = await slack_svc.test_webhook(
                webhook_url=webhook_url,
                channel=integration.config.get("channel"),
                mock_mode=integration.config.get("mock_mode", False),
            )
        else:
            return IntegrationTestResponse(
                status="error",
                latency_ms=0.0,
                message=f"Unsupported integration type: {integration.type}",
                tested_at=datetime.now(timezone.utc),
            )

        # Audit connection test
        audit_log = AuditLog(
            organization_id=organization_id,
            user_id=current_user.id,
            action="integration.connection_tested",
            resource_type="integration",
            resource_id=str(integration.id),
            details={
                "name": integration.name,
                "type": integration.type,
                "status": test_res["status"],
                "latency_ms": test_res["latency_ms"],
            },
        )
        db.add(audit_log)
        await db.commit()

        return IntegrationTestResponse(
            status=test_res["status"],
            latency_ms=test_res["latency_ms"],
            message=test_res["message"],
            tested_at=datetime.fromisoformat(test_res["tested_at"]) if isinstance(test_res.get("tested_at"), str) else datetime.now(timezone.utc),
        )
    except Exception as e:
        return IntegrationTestResponse(
            status="error",
            latency_ms=0.0,
            message=f"Connection test failed: {str(e)}",
            tested_at=datetime.now(timezone.utc),
        )
