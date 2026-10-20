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


@pytest_asyncio.fixture
async def async_client():
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

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        yield client

    app.dependency_overrides.clear()
    if security_module._redis_client:
        try:
            await security_module._redis_client.aclose()
        except Exception:
            pass
        security_module._redis_client = None
    await test_engine.dispose()
