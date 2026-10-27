"""Per-organisation AI usage accounting and the daily request cap."""

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.usage import UsageRecord

METRIC_REQUESTS = "ai_request"
METRIC_TOKENS = "ai_tokens"


def _start_of_utc_day() -> datetime:
    now = datetime.now(timezone.utc)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


async def requests_used_today(db: AsyncSession, organization_id: uuid.UUID) -> int:
    stmt = select(func.coalesce(func.sum(UsageRecord.quantity), 0)).where(
        UsageRecord.organization_id == organization_id,
        UsageRecord.metric_type == METRIC_REQUESTS,
        UsageRecord.recorded_at >= _start_of_utc_day(),
    )
    return int(await db.scalar(stmt) or 0)


async def enforce_ai_limit(db: AsyncSession, organization_id: uuid.UUID) -> int:
    """Raises HTTP 429 when the organisation used its daily allowance. Returns the remaining calls otherwise."""
    limit = settings.AI_DAILY_REQUEST_LIMIT_PER_ORG
    used = await requests_used_today(db, organization_id)
    if used >= limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                f"Your team has used all {limit} AI requests for today. "
                "You can keep building by hand in the editor; the AI allowance resets at midnight UTC."
            ),
        )
    return limit - used


async def record_ai_usage(
    db: AsyncSession,
    organization_id: uuid.UUID,
    tokens: int = 0,
    workflow_id: Optional[uuid.UUID] = None,
) -> None:
    """Records one assistant call (and its token count). Never raises: accounting must not break the feature."""
    try:
        db.add(UsageRecord(organization_id=organization_id, metric_type=METRIC_REQUESTS, quantity=1, workflow_id=workflow_id))
        if tokens > 0:
            db.add(
                UsageRecord(
                    organization_id=organization_id, metric_type=METRIC_TOKENS, quantity=tokens, workflow_id=workflow_id
                )
            )
        await db.commit()
    except Exception:  # noqa: BLE001
        await db.rollback()
