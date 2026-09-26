import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from typing import AsyncGenerator
import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings
from app.engine.workflow_engine import WorkflowEngine
from app.models.approval import ApprovalRequest
from app.models.audit_log import AuditLog
from app.models.organization import Organization
from app.models.user import User
from app.models.workflow import Workflow, WorkflowVersion
from app.models.workflow_run import WorkflowRun, WorkflowStepRun
from app.models.workflow_step import WorkflowConnection, WorkflowStep
from app.schemas.execution import WorkflowRunStatus, WorkflowStepRunStatus


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@pytest_asyncio.fixture
async def session_factory() -> AsyncGenerator[async_sessionmaker[AsyncSession], None]:
    engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
    factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    yield factory
    await engine.dispose()


@pytest_asyncio.fixture
async def sample_approval_fixture(session_factory: async_sessionmaker[AsyncSession]):
    async with session_factory() as session:
        org = Organization(name=f"Org-{uuid.uuid4().hex[:6]}", slug=f"org-{uuid.uuid4().hex[:6]}")
        session.add(org)
        await session.flush()

        user = User(
            email=f"user-{uuid.uuid4().hex[:6]}@example.com",
            password_hash="hash",
            full_name="Reviewer User",
            is_active=True,
        )
        session.add(user)
        await session.flush()

        wf = Workflow(organization_id=org.id, name="HITL Workflow", status="ACTIVE", created_by=user.id)
        session.add(wf)
        await session.flush()

        version = WorkflowVersion(workflow_id=wf.id, version_number=1, status="PUBLISHED", created_by=user.id, definition={})
        session.add(version)
        await session.flush()

        wf.active_version_id = version.id

        step1 = WorkflowStep(
            workflow_version_id=version.id,
            step_key="start",
            step_type="MANUAL_TRIGGER",
            name="Trigger",
            config={},
        )
        step2 = WorkflowStep(
            workflow_version_id=version.id,
            step_key="approval_step",
            step_type="HUMAN_APPROVAL",
            name="Approval",
            config={"approver_role": "MANAGER", "timeout_hours": 24},
        )
        step_approved = WorkflowStep(
            workflow_version_id=version.id,
            step_key="approved_path",
            step_type="MOCK_CRM_CREATE",
            name="CRM",
            config={},
        )
        step_rejected = WorkflowStep(
            workflow_version_id=version.id,
            step_key="rejected_path",
            step_type="SLACK_NOTIFICATION",
            name="Slack",
            config={},
        )
        session.add_all([step1, step2, step_approved, step_rejected])
        await session.flush()

        conn1 = WorkflowConnection(
            workflow_version_id=version.id,
            source_step_id=step1.id,
            target_step_id=step2.id,
        )
        conn_app = WorkflowConnection(
            workflow_version_id=version.id,
            source_step_id=step2.id,
            target_step_id=step_approved.id,
            condition_label="approved",
        )
        conn_rej = WorkflowConnection(
            workflow_version_id=version.id,
            source_step_id=step2.id,
            target_step_id=step_rejected.id,
            condition_label="rejected",
        )
        session.add_all([conn1, conn_app, conn_rej])

        run = WorkflowRun(
            organization_id=org.id,
            workflow_id=wf.id,
            workflow_version_id=version.id,
            status=WorkflowRunStatus.PAUSED.value,
            trigger_type="MANUAL",
            trigger_payload={},
            correlation_id=f"corr_{uuid.uuid4().hex}",
            started_at=utc_now(),
        )
        session.add(run)
        await session.flush()

        step_run1 = WorkflowStepRun(
            workflow_run_id=run.id,
            step_id=step1.id,
            status=WorkflowStepRunStatus.COMPLETED.value,
            input_data={},
            output_data={},
            started_at=utc_now(),
            completed_at=utc_now(),
        )
        step_run2 = WorkflowStepRun(
            workflow_run_id=run.id,
            step_id=step2.id,
            status=WorkflowStepRunStatus.PAUSED.value,
            input_data={},
            output_data={},
            started_at=utc_now(),
        )
        session.add_all([step_run1, step_run2])
        await session.flush()

        approval = ApprovalRequest(
            organization_id=org.id,
            workflow_run_id=run.id,
            step_id=step2.id,
            status="PENDING",
            payload_snapshot={
                "step_key": "approval_step",
                "approval_context": {"approver_role": "MANAGER", "timeout_hours": 24},
            },
        )
        session.add(approval)
        await session.commit()

        return {
            "org_id": org.id,
            "user_id": user.id,
            "run_id": run.id,
            "step_id": step2.id,
            "approval_id": approval.id,
            "version_id": version.id,
        }


