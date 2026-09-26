import asyncio
import uuid
from datetime import datetime, timezone
from typing import AsyncGenerator
import pytest
import pytest_asyncio
import httpx
from redis.exceptions import RedisError
from sqlalchemy import select
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings
from app.engine.workflow_engine import WorkflowEngine
from app.models.approval import ApprovalRequest
from app.models.organization import Organization
from app.models.user import User
from app.models.workflow import Workflow, WorkflowVersion
from app.models.workflow_run import WorkflowRun, WorkflowStepRun
from app.models.workflow_step import WorkflowConnection, WorkflowStep
from app.schemas.execution import WorkflowRunStatus
from app.workers.celery_app import celery_app, health_check_task
from app.workers.tasks import (
    execute_workflow_run,
    resume_workflow_run,
    process_webhook_event,
)


@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
    session_factory = async_sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    async with session_factory() as session:
        yield session
    await engine.dispose()


@pytest_asyncio.fixture
async def test_org(db_session: AsyncSession) -> Organization:
    org = Organization(
        name=f"Celery-Org-{uuid.uuid4().hex[:8]}",
        slug=f"celery-org-{uuid.uuid4().hex[:8]}",
    )
    db_session.add(org)
    await db_session.commit()
    await db_session.refresh(org)
    return org


