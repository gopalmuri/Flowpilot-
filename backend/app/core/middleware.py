"""
ASGI Security Headers Middleware for FlowPilot.
Enforces defense-in-depth HTTP security response headers and Content Security Policy.
"""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.config import settings

# Content Security Policy constants
PRODUCTION_CSP = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com data:; "
    "img-src 'self' data: https:; "
    "connect-src 'self' https:; "
    "frame-ancestors 'none'; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "form-action 'self';"
)

DEVELOPMENT_CSP = (
    "default-src 'self' http: ws:; "
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com data:; "
    "img-src 'self' data: https:; "
    "connect-src 'self' http: ws: https:; "
    "frame-ancestors 'none'; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "form-action 'self';"
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """
    Middleware that attaches production security headers to all outgoing HTTP responses.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        response: Response = await call_next(request)

        is_production = settings.ENVIRONMENT.lower() == "production"
        force_https = getattr(settings, "FORCE_HTTPS", False)

        # 1. Strict-Transport-Security (HSTS)
        if is_production or force_https:
            response.headers["Strict-Transport-Security"] = (
                "max-age=63072000; includeSubDomains; preload"
            )

        # 2. Prevent MIME-sniffing
        response.headers["X-Content-Type-Options"] = "nosniff"

        # 3. Anti-clickjacking (DENY framing)
        response.headers["X-Frame-Options"] = "DENY"

        # 4. Referrer Policy
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        # 5. Permissions Policy
        response.headers["Permissions-Policy"] = (
            "camera=(), microphone=(), geolocation=(), payment=()"
        )

        # 6. Disable legacy XSS filter in favor of CSP
        response.headers["X-XSS-Protection"] = "0"

        # 7. Content-Security-Policy
        csp_header = PRODUCTION_CSP if is_production else DEVELOPMENT_CSP
        # Do not override if already set explicitly (e.g. documentation or custom view)
        if "Content-Security-Policy" not in response.headers:
            response.headers["Content-Security-Policy"] = csp_header

        return response
