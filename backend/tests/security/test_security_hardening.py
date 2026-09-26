"""
Security Hardening Tests for FlowPilot (Phase 16).
Validates:
1. HTTP Security Response Headers (HSTS, CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy).
2. Content Security Policy (CSP) constraints.
3. CORS configuration and origin boundaries.
4. Cookie attributes (HttpOnly, SameSite, Secure, Path).
5. CSRF origin verification on cookie-authenticated refresh requests.
6. Redis-backed sliding-window rate limiting and fail-open resilience.
7. Production configuration security validation.
"""

import time
import pytest
from httpx import AsyncClient

from app.core.config import Settings, settings
from app.core.rate_limit import RateLimiter


@pytest.mark.asyncio
async def test_security_response_headers_present(async_client: AsyncClient):
    """Verifies that all standard security headers are present on API responses."""
    resp = await async_client.get("/")
    assert resp.status_code == 200

    # 1. Anti-MIME sniffing
    assert resp.headers.get("X-Content-Type-Options") == "nosniff"

    # 2. Anti-clickjacking
    assert resp.headers.get("X-Frame-Options") == "DENY"

    # 3. Referrer policy
    assert resp.headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"

    # 4. Permissions policy
    assert "camera=()" in resp.headers.get("Permissions-Policy", "")
    assert "geolocation=()" in resp.headers.get("Permissions-Policy", "")

    # 5. Legacy XSS filter disabled in favor of CSP
    assert resp.headers.get("X-XSS-Protection") == "0"

    # 6. CSP header present
    csp = resp.headers.get("Content-Security-Policy", "")
    assert "default-src" in csp
    assert "frame-ancestors 'none'" in csp
    assert "object-src 'none'" in csp


@pytest.mark.asyncio
async def test_hsts_header_in_production(async_client: AsyncClient, monkeypatch):
    """Verifies Strict-Transport-Security header is included when in production or FORCE_HTTPS=True."""
    monkeypatch.setattr(settings, "FORCE_HTTPS", True)
    resp = await async_client.get("/api/v1/health/live")
    assert resp.status_code == 200
    hsts = resp.headers.get("Strict-Transport-Security")
    assert hsts is not None
    assert "max-age=63072000" in hsts
    assert "includeSubDomains" in hsts


@pytest.mark.asyncio
async def test_cors_preflight_and_origin_headers(async_client: AsyncClient):
    """Verifies CORS headers for allowed origins."""
    headers = {
        "Origin": "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
    }
    resp = await async_client.options("/api/v1/auth/login", headers=headers)
    assert resp.status_code == 200
    assert resp.headers.get("Access-Control-Allow-Origin") == "http://localhost:5173"
    assert resp.headers.get("Access-Control-Allow-Credentials") == "true"


@pytest.mark.asyncio
async def test_cookie_security_attributes_on_login(async_client: AsyncClient):
    """Verifies that refresh token cookies have HttpOnly, SameSite, and scoped Path."""
    # Register a dedicated user
    email = f"cookie_sec_{int(time.time())}@flowpilot.internal"
    pwd = "SecurePassword!123"
    await async_client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": pwd, "full_name": "Cookie Tester"},
    )

    login_resp = await async_client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": pwd},
    )
    assert login_resp.status_code == 200

    cookie_header = login_resp.headers.get("set-cookie", "")
    assert "refresh_token=" in cookie_header
    assert "HttpOnly" in cookie_header or "httponly" in cookie_header.lower()
    assert "samesite=lax" in cookie_header.lower()
    assert "path=/api/v1/auth" in cookie_header.lower()


@pytest.mark.asyncio
async def test_csrf_origin_mismatch_rejection_in_production(async_client: AsyncClient, monkeypatch):
    """Verifies that cookie-authenticated refresh requests from unauthorized origins are rejected in production."""
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "ALLOWED_CORS_ORIGINS", ["https://app.flowpilot.com"])

    # Simulate request with forged origin
    headers = {
        "Origin": "https://malicious-site.com",
        "Cookie": "refresh_token=some_token",
    }
    resp = await async_client.post("/api/v1/auth/refresh", headers=headers)
    assert resp.status_code == 403
    assert "Origin mismatch" in resp.json().get("detail", "")


