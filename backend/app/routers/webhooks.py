from app.core.rate_limit import public_webhook_rate_limiter, tenant_webhook_rate_limiter
import json
import secrets
import uuid
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from app.workers.tasks import execute_workflow_run
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.deps import get_current_active_user, get_org_context, require_role
from app.core.database import async_session_maker, get_db
from app.core.logging import logger
from app.core.security import decode_token, is_access_token_revoked
from app.engine.sanitizer import sanitize_error_message, sanitize_payload
from app.engine.workflow_engine import WorkflowEngine
from app.models.audit_log import AuditLog
from app.models.base import utc_now
from app.models.organization import Organization
from app.models.membership import OrganizationMember, OrganizationRole
from app.models.user import User
from app.models.workflow import Workflow, WorkflowVersion
from app.models.workflow_step import WorkflowStep
from app.schemas.webhook import (
    WebhookDetailsResponse,
    WebhookKeyRotateResponse,
    WebhookResponse,
)
from app.services.webhook_service import (
    extract_signature_header,
    extract_webhook_secret_and_config,
    get_or_create_idempotent_run,
    validate_payload_size,
    verify_hmac_signature,
)

router = APIRouter(tags=["Webhooks"])


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


async def _authenticate_tenant_webhook(
    organization_id: uuid.UUID,
    workflow: Workflow,
    request: Request,
    secret_token: Optional[str],
    raw_body: bytes,
    db: AsyncSession,
) -> None:
    """
    Authenticates tenant-scoped webhook requests:
    1. If HMAC signature header is present, verifies cryptographic signature.
    2. If Bearer token is present, verifies organization membership and role.
    3. Otherwise, raises HTTP 401 Unauthorized.
    """
    sig_header = extract_signature_header(request.headers)
    auth_header = request.headers.get("Authorization")

    if sig_header:
        if not secret_token:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Webhook signing secret is not configured for this workflow",
            )
        ts_header = request.headers.get("X-Webhook-Timestamp") or request.headers.get("x-webhook-timestamp")
        verify_hmac_signature(
            raw_body=raw_body,
            signature_header=sig_header,
            secret_token=secret_token,
            timestamp_str=ts_header,
        )
        return

    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ", 1)[1].strip()
        try:
            payload = decode_token(token, expected_type="access")
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=str(e),
                headers={"WWW-Authenticate": "Bearer"},
            )
        jti = payload.get("jti")
        if jti and await is_access_token_revoked(jti):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token has been revoked",
                headers={"WWW-Authenticate": "Bearer"},
            )
        user_id_str = payload.get("sub")
        if not user_id_str:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token subject",
            )
        try:
            user_id = uuid.UUID(user_id_str)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid user identifier",
            )

        stmt = select(OrganizationMember).where(
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.user_id == user_id,
        )
        membership = (await db.execute(stmt)).scalar_one_or_none()
        if not membership:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Organization not found",
            )
        if membership.role not in [
            OrganizationRole.OWNER.value,
            OrganizationRole.ADMIN.value,
            OrganizationRole.MANAGER.value,
            OrganizationRole.OPERATOR.value,
        ]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions to execute workflow webhook",
            )
        return

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Missing webhook signature or authorization token",
    )


# ==============================================================================
# 1. Public Direct Ingestion Route
# ==============================================================================

