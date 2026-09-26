import hashlib
import hmac
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.logging import logger
from app.engine.sanitizer import sanitize_error_message, sanitize_payload
from app.models.base import utc_now
from app.models.idempotency import IdempotencyRecord
from app.models.workflow_run import WorkflowRun
from app.models.workflow_step import WorkflowStep
from app.schemas.execution import WorkflowRunStatus

MAX_PAYLOAD_SIZE_BYTES = 65536  # 64 KB
MAX_TIMESTAMP_TOLERANCE_SECONDS = 300  # 5 minutes
MAX_IDEMPOTENCY_KEY_LENGTH = 128


def validate_payload_size(raw_body: bytes, max_bytes: int = MAX_PAYLOAD_SIZE_BYTES) -> None:
    """
    Rejects incoming request bodies exceeding the maximum allowable size (64KB).
    Raises HTTP 413 Payload Too Large.
    """
    if len(raw_body) > max_bytes:
        logger.warning(
            f"Webhook payload rejected: size {len(raw_body)} bytes exceeds limit of {max_bytes} bytes"
        )
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Payload exceeds maximum limit of {max_bytes // 1024}KB",
        )


def verify_timestamp(
    timestamp_str: Optional[str],
    tolerance_seconds: int = MAX_TIMESTAMP_TOLERANCE_SECONDS,
) -> float:
    """
    Validates the X-Webhook-Timestamp header against current UTC epoch time.
    Rejects missing, malformed, expired (> tolerance), or future-skewed (> tolerance) timestamps.
    Raises HTTP 401 Unauthorized on failure.
    """
    if not timestamp_str or not timestamp_str.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing required X-Webhook-Timestamp header",
        )

    try:
        ts = float(timestamp_str.strip())
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Malformed X-Webhook-Timestamp header",
        )

    current_ts = datetime.now(timezone.utc).timestamp()
    delta = current_ts - ts

    if delta > tolerance_seconds:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Webhook timestamp expired",
        )

    if delta < -tolerance_seconds:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Webhook timestamp skewed into the future",
        )

    return ts


def calculate_hmac_signature(
    secret_token: str,
    timestamp_str: str,
    raw_body: bytes,
) -> str:
    """
    Calculates the HMAC-SHA256 signature using the format:
    signed_message = timestamp.encode("utf-8") + b"." + raw_body
    Returns: sha256=<hex_digest>
    """
    signed_message = timestamp_str.encode("utf-8") + b"." + raw_body
    digest = hmac.new(
        secret_token.encode("utf-8"),
        signed_message,
        hashlib.sha256,
    ).hexdigest()
    return f"sha256={digest}"


def verify_hmac_signature(
    raw_body: bytes,
    signature_header: Optional[str],
    secret_token: str,
    timestamp_str: Optional[str],
    tolerance_seconds: int = MAX_TIMESTAMP_TOLERANCE_SECONDS,
) -> None:
    """
    Cryptographically verifies the HMAC signature of an incoming webhook request.
    Enforces format sha256=<hex_digest> and uses hmac.compare_digest for timing attack safety.
    Raises HTTP 401 Unauthorized on any mismatch or invalid parameter.
    """
    if not signature_header or not signature_header.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing signature header",
        )

    clean_sig = signature_header.strip()

    if not clean_sig.startswith("sha256="):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Malformed signature format. Expected sha256=<hex_digest>",
        )

    hex_part = clean_sig[len("sha256=") :]
    if len(hex_part) != 64 or not all(c in "0123456789abcdefABCDEF" for c in hex_part):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Malformed signature format. Invalid hex digest",
        )

    # Validate timestamp replay protection
    verify_timestamp(timestamp_str, tolerance_seconds)

    # Compute expected signature and perform constant-time comparison
    expected_header = calculate_hmac_signature(secret_token, timestamp_str.strip(), raw_body)

    if not hmac.compare_digest(expected_header.lower(), clean_sig.lower()):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid webhook signature",
        )


def extract_signature_header(headers: Any) -> Optional[str]:
    """
    Extracts the webhook signature header supporting:
    - X-Webhook-Signature
    - X-Signature-256
    - X-Hub-Signature-256
    """
    return (
        headers.get("X-Webhook-Signature")
        or headers.get("x-webhook-signature")
        or headers.get("X-Signature-256")
        or headers.get("x-signature-256")
        or headers.get("X-Hub-Signature-256")
        or headers.get("x-hub-signature-256")
    )


def extract_webhook_secret_and_config(
    steps: List[WorkflowStep],
) -> Tuple[Optional[str], List[str]]:
    """
    Extracts the secret_token and allowed_methods from the WEBHOOK_TRIGGER step.
    Returns (secret_token, allowed_methods).
    """
    for step in steps:
        if step.step_type == "WEBHOOK_TRIGGER":
            cfg = step.config or {}
            secret = cfg.get("secret_token")
            methods = cfg.get("allowed_methods", ["POST"])
            return secret, methods
    return None, ["POST"]


