import sys
from pathlib import Path

# Ensure backend root is in sys.path
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings
from app.core.database import get_db
import app.core.security as security_module
from app.main import app

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