@pytest.mark.asyncio
async def test_redis_rate_limiting_enforcement(async_client: AsyncClient, monkeypatch):
    """Verifies that exceeding the rate limit returns HTTP 429 with Retry-After header."""
    monkeypatch.setattr(settings, "RATE_LIMIT_ENABLED", True)

    custom_limiter = RateLimiter(limit=3, window_seconds=10, scope="test:rate")

    from fastapi import Request, Response
    from unittest.mock import Mock

    req = Mock(spec=Request)
    req.headers = {}
    req.client = Mock()
    req.client.host = f"192.168.1.{int(time.time()) % 200}"

    res = Response()

    # Requests 1 to 3 should succeed
    for _ in range(3):
        await custom_limiter(req, res)
        assert int(res.headers.get("X-RateLimit-Remaining", "0")) >= 0

    # Request 4 should trigger 429
    with pytest.raises(Exception) as exc_info:
        await custom_limiter(req, res)

    err = exc_info.value
    assert getattr(err, "status_code", None) == 429
    assert "Retry-After" in err.headers


@pytest.mark.asyncio
async def test_rate_limiter_fail_open_on_redis_error(monkeypatch):
    """Verifies fail-open behavior: when Redis is unreachable, requests are permitted with a warning."""
    monkeypatch.setattr(settings, "RATE_LIMIT_ENABLED", True)
    limiter = RateLimiter(limit=5, window_seconds=60, scope="test:fail_open")

    from fastapi import Request, Response
    from unittest.mock import Mock

    req = Mock(spec=Request)
    req.headers = {}
    req.client = Mock()
    req.client.host = "10.0.0.1"
    res = Response()

    # Point REDIS_URL to an invalid unreachable port
    monkeypatch.setattr(settings, "REDIS_URL", "redis://127.0.0.1:9999/0")

    # Should not raise exception (fails open)
    await limiter(req, res)
    assert res.headers.get("X-RateLimit-Remaining") == "1"


def test_production_configuration_validation():
    """Verifies that production security validation rejects unsafe defaults."""
    # 1. Default SECRET_KEY rejected
    with pytest.raises(ValueError, match="Production SECRET_KEY"):
        Settings(
            ENVIRONMENT="production",
            SECRET_KEY="default-secret-key-change-in-production-32chars",
            JWT_SECRET="valid-long-production-jwt-secret-key-32chars",
            DEBUG=False,
            ALLOWED_CORS_ORIGINS=["https://app.flowpilot.com"],
        )

    # 2. DEBUG=True rejected in production
    with pytest.raises(ValueError, match="DEBUG mode must be disabled"):
        Settings(
            ENVIRONMENT="production",
            SECRET_KEY="secure-production-secret-key-at-least-32chars-long",
            JWT_SECRET="valid-long-production-jwt-secret-key-32chars",
            DEBUG=True,
            ALLOWED_CORS_ORIGINS=["https://app.flowpilot.com"],
        )

    # 3. Localhost CORS origin rejected in production
    with pytest.raises(ValueError, match="Localhost CORS origin"):
        Settings(
            ENVIRONMENT="production",
            SECRET_KEY="secure-production-secret-key-at-least-32chars-long",
            JWT_SECRET="valid-long-production-jwt-secret-key-32chars",
            DEBUG=False,
            ALLOWED_CORS_ORIGINS=["http://localhost:3000"],
        )

    # 4. Valid production configuration succeeds
    valid_cfg = Settings(
        ENVIRONMENT="production",
        SECRET_KEY="secure-production-secret-key-at-least-32chars-long",
        JWT_SECRET="valid-long-production-jwt-secret-key-32chars",
        DEBUG=False,
        ALLOWED_CORS_ORIGINS=["https://app.flowpilot.com"],
    )
    assert valid_cfg.ENVIRONMENT == "production"
