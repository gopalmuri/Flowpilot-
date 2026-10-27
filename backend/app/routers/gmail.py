"""
Gmail connection and notification endpoints.

Tenancy: every organization-scoped route derives access from the caller's membership (require_role). The two routes
Google calls (OAuth callback, Pub/Sub push) have no FlowPilot session, so they derive the organization only from
server-side records: the single-use OAuth state row, or our own `gmail_accounts` row after the push is authenticated.
No token or credential is ever returned by any route here.
"""

import uuid
from datetime import timedelta
from typing import Optional, Tuple
from urllib.parse import urlencode

from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.deps import get_current_active_user, get_db, require_role
from app.core.config import settings
from app.core.database import async_session_maker
from app.core.logging import logger
from app.core.rate_limit import inbound_ip_rate_limiter
from app.core.scheduler_health import is_healthy, read_last_tick
from app.models.base import utc_now
from app.models.gmail import (
    SYNC_NEEDS_REAUTH,
    WATCH_ACTIVE,
    WATCH_EXPIRED,
    WATCH_FAILED,
    GmailAccount,
)
from app.models.integration import Integration
from app.models.membership import OrganizationMember, OrganizationRole
from app.models.organization import Organization
from app.models.user import User
from app.routers.integrations import _validate_workflow_binding
from app.schemas.gmail import (
    AuthorizeRequest,
    AuthorizeResponse,
    GmailAccountsResponse,
    GmailAccountStatus,
    SchedulerStatus,
)
from app.services.gmail import accounts as account_service
from app.services.gmail import pubsub as pubsub_service
from app.services.gmail.deps import get_client_factory, get_oauth_client, get_pubsub_verifier
from app.services.gmail.errors import OAuthFlowError
from app.services.gmail.types import GmailClientFactory, OAuthClient

router = APIRouter(tags=["Gmail"])

NONCE_COOKIE = "flowpilot_gmail_nonce"
CALLBACK_PATH = "/api/v1/gmail/oauth"
PUBSUB_MAX_BODY = 16 * 1024

admin_only = require_role([OrganizationRole.OWNER, OrganizationRole.ADMIN])
manager_up = require_role([OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.MANAGER])


def _session_factory(db: AsyncSession) -> async_sessionmaker:
    bind = getattr(db, "bind", None)
    if bind is not None and hasattr(bind, "sync_engine"):
        return async_sessionmaker(
            bind=bind, class_=AsyncSession, expire_on_commit=False, autocommit=False, autoflush=False
        )
    return async_session_maker


# ============================================================================ status


def build_status(
    account: GmailAccount, integration: Integration, organization_name: Optional[str], scheduler_ok: bool
) -> GmailAccountStatus:
    now = utc_now()
    reasons = []
    if account.disconnected_at is not None or integration.status == "DISCONNECTED":
        health = "disconnected"
    elif account.sync_state == SYNC_NEEDS_REAUTH or integration.status == "ERROR":
        health, reasons = "needs_reauth", ["reauthorization_required"]
    else:
        if not scheduler_ok:
            reasons.append("scheduler_not_running")
        if account.last_sync_error:
            reasons.append(f"sync_error:{account.last_sync_error}")
        stale_after = timedelta(seconds=max(settings.GMAIL_POLL_INTERVAL_SECONDS * 5, 600))
        reference = account.last_sync_at or account.connected_at
        if now - reference > stale_after:
            reasons.append("sync_stale")
        if settings.GMAIL_PUBSUB_TOPIC:
            if account.watch_status in (WATCH_FAILED, WATCH_EXPIRED):
                reasons.append(f"watch_{account.watch_status.lower()}")
            elif account.watch_status == WATCH_ACTIVE and account.watch_expiration is not None:
                if account.watch_expiration < now:
                    reasons.append("watch_expired")
            elif account.watch_status != WATCH_ACTIVE:
                reasons.append("watch_not_active")
        if not (integration.config or {}).get("workflow_id"):
            reasons.append("no_workflow_configured")
        health = "degraded" if reasons else "healthy"
    return GmailAccountStatus(
        integration_id=account.integration_id,
        organization_id=account.organization_id,
        organization_name=organization_name,
        mailbox=account.email_address,
        integration_status=integration.status,
        health=health,
        health_reasons=reasons,
        connected_at=account.connected_at,
        disconnected_at=account.disconnected_at,
        granted_scopes=list(account.granted_scopes or []),
        workflow_id=(integration.config or {}).get("workflow_id"),
        sync_state=account.sync_state,
        last_sync_at=account.last_sync_at,
        last_sync_error=account.last_sync_error,
        last_notification_at=account.last_notification_at,
        watch_status=account.watch_status,
        watch_expiration=account.watch_expiration,
        watch_error=account.watch_error,
    )


