import sys
from pathlib import Path

# Ensure backend root is in sys.path
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

import asyncio
import os
import subprocess

import asyncpg
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings


def _isolate_test_database() -> None:
    """
    Run the whole suite against `<database>_test`, never the development database.

    The test database is created on first use and migrated to head on every run (a no-op when current), so schema
    changes are always exercised through the real migrations. This must happen before `app.core.database` builds its
    engine, so it runs before the app imports below. Set FLOWPILOT_TEST_USE_DEV_DB=1 to opt out.
    """
    if os.environ.get("FLOWPILOT_TEST_USE_DEV_DB") == "1":
        return
    url = make_url(settings.DATABASE_URL)
    base = url.database or "flowpilot"
    test_name = base if base.endswith("_test") else f"{base}_test"

    async def ensure_database() -> None:
        conn = await asyncpg.connect(
            user=url.username, password=url.password, host=url.host, port=url.port or 5432, database="postgres"
        )
        try:
            exists = await conn.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", test_name)
            if not exists:
                await conn.execute(f'CREATE DATABASE "{test_name}"')
        finally:
            await conn.close()

    asyncio.run(ensure_database())
    test_url = url.set(database=test_name).render_as_string(hide_password=False)
    settings.DATABASE_URL = test_url
    os.environ["DATABASE_URL"] = test_url  # inherited by the alembic subprocess
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=str(backend_dir),
        env=os.environ.copy(),
        check=True,
        capture_output=True,
    )


_isolate_test_database()

import app.core.security as security_module  # noqa: E402
from app.core.database import get_db  # noqa: E402
from app.main import app  # noqa: E402

# Disable rate limiting for general integration test fixtures unless explicitly enabled
settings.RATE_LIMIT_ENABLED = False

# Tests must never send real email. The dev .env can hold live SMTP credentials and registration sends a verification
# code, so without this every test that registers a user would email a fake address from the real account.
settings.SMTP_USER = None
settings.SMTP_PASSWORD = None

# Likewise never call a real AI provider from tests: the dev .env selects a live provider with real keys, which makes
# tests slow, flaky and billable. Tests that need provider behaviour select it explicitly or inject a fake.
settings.AI_PROVIDER = "mock"


# Modules that exercise the registration / verification / two-step login flow itself keep the raw behaviour.
_RAW_AUTH_FLOW_MODULES = {"test_login_otp_flow", "test_email_verification_flow", "test_verify_email_already_verified"}


def _json_or_empty(resp) -> dict:
    try:
        data = resp.json()
        return data if isinstance(data, dict) else {}
    except Exception:  # noqa: BLE001
        return {}


class _TwoStepLoginClient(AsyncClient):
    """
    Login is two-step (password, then an emailed code) and needs a verified email. Most API tests only need "a
    logged-in user", so for them this client finishes those steps with the codes the app would have emailed
    (recorded in `otps`), so `POST /auth/login` still returns tokens. Tests of the flow itself opt out.
    """

    otps: dict = {}

    async def post(self, url, *args, **kwargs):  # type: ignore[override]
        resp = await super().post(url, *args, **kwargs)
        if not str(url).endswith("/auth/login"):
            return resp
        email = ((kwargs.get("json") or {}).get("email") or "").strip().lower()
        data = _json_or_empty(resp)

        if resp.status_code == 403 and data.get("detail") == "email_not_verified" and self.otps.get((email, "verification")):
            await super().post("/api/v1/auth/verify-email", json={"email": email, "code": self.otps[(email, "verification")]})
            resp = await super().post(url, *args, **kwargs)
            data = _json_or_empty(resp)

        if resp.status_code == 200 and data.get("requires_otp") and self.otps.get((email, "login")):
            return await super().post("/api/v1/auth/verify-login-otp", json={"email": email, "code": self.otps[(email, "login")]})
        return resp


@pytest_asyncio.fixture
async def async_client(request, monkeypatch):
    # Create test engine using NullPool to prevent event loop connection leakage across tests
    test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
    test_session_maker = async_sessionmaker(
        bind=test_engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autocommit=False,
        autoflush=False,
    )

    async def override_get_db():
        async with test_session_maker() as session:
            try:
                yield session
            finally:
                await session.close()

    # Reset Redis client so it binds to the current test event loop
    security_module._redis_client = None

    app.dependency_overrides[get_db] = override_get_db

    raw = request.module.__name__.split(".")[-1] in _RAW_AUTH_FLOW_MODULES
    client_cls = AsyncClient if raw else _TwoStepLoginClient
    if not raw:
        from app.services.email import verification as verification_module

        otps: dict = {}
        original_send = verification_module.send_verification_email

        async def recording_send(to_email, otp_code, purpose="verification"):
            otps[(to_email.strip().lower(), purpose)] = otp_code
            return await original_send(to_email, otp_code, purpose)

        monkeypatch.setattr(verification_module, "send_verification_email", recording_send)
        client_cls = type("_BoundTwoStepClient", (_TwoStepLoginClient,), {"otps": otps})

    transport = ASGITransport(app=app)
    async with client_cls(transport=transport, base_url="http://testserver") as client:
        yield client

    app.dependency_overrides.clear()
    if security_module._redis_client:
        try:
            await security_module._redis_client.aclose()
        except Exception:
            pass
        security_module._redis_client = None
    await test_engine.dispose()