@pytest.mark.asyncio
async def test_single_active_approval_creation_guarantee(session_factory, sample_approval_fixture):
    """
    Verifies that under the WorkflowRun row lock, concurrent approval creation attempts
    for the same (workflow_run_id, step_id) produce exactly one active PENDING approval.
    """
    data = sample_approval_fixture
    engine = WorkflowEngine(session_factory=session_factory)

    # Clean up fixture approval to test creation from scratch
    async with session_factory() as session:
        stmt = select(ApprovalRequest).where(ApprovalRequest.workflow_run_id == data["run_id"])
        existing = (await session.execute(stmt)).scalars().all()
        for a in existing:
            await session.delete(a)
        await session.commit()

    async def create_attempt():
        async with session_factory() as session:
            # Row lock WorkflowRun
            run = await session.get(WorkflowRun, data["run_id"], with_for_update=True)
            # Check existing PENDING
            existing_stmt = select(ApprovalRequest).where(
                ApprovalRequest.workflow_run_id == data["run_id"],
                ApprovalRequest.step_id == data["step_id"],
                ApprovalRequest.status == "PENDING",
            ).with_for_update()
            existing = (await session.execute(existing_stmt)).scalar_one_or_none()
            if not existing:
                app_req = ApprovalRequest(
                    organization_id=data["org_id"],
                    workflow_run_id=data["run_id"],
                    step_id=data["step_id"],
                    status="PENDING",
                    payload_snapshot={"step_key": "approval_step"},
                )
                session.add(app_req)
                await session.commit()
                return True
            await session.commit()
            return False

    results = await asyncio.gather(create_attempt(), create_attempt())
    assert results.count(True) == 1
    assert results.count(False) == 1

    async with session_factory() as session:
        stmt = select(ApprovalRequest).where(
            ApprovalRequest.workflow_run_id == data["run_id"],
            ApprovalRequest.step_id == data["step_id"],
            ApprovalRequest.status == "PENDING",
        )
        approvals = (await session.execute(stmt)).scalars().all()
        assert len(approvals) == 1


@pytest.mark.asyncio
async def test_initial_approve_and_repeated_idempotency_after_completion(
    session_factory, sample_approval_fixture
):
    """
    Initial APPROVE -> 200, initiates DAG traversal.
    Repeated APPROVE after run completion -> 200 idempotent (zero additional DAG traversals).
    """
    data = sample_approval_fixture
    engine = WorkflowEngine(session_factory=session_factory)

    # 1. First APPROVE
    res1 = await engine.resume_run(
        organization_id=data["org_id"],
        run_id=data["run_id"],
        reviewer_id=data["user_id"],
        approved=True,
        comment="Initial approval",
        approval_id=data["approval_id"],
    )
    assert res1.status == WorkflowRunStatus.COMPLETED.value

    # Verify step runs
    async with session_factory() as session:
        stmt = select(WorkflowStepRun).where(WorkflowStepRun.workflow_run_id == data["run_id"])
        step_runs = {s.step_id: s for s in (await session.execute(stmt)).scalars().all()}
        assert step_runs[data["step_id"]].status == WorkflowStepRunStatus.COMPLETED.value
        assert step_runs[data["step_id"]].output_data["decision"] == "APPROVED"
        assert step_runs[data["step_id"]].output_data["selected_branch"] == "approved"

    # 2. Repeated APPROVE on COMPLETED workflow run
    res2 = await engine.resume_run(
        organization_id=data["org_id"],
        run_id=data["run_id"],
        reviewer_id=data["user_id"],
        approved=True,
        comment="Repeat approval attempt",
        approval_id=data["approval_id"],
    )
    assert res2.status == WorkflowRunStatus.COMPLETED.value
    assert res2.id == data["run_id"]