@router.post(
    "/webhooks/{webhook_key}",
    response_model=WebhookResponse,
    status_code=status.HTTP_200_OK,
    summary="Public inbound webhook ingestion endpoint",
)
async def handle_public_webhook(
    webhook_key: str,
    request: Request,
    response: Response,
    async_dispatch: bool = Query(False, description="Dispatch execution to Celery background workers and return 202 Accepted"),
    db: AsyncSession = Depends(get_db),
):
    """
    Public inbound webhook ingestion endpoint.
    - Resolves workflow by public webhook_key.
    - Requires and verifies HMAC-SHA256 signature using the workflow's private secret_token.
    - Enforces 64KB payload limit and replay attack prevention (300s timestamp window).
    - Serializes idempotency via PostgreSQL savepoints.
    - Only the winning request initiates DAG traversal (Execution Ownership Guarantee).
    """
    await public_webhook_rate_limiter(request, response)
    raw_body = await request.body()
    validate_payload_size(raw_body)

    # 1. Resolve workflow by webhook_key
    stmt = select(Workflow).where(Workflow.webhook_key == webhook_key)
    workflow = (await db.execute(stmt)).scalar_one_or_none()
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Webhook endpoint not found",
        )

    if workflow.status != "ACTIVE":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Workflow is not in ACTIVE status (current: {workflow.status})",
        )

    if not workflow.active_version_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Workflow has no active version configured",
        )

    ver_stmt = select(WorkflowVersion).where(
        WorkflowVersion.id == workflow.active_version_id,
        WorkflowVersion.workflow_id == workflow.id,
    )
    version = (await db.execute(ver_stmt)).scalar_one_or_none()
    if not version or version.status != "PUBLISHED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Active workflow version is not in PUBLISHED status",
        )

    # 2. Extract configuration & secret_token
    steps_stmt = select(WorkflowStep).where(
        WorkflowStep.workflow_version_id == version.id
    )
    steps = (await db.execute(steps_stmt)).scalars().all()
    secret_token, allowed_methods = extract_webhook_secret_and_config(steps)

    if not secret_token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Webhook signing secret is not configured for this workflow",
        )

    if request.method not in allowed_methods:
        raise HTTPException(
            status_code=status.HTTP_405_METHOD_NOT_ALLOWED,
            detail=f"Method {request.method} not allowed",
        )

    # 3. HMAC Verification & Replay Protection
    sig_header = extract_signature_header(request.headers)
    ts_header = request.headers.get("X-Webhook-Timestamp") or request.headers.get("x-webhook-timestamp")
    verify_hmac_signature(
        raw_body=raw_body,
        signature_header=sig_header,
        secret_token=secret_token,
        timestamp_str=ts_header,
    )

    # 4. Parse JSON payload
    try:
        payload = json.loads(raw_body.decode("utf-8")) if raw_body else {}
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid JSON payload",
        )

    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payload must be a JSON object",
        )

    clean_payload = sanitize_payload(payload)

    # 5. Idempotency & Run Management
    client_idempotency_key = request.headers.get("Idempotency-Key") or request.headers.get("idempotency-key")
    corr_header = request.headers.get("X-Correlation-ID") or request.headers.get("x-correlation-id")
    correlation_id = corr_header or f"corr_{secrets.token_hex(16)}"

    factory = _get_session_factory(db)
    run, is_winner, is_idempotent = await get_or_create_idempotent_run(
        session_factory=factory,
        organization_id=workflow.organization_id,
        workflow_id=workflow.id,
        version_id=version.id,
        clean_payload=clean_payload,
        correlation_id=correlation_id,
        client_idempotency_key=client_idempotency_key,
        operation_scope="webhook",
        trigger_type="WEBHOOK",
    )

    # 6. Execution Ownership Guarantee
    is_async = async_dispatch or (request.headers.get("X-Async-Dispatch", "").lower() == "true")
    if is_async:
        response.status_code = status.HTTP_202_ACCEPTED
        if is_winner:
            execute_workflow_run.delay(
                organization_id=str(workflow.organization_id),
                run_id=str(run.id),
                version_id=str(version.id),
                trigger_payload=clean_payload,
                correlation_id=run.correlation_id,
            )
    else:
        if is_winner:
            engine = WorkflowEngine(session_factory=factory)
            run = await engine.execute_run_dag(
                organization_id=workflow.organization_id,
                run_id=run.id,
                version_id=version.id,
                trigger_payload=clean_payload,
            )

    # Return response
    return WebhookResponse(
        workflow_run_id=run.id,
        workflow_id=workflow.id,
        status=run.status,
        idempotent=is_idempotent,
        correlation_id=run.correlation_id,
        created_at=run.started_at,
        execution_summary={
            "status": run.status,
            "completed_at": run.completed_at.isoformat() if run.completed_at else None,
            "error_message": run.error_message,
        },
    )