def format_scoped_idempotency_key(
    operation_scope: str,
    workflow_id: uuid.UUID,
    client_key: str,
) -> str:
    """
    Formats the idempotency key scoped by operation and workflow:
    scoped_key = f"{operation_scope}:{workflow_id}:{client_key}"
    """
    clean_key = client_key.strip()
    if len(clean_key) > MAX_IDEMPOTENCY_KEY_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Idempotency-Key header is too long (maximum {MAX_IDEMPOTENCY_KEY_LENGTH} characters)",
        )
    return f"{operation_scope}:{workflow_id}:{clean_key}"


async def get_or_create_idempotent_run(
    session_factory: async_sessionmaker,
    organization_id: uuid.UUID,
    workflow_id: uuid.UUID,
    version_id: uuid.UUID,
    clean_payload: Dict[str, Any],
    correlation_id: str,
    client_idempotency_key: Optional[str] = None,
    operation_scope: str = "webhook",
    trigger_type: str = "WEBHOOK",
) -> Tuple[WorkflowRun, bool, bool]:
    """
    Manages workflow run initialization and idempotency locking using PostgreSQL savepoints.

    Returns Tuple:
        (run: WorkflowRun, is_winner: bool, is_idempotent: bool)

    Execution Ownership Guarantee:
        - Only is_winner == True is authorized to initiate DAG traversal.
        - Duplicate requests (is_winner == False) return the winning run with is_idempotent = True.
        - If the original run failed, duplicate requests return status: FAILED and never create a retry run.
    """
    # If no idempotency key was provided, create run directly
    if not client_idempotency_key or not client_idempotency_key.strip():
        async with session_factory() as session:
            new_run = WorkflowRun(
                organization_id=organization_id,
                workflow_id=workflow_id,
                workflow_version_id=version_id,
                status=WorkflowRunStatus.RUNNING.value,
                trigger_type=trigger_type,
                trigger_payload=clean_payload,
                correlation_id=correlation_id,
                started_at=utc_now(),
            )
            session.add(new_run)
            await session.commit()
            await session.refresh(new_run)
            return new_run, True, False

    scoped_key = format_scoped_idempotency_key(
        operation_scope, workflow_id, client_idempotency_key
    )

    async with session_factory() as session:
        # 1. First, check if an IdempotencyRecord already exists
        stmt = select(IdempotencyRecord).where(
            IdempotencyRecord.organization_id == organization_id,
            IdempotencyRecord.idempotency_key == scoped_key,
        )
        existing_rec = (await session.execute(stmt)).scalar_one_or_none()
        if existing_rec:
            existing_run = await session.get(WorkflowRun, existing_rec.workflow_run_id)
            if existing_run:
                logger.info(
                    f"Idempotent duplicate request resolved: key='{scoped_key}', run_id='{existing_run.id}', status='{existing_run.status}'"
                )
                return existing_run, False, True

        # 2. Record not found, attempt atomic insert with nested savepoint
        is_winner = False
        resolved_run: Optional[WorkflowRun] = None

        try:
            async with session.begin_nested():
                new_run = WorkflowRun(
                    organization_id=organization_id,
                    workflow_id=workflow_id,
                    workflow_version_id=version_id,
                    status=WorkflowRunStatus.RUNNING.value,
                    trigger_type=trigger_type,
                    trigger_payload=clean_payload,
                    correlation_id=correlation_id,
                    started_at=utc_now(),
                )
                session.add(new_run)
                await session.flush()

                # Idempotency record with 24-hour expiration
                expires_at = utc_now() + timedelta(hours=24)
                idemp_rec = IdempotencyRecord(
                    organization_id=organization_id,
                    idempotency_key=scoped_key,
                    workflow_run_id=new_run.id,
                    expires_at=expires_at,
                )
                session.add(idemp_rec)
                await session.flush()

            # Nested savepoint committed cleanly -> commit outer transaction
            await session.commit()
            await session.refresh(new_run)
            is_winner = True
            resolved_run = new_run
            logger.info(
                f"Idempotency record created: key='{scoped_key}', run_id='{new_run.id}' (execution winner)"
            )

        except IntegrityError:
            # Concurrent race condition: another request committed the key first!
            # The nested savepoint rolled back cleanly, leaving outer session valid.
            logger.info(
                f"Concurrent race condition caught on key='{scoped_key}'. Fetching winning record."
            )
            stmt = select(IdempotencyRecord).where(
                IdempotencyRecord.organization_id == organization_id,
                IdempotencyRecord.idempotency_key == scoped_key,
            )
            winning_rec = (await session.execute(stmt)).scalar_one_or_none()
            if winning_rec:
                resolved_run = await session.get(WorkflowRun, winning_rec.workflow_run_id)
            is_winner = False

        if not resolved_run:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to resolve or initialize workflow run",
            )

        return resolved_run, is_winner, (not is_winner)
