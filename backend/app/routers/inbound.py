import json

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.database import async_session_maker, get_db
from app.core.encryption import decrypt_credentials
from app.core.logging import logger
from app.core.rate_limit import inbound_ip_rate_limiter, inbound_key_rate_limiter
from app.models.integration import Integration
from app.schemas.inbound import InboundAcceptedResponse, NormalizedMessage, PortfolioSubmission
from app.services.inbound.pipeline import ingest_message
from app.services.webhook_service import (
    extract_signature_header,
    validate_payload_size,
    verify_hmac_signature,
)

router = APIRouter(prefix="/inbound", tags=["Inbound Channels"])

PORTFOLIO_CHANNEL = "PORTFOLIO_FORM"
PORTFOLIO_MAX_BODY_BYTES = 16 * 1024


def _session_factory(db: AsyncSession) -> async_sessionmaker:
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


@router.post(
    "/portfolio/{public_key}",
    response_model=InboundAcceptedResponse,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(inbound_ip_rate_limiter), Depends(inbound_key_rate_limiter)],
    summary="Receive a contact-form submission from the portfolio backend",
)
async def receive_portfolio_submission(
    public_key: str,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """
    Server-to-server endpoint. The portfolio backend signs the raw JSON body with the
    integration's signing secret (HMAC-SHA256 over `timestamp.body`, headers
    `X-Webhook-Timestamp` and `X-Webhook-Signature`). The organization is derived from the
    integration key on the server; the caller never supplies an organization id.
    """
    raw_body = await request.body()
    validate_payload_size(raw_body, PORTFOLIO_MAX_BODY_BYTES)

    integration = (
        await db.execute(
            select(Integration).where(
                Integration.public_key == public_key,
                Integration.type == PORTFOLIO_CHANNEL,
            )
        )
    ).scalar_one_or_none()
    # Same answer for unknown, disconnected or malformed keys: do not reveal which exist.
    if not integration or integration.status != "CONNECTED" or not integration.credentials_encrypted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    try:
        creds = decrypt_credentials(integration.credentials_encrypted, aad=integration.organization_id.bytes)
    except Exception:
        logger.error(f"Portfolio integration {integration.id} credentials could not be decrypted")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Integration unavailable") from None
    secret = creds.get("signing_secret")
    if not secret:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Integration unavailable")

    verify_hmac_signature(
        raw_body=raw_body,
        signature_header=extract_signature_header(request.headers),
        secret_token=secret,
        timestamp_str=request.headers.get("X-Webhook-Timestamp") or request.headers.get("x-webhook-timestamp"),
    )

    try:
        submission = PortfolioSubmission.model_validate(json.loads(raw_body.decode("utf-8")))
    except (ValueError, ValidationError) as exc:
        raise HTTPException(status_code=422, detail="Invalid submission") from exc

    # Spam trap: acknowledge so bots learn nothing, but create nothing.
    if submission.website:
        logger.info(f"Portfolio submission ignored by honeypot (integration {integration.id})")
        return InboundAcceptedResponse(status="ignored")

    msg = NormalizedMessage(
        channel=PORTFOLIO_CHANNEL,
        external_message_id=submission.submission_id,
        external_conversation_id=submission.submission_id,
        sender_identity=str(submission.email),
        sender_name=submission.name,
        sender_address=str(submission.email),
        subject=submission.subject,
        text_content=submission.message,
        received_at=submission.submitted_at,
        extra={"company": submission.company} if submission.company else {},
    )
    result = await ingest_message(_session_factory(db), integration, msg)
    if result.status == "duplicate":
        response.status_code = status.HTTP_200_OK
    return InboundAcceptedResponse(
        status=result.status,
        message_id=str(result.message_id),
        workflow_run_id=str(result.workflow_run_id) if result.workflow_run_id else None,
        correlation_id=result.correlation_id,
    )