# ==============================================================================
# 2. Tenant-Scoped Webhook Ingestion Route
# ==============================================================================

@router.post(
    "/organizations/{organization_id}/workflows/{workflow_id}/webhook",
    response_model=WebhookResponse,
    status_code=status.HTTP_200_OK,
    summary="Tenant-scoped webhook ingestion endpoint",
)
async def handle_tenant_webhook(
    organization_id: uuid.UUID,
    workflow_id: uuid.UUID,
    request: Request,
    response: Response,
    async_dispatch: bool = Query(False, description="Dispatch execution to Celery background workers and return 202 Accepted"),
    db: AsyncSession = Depends(get_db),
):
    """
    Tenant-scoped inbound webhook ingestion endpoint.
    - Enforces tenant isolation (returns 404 if workflow doesn't belong to organization).
    - Authenticates via HMAC-SHA256 signature OR organization Bearer credentials.
    - Enforces 64KB payload limit and replay attack protection.
    - Serializes idempotency with operation_scope="webhook".
    - Execution ownership: only winner executes DAG traversal.
    """
    raw_body = await request.body()
    validate_payload_size(raw_body)

    stmt = select(Workflow).where(
        Workflow.id == workflow_id,
        Workflow.organization_id == organization_id,
    )
    workflow = (await db.execute(stmt)).scalar_one_or_none()
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow not found",
        )

    if workflow.status != "ACTIVE":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Workflow is not in ACTIVE status (current: {workflow.status})",
        )

    if not workflow.active_version_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Workflow has no active version configured",
        )

    ver_stmt = select(WorkflowVersion).where(
        WorkflowVersion.id == workflow.active_version_id,
        WorkflowVersion.workflow_id == workflow.id,
    )
    version = (await db.execute(ver_stmt)).scalar_one_or_none()
    if not version or version.status != "PUBLISHED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Active workflow version is not in PUBLISHED status",
        )

    steps_stmt = select(WorkflowStep).where(
        WorkflowStep.workflow_version_id == version.id
    )
    steps = (await db.execute(steps_stmt)).scalars().all()
    secret_token, allowed_methods = extract_webhook_secret_and_config(steps)

    if request.method not in allowed_methods:
        raise HTTPException(
            status_code=status.HTTP_405_METHOD_NOT_ALLOWED,
            detail=f"Method {request.method} not allowed",
        )

    # Authenticate via HMAC or Bearer
    await _authenticate_tenant_webhook(
        organization_id=organization_id,
        workflow=workflow,
        request=request,
        secret_token=secret_token,
        raw_body=raw_body,
        db=db,
    )

    # Parse JSON
    try:
        payload = json.loads(raw_body.decode("utf-8")) if raw_body else {}
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid JSON payload",
        )

    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payload must be a JSON object",
        )

    clean_payload = sanitize_payload(payload)

    # Idempotency
    client_idempotency_key = request.headers.get("Idempotency-Key") or request.headers.get("idempotency-key")
    corr_header = request.headers.get("X-Correlation-ID") or request.headers.get("x-correlation-id")
    correlation_id = corr_header or f"corr_{secrets.token_hex(16)}"

    factory = _get_session_factory(db)
    run, is_winner, is_idempotent = await get_or_create_idempotent_run(
        session_factory=factory,
        organization_id=workflow.organization_id,
        workflow_id=workflow.id,
        version_id=version.id,
        clean_payload=clean_payload,
        correlation_id=correlation_id,
        client_idempotency_key=client_idempotency_key,
        operation_scope="webhook",
        trigger_type="WEBHOOK",
    )

    is_async = async_dispatch or (request.headers.get("X-Async-Dispatch", "").lower() == "true")
    if is_async:
        response.status_code = status.HTTP_202_ACCEPTED
        if is_winner:
            execute_workflow_run.delay(
                organization_id=str(workflow.organization_id),
                run_id=str(run.id),
                version_id=str(version.id),
                trigger_payload=clean_payload,
                correlation_id=run.correlation_id,
            )
    else:
        if is_winner:
            engine = WorkflowEngine(session_factory=factory)
            run = await engine.execute_run_dag(
                organization_id=workflow.organization_id,
                run_id=run.id,
                version_id=version.id,
                trigger_payload=clean_payload,
            )

    return WebhookResponse(
        workflow_run_id=run.id,
        workflow_id=workflow.id,
        status=run.status,
        idempotent=is_idempotent,
        correlation_id=run.correlation_id,
        created_at=run.started_at,
        execution_summary={
            "status": run.status,
            "completed_at": run.completed_at.isoformat() if run.completed_at else None,
            "error_message": run.error_message,
        },
    )