@pytest.mark.asyncio
async def test_initial_reject_and_repeated_idempotency_after_completion(
    session_factory, sample_approval_fixture
):
    """
    Initial REJECT -> 200, branches to 'rejected', non-fatal (run finishes COMPLETED).
    Repeated REJECT after run completion -> 200 idempotent (zero additional DAG traversals).
    """
    data = sample_approval_fixture
    engine = WorkflowEngine(session_factory=session_factory)

    # 1. First REJECT
    res1 = await engine.resume_run(
        organization_id=data["org_id"],
        run_id=data["run_id"],
        reviewer_id=data["user_id"],
        approved=False,
        comment="Initial rejection",
        approval_id=data["approval_id"],
    )
    # Rejection routes to "rejected" path (Slack notification), run finishes COMPLETED
    assert res1.status == WorkflowRunStatus.COMPLETED.value

    # Verify step runs: approval completed with REJECTED, rejected_path executed
    async with session_factory() as session:
        stmt = select(WorkflowStepRun).where(WorkflowStepRun.workflow_run_id == data["run_id"])
        step_runs = {s.step_id: s for s in (await session.execute(stmt)).scalars().all()}
        assert step_runs[data["step_id"]].status == WorkflowStepRunStatus.COMPLETED.value
        assert step_runs[data["step_id"]].output_data["decision"] == "REJECTED"
        assert step_runs[data["step_id"]].output_data["selected_branch"] == "rejected"

    # 2. Repeated REJECT on completed workflow run -> 200 OK idempotent
    res2 = await engine.resume_run(
        organization_id=data["org_id"],
        run_id=data["run_id"],
        reviewer_id=data["user_id"],
        approved=False,
        comment="Repeat reject attempt",
        approval_id=data["approval_id"],
    )
    assert res2.status == WorkflowRunStatus.COMPLETED.value


@pytest.mark.asyncio
async def test_conflicting_approval_decisions(session_factory, sample_approval_fixture):
    """
    APPROVE followed by REJECT -> 409 Conflict.
    REJECT followed by APPROVE -> 409 Conflict.
    """
    data = sample_approval_fixture
    engine = WorkflowEngine(session_factory=session_factory)

    # 1. Approve first
    await engine.resume_run(
        organization_id=data["org_id"],
        run_id=data["run_id"],
        reviewer_id=data["user_id"],
        approved=True,
        approval_id=data["approval_id"],
    )

    # 2. Attempt reject after approve -> 409 Conflict
    with pytest.raises(HTTPException) as exc_info:
        await engine.resume_run(
            organization_id=data["org_id"],
            run_id=data["run_id"],
            reviewer_id=data["user_id"],
            approved=False,
            approval_id=data["approval_id"],
        )
    assert exc_info.value.status_code == 409
    assert "already approved" in exc_info.value.detail.lower()


@pytest.mark.asyncio
async def test_reject_followed_by_approve_conflict(session_factory, sample_approval_fixture):
    data = sample_approval_fixture
    engine = WorkflowEngine(session_factory=session_factory)

    # 1. Reject first
    await engine.resume_run(
        organization_id=data["org_id"],
        run_id=data["run_id"],
        reviewer_id=data["user_id"],
        approved=False,
        approval_id=data["approval_id"],
    )

    # 2. Attempt approve after reject -> 409 Conflict
    with pytest.raises(HTTPException) as exc_info:
        await engine.resume_run(
            organization_id=data["org_id"],
            run_id=data["run_id"],
            reviewer_id=data["user_id"],
            approved=True,
            approval_id=data["approval_id"],
        )
    assert exc_info.value.status_code == 409
    assert "already rejected" in exc_info.value.detail.lower()


