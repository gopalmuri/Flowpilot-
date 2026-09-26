from datetime import datetime, timezone
from fastapi import APIRouter, Response, status
from sqlalchemy import text
import redis.asyncio as aioredis

from app.core.config import settings
from app.core.database import async_session_maker
from app.core.logging import logger

router = APIRouter(tags=["Health"])


@router.get("/health/live", summary="Liveness Probe")
async def liveness_probe():
    """
    Lightweight liveness probe for container orchestrators.
    Returns HTTP 200 immediately to assert the application event loop is responsive.
    """
    return {
        "status": "alive",
        "project": settings.PROJECT_NAME,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/health/ready", summary="Readiness Probe")
async def readiness_probe(response: Response):
    """
    Deep readiness probe verifying critical runtime dependencies:
    PostgreSQL, Redis Cache, and Celery Broker.
    Returns HTTP 200 when ready to receive traffic, or HTTP 503 if any core dependency fails.
    """
    services = {
        "database": "checking",
        "redis": "checking",
        "celery_broker": "checking",
    }
    all_ready = True

    # 1. Check PostgreSQL
    try:
        async with async_session_maker() as session:
            result = await session.execute(text("SELECT 1"))
            if result.scalar() == 1:
                services["database"] = "ready"
            else:
                services["database"] = "unexpected_response"
                all_ready = False
    except Exception as e:
        logger.warning(f"Database readiness check failed: {e}")
        services["database"] = "unavailable"
        all_ready = False

    # 2. Check Redis Cache
    try:
        r = aioredis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
            socket_timeout=2.0,
        )
        pong = await r.ping()
        await r.aclose()
        if pong:
            services["redis"] = "ready"
        else:
            services["redis"] = "unexpected_response"
            all_ready = False
    except Exception as e:
        logger.warning(f"Redis readiness check failed: {e}")
        services["redis"] = "unavailable"
        all_ready = False

    # 3. Check Celery Broker
    try:
        cb = aioredis.from_url(
            settings.CELERY_BROKER_URL,
            encoding="utf-8",
            decode_responses=True,
            socket_timeout=2.0,
        )
        pong_cb = await cb.ping()
        await cb.aclose()
        if pong_cb:
            services["celery_broker"] = "ready"
        else:
            services["celery_broker"] = "unexpected_response"
            all_ready = False
    except Exception as e:
        logger.warning(f"Celery broker readiness check failed: {e}")
        services["celery_broker"] = "unavailable"
        all_ready = False

    if not all_ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return {
        "status": "ready" if all_ready else "unready",
        "services": services,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/health", summary="System Health & Services Status")
async def health_check():
    """
    Returns the overall health status of FlowPilot backend services,
    including database, redis cache, and celery broker connectivity checks.
    """
    services = {
        "database": "checking",
        "redis": "checking",
        "celery_broker": "checking",
    }
    overall_healthy = True

    # 1. Check PostgreSQL Connectivity
    try:
        async with async_session_maker() as session:
            result = await session.execute(text("SELECT 1"))
            if result.scalar() == 1:
                services["database"] = "connected"
            else:
                services["database"] = "unexpected_response"
                overall_healthy = False
    except Exception as e:
        logger.warning(f"Database health check failed: {e}")
        services["database"] = "unavailable"
        overall_healthy = False

    # 2. Check Redis Cache Connectivity
    try:
        r = aioredis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
            socket_timeout=2.0,
        )
        pong = await r.ping()
        await r.aclose()
        if pong:
            services["redis"] = "connected"
        else:
            services["redis"] = "unexpected_response"
            overall_healthy = False
    except Exception as e:
        logger.warning(f"Redis health check failed: {e}")
        services["redis"] = "unavailable"
        overall_healthy = False

    # 3. Check Celery Broker Connectivity
    try:
        cb = aioredis.from_url(
            settings.CELERY_BROKER_URL,
            encoding="utf-8",
            decode_responses=True,
            socket_timeout=2.0,
        )
        pong_cb = await cb.ping()
        await cb.aclose()
        if pong_cb:
            services["celery_broker"] = "connected"
        else:
            services["celery_broker"] = "unexpected_response"
            overall_healthy = False
    except Exception as e:
        logger.warning(f"Celery broker health check failed: {e}")
        services["celery_broker"] = "unavailable"
        overall_healthy = False

    return {
        "status": "healthy" if overall_healthy else "degraded",
        "project": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "environment": settings.ENVIRONMENT,
        "services": services,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