# ==============================================================================
# 3. Webhook Inspection Route (Strict Zero-Secret Exposure)
# ==============================================================================

@router.get(
    "/organizations/{organization_id}/workflows/{workflow_id}/webhook",
    response_model=WebhookDetailsResponse,
    summary="Inspect webhook configuration details",
)
async def inspect_webhook(
    organization_id: uuid.UUID,
    workflow_id: uuid.UUID,
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
    Inspects webhook configuration details for an organization's workflow.
    Allowed roles: OWNER, ADMIN, MANAGER, OPERATOR. VIEWER receives 403.
    Strict zero-secret policy: Returns only has_secret_token boolean.
    Secrets and partial previews are never exposed.
    """
    stmt = select(Workflow).where(
        Workflow.id == workflow_id,
        Workflow.organization_id == organization_id,
    )
    workflow = (await db.execute(stmt)).scalar_one_or_none()
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow not found",
        )

    has_secret_token = False
    allowed_methods = ["POST"]

    if workflow.active_version_id:
        steps_stmt = select(WorkflowStep).where(
            WorkflowStep.workflow_version_id == workflow.active_version_id
        )
        steps = (await db.execute(steps_stmt)).scalars().all()
        secret_token, methods = extract_webhook_secret_and_config(steps)
        has_secret_token = bool(secret_token)
        allowed_methods = methods

    webhook_url = f"/api/v1/webhooks/{workflow.webhook_key}" if workflow.webhook_key else ""

    return WebhookDetailsResponse(
        webhook_url=webhook_url,
        webhook_key=workflow.webhook_key or "",
        allowed_methods=allowed_methods,
        has_secret_token=has_secret_token,
        is_active=(workflow.status == "ACTIVE"),
    )


# ==============================================================================
# 4. Webhook Key Rotation Route
# ==============================================================================

@router.post(
    "/organizations/{organization_id}/workflows/{workflow_id}/webhook/rotate-key",
    response_model=WebhookKeyRotateResponse,
    summary="Rotate public webhook routing key",
)
async def rotate_webhook_key(
    organization_id: uuid.UUID,
    workflow_id: uuid.UUID,
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
    Rotates the public routing webhook_key.
    Allowed roles: OWNER, ADMIN, MANAGER. OPERATOR and VIEWER receive 403.
    Immediately invalidates old key (subsequent calls return 404).
    Audits the rotation event without leaking any secret tokens.
    """
    stmt = select(Workflow).where(
        Workflow.id == workflow_id,
        Workflow.organization_id == organization_id,
    )
    workflow = (await db.execute(stmt)).scalar_one_or_none()
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow not found",
        )

    new_key = secrets.token_urlsafe(32)
    workflow.webhook_key = new_key

    audit_entry = AuditLog(
        organization_id=organization_id,
        user_id=current_user.id,
        action="WORKFLOW_WEBHOOK_KEY_ROTATED",
        resource_type="workflow",
        resource_id=str(workflow.id),
        details={
            "workflow_name": workflow.name,
            "rotated_at": utc_now().isoformat(),
        },
    )
    db.add(audit_entry)
    await db.commit()
    await db.refresh(workflow)

    logger.info(
        f"Webhook key rotated for workflow '{workflow.id}' in organization '{organization_id}' by user '{current_user.id}'"
    )

    return WebhookKeyRotateResponse(
        webhook_key=workflow.webhook_key,
        webhook_url=f"/api/v1/webhooks/{workflow.webhook_key}",
        rotated_at=utc_now(),
    )
