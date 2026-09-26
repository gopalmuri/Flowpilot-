"""
Redis-backed Sliding Window Rate Limiter for FlowPilot.
Implements atomic sliding-window rate limiting with fail-open fault tolerance.
"""

import time
from typing import Callable, Optional
import redis.asyncio as aioredis
from fastapi import HTTPException, Request, Response, status

from app.core.config import settings
from app.core.logging import logger

SLIDING_WINDOW_LUA = """
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local clear_before = now - window

redis.call('ZREMRANGEBYSCORE', key, '-inf', clear_before)
local current_requests = redis.call('ZCARD', key)

if current_requests < limit then
    redis.call('ZADD', key, now, now)
    redis.call('EXPIRE', key, math.ceil(window))
    return {1, limit - current_requests - 1, 0}
else
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local reset_after = 1
    if #oldest > 0 then
        reset_after = math.ceil(tonumber(oldest[2]) + window - now)
    end
    if reset_after < 1 then reset_after = 1 end
    return {0, 0, reset_after}
end
"""


def get_client_ip(request: Request) -> str:
    """Extracts client IP, respecting X-Forwarded-For if behind a reverse proxy."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client and request.client.host:
        return request.client.host
    return "127.0.0.1"


class RateLimiter:
    """
    FastAPI dependency that enforces sliding-window rate limits via Redis.
    Fails open if Redis is unavailable.
    """

    def __init__(
        self,
        limit: int,
        window_seconds: int,
        scope: str,
        identifier_func: Optional[Callable[[Request], str]] = None,
    ):
        self.limit = limit
        self.window_seconds = window_seconds
        self.scope = scope
        self.identifier_func = identifier_func or get_client_ip

    async def __call__(self, request: Request, response: Response):
        if not getattr(settings, "RATE_LIMIT_ENABLED", True):
            return

        ident = self.identifier_func(request)
        rate_key = f"rate_limit:{self.scope}:{ident}"
        now = time.time()

        try:
            r = aioredis.from_url(
                settings.REDIS_URL,
                encoding="utf-8",
                decode_responses=True,
                socket_timeout=1.0,
            )
            # Execute atomic sliding window script
            res = await r.eval(
                SLIDING_WINDOW_LUA,
                1,
                rate_key,
                str(now),
                str(self.window_seconds),
                str(self.limit),
            )
            await r.aclose()

            allowed, remaining, reset_after = int(res[0]), int(res[1]), int(res[2])

            reset_timestamp = int(now + (reset_after if not allowed else self.window_seconds))
            response.headers["X-RateLimit-Limit"] = str(self.limit)
            response.headers["X-RateLimit-Remaining"] = str(remaining)
            response.headers["X-RateLimit-Reset"] = str(reset_timestamp)

            if not allowed:
                response.headers["Retry-After"] = str(reset_after)
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=f"Rate limit exceeded. Try again in {reset_after} seconds.",
                    headers={
                        "Retry-After": str(reset_after),
                        "X-RateLimit-Limit": str(self.limit),
                        "X-RateLimit-Remaining": "0",
                        "X-RateLimit-Reset": str(reset_timestamp),
                    },
                )
        except HTTPException:
            raise
        except Exception as e:
            # Fail-open resilience: log warning and permit request
            logger.warning(f"Rate limiting check failed for key {rate_key}: {e}. Failing open.")
            response.headers["X-RateLimit-Limit"] = str(self.limit)
            response.headers["X-RateLimit-Remaining"] = "1"
            response.headers["X-RateLimit-Reset"] = str(int(now + self.window_seconds))


# Predefined rate limiter dependencies
login_rate_limiter = RateLimiter(
    limit=5,
    window_seconds=60,
    scope="auth:login",
    identifier_func=get_client_ip,
)

refresh_rate_limiter = RateLimiter(
    limit=30,
    window_seconds=60,
    scope="auth:refresh",
    identifier_func=get_client_ip,
)

register_rate_limiter = RateLimiter(
    limit=3,
    window_seconds=3600,
    scope="auth:register",
    identifier_func=get_client_ip,
)

public_webhook_rate_limiter = RateLimiter(
    limit=100,
    window_seconds=60,
    scope="webhook:public",
    identifier_func=get_client_ip,
)

tenant_webhook_rate_limiter = RateLimiter(
    limit=300,
    window_seconds=60,
    scope="webhook:tenant",
    identifier_func=get_client_ip,
)

analytics_rate_limiter = RateLimiter(
    limit=60,
    window_seconds=60,
    scope="analytics",
    identifier_func=get_client_ip,
)