@pytest.mark.asyncio
async def test_terminal_run_with_pending_approval_returns_409(session_factory, sample_approval_fixture):
    """
    If a workflow run was marked FAILED or CANCELLED while approval is still PENDING,
    resolving the approval raises 409 Conflict.
    """
    data = sample_approval_fixture
    engine = WorkflowEngine(session_factory=session_factory)

    # Mark run as CANCELLED directly in database
    async with session_factory() as session:
        run = await session.get(WorkflowRun, data["run_id"])
        run.status = WorkflowRunStatus.CANCELLED.value
        await session.commit()

    with pytest.raises(HTTPException) as exc_info:
        await engine.resume_run(
            organization_id=data["org_id"],
            run_id=data["run_id"],
            reviewer_id=data["user_id"],
            approved=True,
            approval_id=data["approval_id"],
        )
    assert exc_info.value.status_code == 409
    assert "terminal state" in exc_info.value.detail.lower()


@pytest.mark.asyncio
async def test_lazy_expiration_lifecycle(session_factory, sample_approval_fixture):
    """
    When an approval has created_at + timeout_hours <= now, access transitions it to EXPIRED
    and fails the run, raising 409 Conflict on resume attempts.
    """
    data = sample_approval_fixture
    engine = WorkflowEngine(session_factory=session_factory)

    # Backdate created_at by 48 hours with timeout_hours = 24
    async with session_factory() as session:
        app_req = await session.get(ApprovalRequest, data["approval_id"])
        app_req.created_at = utc_now() - timedelta(hours=48)
        await session.commit()

    with pytest.raises(HTTPException) as exc_info:
        await engine.resume_run(
            organization_id=data["org_id"],
            run_id=data["run_id"],
            reviewer_id=data["user_id"],
            approved=True,
            approval_id=data["approval_id"],
        )
    assert exc_info.value.status_code == 409
    assert "expired" in exc_info.value.detail.lower()

    # Verify status in database
    async with session_factory() as session:
        app_req = await session.get(ApprovalRequest, data["approval_id"])
        assert app_req.status == "EXPIRED"

        run = await session.get(WorkflowRun, data["run_id"])
        assert run.status == WorkflowRunStatus.FAILED.value


@pytest.mark.asyncio
async def test_concurrent_approval_resolution_produces_single_traversal(
    session_factory, sample_approval_fixture
):
    """
    Two concurrent calls to resume_run: exactly one executes the state transition and traversal,
    and both succeed with 200 OK without double execution.
    """
    data = sample_approval_fixture
    engine = WorkflowEngine(session_factory=session_factory)

    task1 = engine.resume_run(
        organization_id=data["org_id"],
        run_id=data["run_id"],
        reviewer_id=data["user_id"],
        approved=True,
        approval_id=data["approval_id"],
    )
    task2 = engine.resume_run(
        organization_id=data["org_id"],
        run_id=data["run_id"],
        reviewer_id=data["user_id"],
        approved=True,
        approval_id=data["approval_id"],
    )

    r1, r2 = await asyncio.gather(task1, task2)
    # The winning task completes the traversal (COMPLETED); the other returns the locked state (RUNNING or COMPLETED)
    assert r1.status in (WorkflowRunStatus.RUNNING.value, WorkflowRunStatus.COMPLETED.value)
    assert r2.status in (WorkflowRunStatus.RUNNING.value, WorkflowRunStatus.COMPLETED.value)
    assert WorkflowRunStatus.COMPLETED.value in (r1.status, r2.status)

    # In database, final status is COMPLETED and exactly one traversal occurred
    async with session_factory() as session:
        final_run = await session.get(WorkflowRun, data["run_id"])
        assert final_run.status == WorkflowRunStatus.COMPLETED.value

        # Verify only one execution of the downstream step occurred
        stmt = select(WorkflowStepRun).where(
            WorkflowStepRun.workflow_run_id == data["run_id"],
            WorkflowStepRun.status == WorkflowStepRunStatus.COMPLETED.value,
        )
        completed_steps = (await session.execute(stmt)).scalars().all()
        # Trigger, Approval, and Approved Path = 3 completed steps
        assert len(completed_steps) == 3