@pytest_asyncio.fixture
async def test_user(db_session: AsyncSession, test_org: Organization) -> User:
    user = User(
        email=f"celery-user-{uuid.uuid4().hex[:8]}@example.com",
        password_hash="fakehashfortest",
        full_name="Celery Test User",
        is_active=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def simple_workflow(
    db_session: AsyncSession, test_org: Organization, test_user: User
) -> tuple[Workflow, WorkflowVersion]:
    wf = Workflow(
        organization_id=test_org.id,
        created_by=test_user.id,
        name="Celery Task Test Workflow",
        status="ACTIVE",
    )
    db_session.add(wf)
    await db_session.commit()
    await db_session.refresh(wf)

    ver = WorkflowVersion(
        workflow_id=wf.id,
        version_number=1,
        status="PUBLISHED",
        created_by=test_user.id,
        definition={},
    )
    db_session.add(ver)
    await db_session.commit()
    await db_session.refresh(ver)

    wf.active_version_id = ver.id
    await db_session.commit()

    trigger_step = WorkflowStep(
        workflow_version_id=ver.id,
        step_key="start",
        step_type="MANUAL_TRIGGER",
        name="Manual Trigger",
        config={},
    )
    ai_step = WorkflowStep(
        workflow_version_id=ver.id,
        step_key="ai_classify",
        step_type="AI_CLASSIFICATION",
        name="AI Classify Step",
        config={"prompt": "Classify input: {{trigger.text}}", "categories": ["lead", "support", "billing"]},
    )
    db_session.add_all([trigger_step, ai_step])
    await db_session.flush()

    conn = WorkflowConnection(
        workflow_version_id=ver.id,
        source_step_id=trigger_step.id,
        target_step_id=ai_step.id,
    )
    db_session.add(conn)
    await db_session.commit()
    return wf, ver


# ==============================================================================
# Celery Worker Unit Tests
# ==============================================================================

@pytest.mark.asyncio
async def test_celery_task_retry_configuration():
    """Verify that tasks are configured with exponential retry backoff and error types."""
    assert OperationalError in execute_workflow_run.autoretry_for
    assert RedisError in execute_workflow_run.autoretry_for
    assert httpx.RequestError in execute_workflow_run.autoretry_for
    assert execute_workflow_run.retry_backoff is True
    assert execute_workflow_run.max_retries == 3

    assert OperationalError in resume_workflow_run.autoretry_for
    assert RedisError in resume_workflow_run.autoretry_for
    assert httpx.RequestError in resume_workflow_run.autoretry_for
    assert resume_workflow_run.retry_backoff is True

    assert OperationalError in process_webhook_event.autoretry_for
    assert RedisError in process_webhook_event.autoretry_for
    assert httpx.RequestError in process_webhook_event.autoretry_for


@pytest.mark.asyncio
async def test_health_check_task():
    """Verify Celery health check task returns ok."""
    result = health_check_task.apply().get()
    assert result["status"] == "ok"
    assert result["worker"] == "celery"
    assert "ready" in result["message"]


@pytest.mark.asyncio
async def test_execute_workflow_run_missing_run():
    """Verify handling when run_id does not exist."""
    fake_org = str(uuid.uuid4())
    fake_run = str(uuid.uuid4())
    fake_ver = str(uuid.uuid4())

    result = execute_workflow_run.apply(
        args=[fake_org, fake_run, fake_ver, {"text": "hello"}]
    ).get()

    assert result["status"] == "FAILED"
    assert "not found" in result.get("error_message", "").lower()


@pytest.mark.asyncio
async def test_execute_workflow_run_e2e_task(
    db_session: AsyncSession,
    test_org: Organization,
    simple_workflow: tuple[Workflow, WorkflowVersion],
):
    """Verify that execute_workflow_run task executes DAG and transitions run to COMPLETED."""
    wf, ver = simple_workflow

    # Create run in PENDING status
    run = WorkflowRun(
        organization_id=test_org.id,
        workflow_id=wf.id,
        workflow_version_id=ver.id,
        status=WorkflowRunStatus.PENDING.value,
        trigger_type="MANUAL",
        trigger_payload={"text": "Celery background test input"},
        correlation_id=f"corr_{uuid.uuid4().hex[:12]}",
    )
    db_session.add(run)
    await db_session.commit()
    await db_session.refresh(run)

    # Invoke Celery task (in-process via eager apply)
    result = execute_workflow_run.apply(
        args=[
            str(test_org.id),
            str(run.id),
            str(ver.id),
            {"text": "Celery background test input"},
            run.correlation_id,
        ]
    ).get()

    assert result["status"] == WorkflowRunStatus.COMPLETED.value
    assert result["run_id"] == str(run.id)

    # Verify database state
    await db_session.refresh(run)
    assert run.status == WorkflowRunStatus.COMPLETED.value
    assert run.completed_at is not None

    # Verify step runs were executed
    steps_stmt = select(WorkflowStepRun).where(WorkflowStepRun.workflow_run_id == run.id)
    step_runs = (await db_session.execute(steps_stmt)).scalars().all()
    assert len(step_runs) == 2
    assert all(sr.status == "COMPLETED" for sr in step_runs)


@pytest.mark.asyncio
async def test_resume_workflow_run_task(
    test_org: Organization,
    test_user: User,
):
    """Verify resume_workflow_run task resumes a paused human approval run."""
    engine_db = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
    session_factory = async_sessionmaker(
        bind=engine_db,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    async with session_factory() as session:
        # 1. Setup workflow with MANUAL_TRIGGER -> HUMAN_APPROVAL
        wf = Workflow(
            organization_id=test_org.id,
            created_by=test_user.id,
            name="Approval Resumption Workflow",
            status="ACTIVE",
        )
        session.add(wf)
        await session.commit()
        await session.refresh(wf)

        ver = WorkflowVersion(
            workflow_id=wf.id,
            version_number=1,
            status="PUBLISHED",
            created_by=test_user.id,
            definition={},
        )
        session.add(ver)
        await session.commit()
        await session.refresh(ver)

        wf.active_version_id = ver.id
        await session.commit()

        step_trig = WorkflowStep(
            workflow_version_id=ver.id,
            step_key="trigger",
            step_type="MANUAL_TRIGGER",
            name="Manual Trigger",
            config={},
        )
        step_appr = WorkflowStep(
            workflow_version_id=ver.id,
            step_key="manager_approval",
            step_type="HUMAN_APPROVAL",
            name="Manager Approval Step",
            config={"approver_role": "MANAGER", "timeout_hours": 24},
        )
        session.add_all([step_trig, step_appr])
        await session.flush()

        conn = WorkflowConnection(
            workflow_version_id=ver.id,
            source_step_id=step_trig.id,
            target_step_id=step_appr.id,
        )
        session.add(conn)
        await session.commit()

    # 2. Run engine to pause at approval
    engine = WorkflowEngine(session_factory=session_factory)
    run = await engine.execute_new_run(
        organization_id=test_org.id,
        workflow_id=wf.id,
        trigger_payload={"deal_value": 50000},
    )
    assert run.status == WorkflowRunStatus.PAUSED.value

    # Lookup approval request
    async with session_factory() as session:
        appr_stmt = select(ApprovalRequest).where(ApprovalRequest.workflow_run_id == run.id)
        appr = (await session.execute(appr_stmt)).scalar_one()
        appr_id = appr.id

    # 3. Resume via Celery task
    res = resume_workflow_run.apply(
        args=[
            str(test_org.id),
            str(run.id),
            str(test_user.id),
            True,
            "Approved in background worker",
            str(appr_id),
        ]
    ).get()

    assert res["status"] == WorkflowRunStatus.COMPLETED.value

    # Verify run updated in database
    async with session_factory() as session:
        db_run = await session.get(WorkflowRun, run.id)
        assert db_run.status == WorkflowRunStatus.COMPLETED.value

    await engine_db.dispose()


@pytest.mark.asyncio
async def test_process_webhook_event_task(
    db_session: AsyncSession,
    test_org: Organization,
    test_user: User,
):
    """Verify process_webhook_event task creates run and executes DAG."""
    # Setup webhook workflow with WEBHOOK_TRIGGER -> AI_CLASSIFICATION
    wf = Workflow(
        organization_id=test_org.id,
        created_by=test_user.id,
        name="Webhook Celery Workflow",
        status="ACTIVE",
        webhook_key=f"wh_test_key_{uuid.uuid4().hex[:8]}",
    )
    db_session.add(wf)
    await db_session.commit()
    await db_session.refresh(wf)

    ver = WorkflowVersion(
        workflow_id=wf.id,
        version_number=1,
        status="PUBLISHED",
        created_by=test_user.id,
        definition={},
    )
    db_session.add(ver)
    await db_session.commit()
    await db_session.refresh(ver)

    wf.active_version_id = ver.id
    await db_session.commit()

    trig = WorkflowStep(
        workflow_version_id=ver.id,
        step_key="trigger",
        step_type="WEBHOOK_TRIGGER",
        name="Webhook Trigger",
        config={"secret_token": "wh_secret_xyz", "allowed_methods": ["POST"]},
    )
    ai_step = WorkflowStep(
        workflow_version_id=ver.id,
        step_key="ai",
        step_type="AI_CLASSIFICATION",
        name="AI Step",
        config={"prompt": "Classify: {{trigger.text}}", "categories": ["general", "urgent"]},
    )
    db_session.add_all([trig, ai_step])
    await db_session.flush()

    conn = WorkflowConnection(
        workflow_version_id=ver.id,
        source_step_id=trig.id,
        target_step_id=ai_step.id,
    )
    db_session.add(conn)
    await db_session.commit()

    result = process_webhook_event.apply(
        args=[
            str(test_org.id),
            str(wf.id),
            "wh_test_key_123",
            {"text": "Incoming webhook data"},
            "corr_webhook_123",
            "idem_wh_key_123",
        ]
    ).get()

    assert result["status"] == WorkflowRunStatus.COMPLETED.value
    assert result["is_idempotent"] is False

    # Second call with same idempotency key is idempotent
    result2 = process_webhook_event.apply(
        args=[
            str(test_org.id),
            str(wf.id),
            "wh_test_key_123",
            {"text": "Incoming webhook data"},
            "corr_webhook_123",
            "idem_wh_key_123",
        ]
    ).get()

    assert result2["is_idempotent"] is True
    assert result2["run_id"] == result["run_id"]