@router.get(
    "/organizations/{organization_id}/gmail/accounts",
    response_model=GmailAccountsResponse,
    summary="Gmail mailboxes connected to this organization",
)
async def list_gmail_accounts(
    organization_id: uuid.UUID,
    org_context: Tuple[Organization, OrganizationMember] = Depends(manager_up),
    oauth: OAuthClient = Depends(get_oauth_client),
    db: AsyncSession = Depends(get_db),
):
    org, _ = org_context
    org_name = org.name
    rows = (
        await db.execute(
            select(GmailAccount, Integration)
            .join(Integration, Integration.id == GmailAccount.integration_id)
            .where(GmailAccount.organization_id == organization_id, Integration.organization_id == organization_id)
            .order_by(GmailAccount.connected_at.desc())
        )
    ).all()
    last_tick = await read_last_tick()
    scheduler_ok = is_healthy(last_tick)
    return GmailAccountsResponse(
        items=[build_status(a, i, org_name, scheduler_ok) for a, i in rows],
        oauth_configured=oauth.is_configured(),
        pubsub_configured=bool(settings.GMAIL_PUBSUB_TOPIC and settings.GMAIL_PUBSUB_AUDIENCE),
        poll_interval_seconds=settings.GMAIL_POLL_INTERVAL_SECONDS,
        scheduler=SchedulerStatus(last_tick=last_tick, healthy=scheduler_ok),
    )


# ============================================================================ connect


@router.post(
    "/organizations/{organization_id}/gmail/authorize",
    response_model=AuthorizeResponse,
    summary="Start connecting a Gmail mailbox (owner/admin only)",
)
async def authorize_gmail(
    organization_id: uuid.UUID,
    req: AuthorizeRequest,
    response: Response,
    org_context: Tuple[Organization, OrganizationMember] = Depends(admin_only),
    current_user: User = Depends(get_current_active_user),
    oauth: OAuthClient = Depends(get_oauth_client),
    db: AsyncSession = Depends(get_db),
):
    user_id = current_user.id
    if req.workflow_id is not None:
        await _validate_workflow_binding(db, organization_id, {"workflow_id": str(req.workflow_id)})
    try:
        url, nonce = await account_service.begin_authorization(
            db, organization_id, user_id, oauth, req.integration_id, req.workflow_id
        )
    except OAuthFlowError as err:
        await db.rollback()
        code = status.HTTP_503_SERVICE_UNAVAILABLE if err.code == "oauth_not_configured" else status.HTTP_404_NOT_FOUND
        raise HTTPException(status_code=code, detail=err.code) from None
    await db.commit()
    # Binds the callback to THIS browser: a callback URL forwarded to someone else (or planted) carries no nonce.
    response.set_cookie(
        NONCE_COOKIE,
        nonce,
        max_age=settings.GMAIL_OAUTH_STATE_TTL_SECONDS,
        httponly=True,
        samesite="lax",
        secure=settings.ENVIRONMENT.lower() == "production",
        path=CALLBACK_PATH,
    )
    return AuthorizeResponse(authorization_url=url)


def _back_to_app(**params: str) -> RedirectResponse:
    target = f"{settings.FRONTEND_URL.rstrip('/')}/integrations?{urlencode(params)}"
    redirect = RedirectResponse(target, status_code=status.HTTP_302_FOUND)
    redirect.delete_cookie(NONCE_COOKIE, path=CALLBACK_PATH)
    return redirect


