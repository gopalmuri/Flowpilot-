import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from app.core.config import settings


@pytest_asyncio.fixture
async def db_engine():
    engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
    yield engine
    await engine.dispose()


@pytest.mark.asyncio
async def test_async_database_connection(db_engine):
    """Verify live async database connection and basic query execution."""
    async with db_engine.connect() as conn:
        result = await conn.execute(text("SELECT 1 AS connected"))
        row = result.mappings().one()
        assert row["connected"] == 1


@pytest.mark.asyncio
async def test_async_session_maker_lifecycle(db_engine):
    """Verify that async_sessionmaker generates functional sessions."""
    session_maker = async_sessionmaker(
        bind=db_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    async with session_maker() as session:
        result = await session.execute(text("SELECT current_database(), current_user"))
        db_name, user_name = result.one()
        assert db_name == settings.POSTGRES_DB
        assert user_name == settings.POSTGRES_USER


@pytest.mark.asyncio
async def test_alembic_version_table_populated(db_engine):
    """Verify that Alembic migration version table exists and contains the head revision."""
    async with db_engine.connect() as conn:
        result = await conn.execute(text("SELECT version_num FROM alembic_version"))
        version = result.scalar()
        assert version in ["0001_initial_schema", "0002_add_workflow_version_status"]


@pytest.mark.asyncio
async def test_database_connection_failure_handling():
    """Verify that database connection failures to invalid hosts are caught cleanly."""
    bad_engine = create_async_engine(
        "postgresql+asyncpg://invalid_user:invalid_pass@127.0.0.1:5433/nonexistent",
        connect_args={"timeout": 1},
        poolclass=NullPool,
    )
    with pytest.raises(Exception):
        async with bad_engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    await bad_engine.dispose()
