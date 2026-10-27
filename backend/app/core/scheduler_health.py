"""
Scheduler (Celery Beat) liveness.

Beat runs a tiny task every 30 s that stamps the time into Redis. Anything that depends on periodic work (Gmail polling
and watch renewal, delivery recovery) can then tell the difference between "nothing to do" and "the scheduler is not
running", which a compose file alone cannot guarantee.
"""

import time
from datetime import datetime, timezone
from typing import Optional

import redis
import redis.asyncio as aioredis

from app.core.config import settings

HEARTBEAT_KEY = "flowpilot:beat:last_tick"
MAX_AGE_SECONDS = 120


def record_tick() -> None:
    client = redis.Redis.from_url(settings.REDIS_URL, socket_timeout=3)
    try:
        client.set(HEARTBEAT_KEY, str(time.time()), ex=600)
    finally:
        client.close()


async def read_last_tick() -> Optional[datetime]:
    client = aioredis.from_url(settings.REDIS_URL, socket_timeout=3)
    try:
        raw = await client.get(HEARTBEAT_KEY)
    except Exception:  # noqa: BLE001 - Redis unreachable reads as "unknown"
        return None
    finally:
        try:
            await client.aclose()
        except Exception:  # noqa: BLE001
            pass
    if raw is None:
        return None
    try:
        return datetime.fromtimestamp(float(raw), tz=timezone.utc)
    except (TypeError, ValueError):
        return None


def is_healthy(last_tick: Optional[datetime], now: Optional[datetime] = None) -> bool:
    if last_tick is None:
        return False
    now = now or datetime.now(timezone.utc)
    return (now - last_tick).total_seconds() <= MAX_AGE_SECONDS