@router.get(
    "/gmail/oauth/callback",
    summary="Google redirects here after the consent screen",
    include_in_schema=False,
    dependencies=[Depends(inbound_ip_rate_limiter)],
)
async def gmail_oauth_callback(
    state: Optional[str] = Query(None, max_length=512),
    code: Optional[str] = Query(None, max_length=2048),
    error: Optional[str] = Query(None, max_length=128),
    nonce: Optional[str] = Cookie(None, alias=NONCE_COOKIE),
    oauth: OAuthClient = Depends(get_oauth_client),
    client_factory: GmailClientFactory = Depends(get_client_factory),
    db: AsyncSession = Depends(get_db),
):
    outcome = await account_service.complete_authorization(
        _session_factory(db), state, nonce, code, error, oauth, client_factory
    )
    if outcome.ok:
        return _back_to_app(gmail="reconnected" if outcome.reconnected else "connected")
    return _back_to_app(gmail="error", reason=outcome.reason)


# ============================================================================ actions


async def _get_account(db: AsyncSession, organization_id: uuid.UUID, integration_id: uuid.UUID) -> GmailAccount:
    account = (
        await db.execute(
            select(GmailAccount).where(
                GmailAccount.integration_id == integration_id, GmailAccount.organization_id == organization_id
            )
        )
    ).scalar_one_or_none()
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gmail integration not found")
    return account


@router.post(
    "/organizations/{organization_id}/gmail/accounts/{integration_id}/sync",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Ask for a synchronisation of this mailbox now",
)
async def sync_now(
    organization_id: uuid.UUID,
    integration_id: uuid.UUID,
    org_context: Tuple[Organization, OrganizationMember] = Depends(manager_up),
    db: AsyncSession = Depends(get_db),
):
    account = await _get_account(db, organization_id, integration_id)
    if account.disconnected_at is not None or account.sync_state == SYNC_NEEDS_REAUTH:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This mailbox must be reconnected first")
    account.sync_requested_at = utc_now()
    account_id = account.id
    await db.commit()
    pubsub_service.enqueue_sync(account_id)
    return {"status": "requested"}


@router.post(
    "/organizations/{organization_id}/gmail/accounts/{integration_id}/disconnect",
    summary="Disconnect a mailbox: stop the watch, revoke the grant, discard credentials (owner/admin only)",
)
async def disconnect_gmail(
    organization_id: uuid.UUID,
    integration_id: uuid.UUID,
    org_context: Tuple[Organization, OrganizationMember] = Depends(admin_only),
    current_user: User = Depends(get_current_active_user),
    client_factory: GmailClientFactory = Depends(get_client_factory),
    db: AsyncSession = Depends(get_db),
):
    await _get_account(db, organization_id, integration_id)
    user_id = current_user.id
    done = await account_service.disconnect(
        _session_factory(db), organization_id, integration_id, user_id, client_factory
    )
    if not done:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gmail integration not found")
    return {"status": "disconnected"}


# ============================================================================ Pub/Sub push


@router.post(
    "/gmail/pubsub",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Pub/Sub push endpoint for Gmail mailbox notifications",
    include_in_schema=False,
)
async def gmail_pubsub_push(
    request: Request,
    verifier: pubsub_service.PubSubVerifier = Depends(get_pubsub_verifier),
    db: AsyncSession = Depends(get_db),
):
    body = await request.body()
    if len(body) > PUBSUB_MAX_BODY:
        raise HTTPException(status_code=413, detail="Payload too large")
    try:
        await verifier.verify(request.headers.get("Authorization"))
    except pubsub_service.PubSubAuthError as err:
        raise HTTPException(status_code=err.status_code, detail=err.detail) from None
    try:
        data = pubsub_service.parse_notification(body)
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Malformed notification") from None

    account_id = await pubsub_service.record_notification(_session_factory(db), data)
    if account_id is not None:
        pubsub_service.enqueue_sync(account_id)
    else:
        logger.info("Gmail notification did not match a connected mailbox")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
