import uuid
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings
from app.core.security import create_access_token
from app.models.membership import OrganizationMember, OrganizationRole
from app.models.organization import Organization
from app.models.user import User


async def _create_test_workflow_and_token():
    engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

    unique = uuid.uuid4().hex[:8]
    email = f"ai_user_{unique}@flowpilot.internal"

    async with session_factory() as session:
        user = User(
            email=email,
            password_hash="argon2id$mock$hash",
            full_name="AI Workflow Tester",
            is_verified=True,
            is_active=True,
        )
        session.add(user)
        await session.flush()

        org = Organization(
            name=f"AI Workflow Org {unique}",
            slug=f"ai-org-{unique}",
        )
        session.add(org)
        await session.flush()

        member = OrganizationMember(
            organization_id=org.id,
            user_id=user.id,
            role=OrganizationRole.OWNER.value,
        )
        session.add(member)
        await session.commit()

        token, _, _ = create_access_token(
            user_id=str(user.id),
            email=email,
            org_id=str(org.id),
            role=OrganizationRole.OWNER.value,
        )
        headers = {"Authorization": f"Bearer {token}"}
        return str(org.id), headers


@pytest.mark.asyncio
async def test_workflow_ai_assist_endpoint(async_client: AsyncClient, monkeypatch):
    monkeypatch.setattr(settings, "AI_PROVIDER", "mock")
    org_id, headers = await _create_test_workflow_and_token()


    # Create a workflow
    base = f"/api/v1/organizations/{org_id}/workflows"
    wf_resp = await async_client.post(base, headers=headers, json={"name": "AI Test Workflow"})
    assert wf_resp.status_code == 201, wf_resp.text
    wf_id = wf_resp.json()["id"]

    # Call AI assist
    ai_assist_url = f"{base}/{wf_id}/ai-assist"
    payload = {
        "prompt": "Create an automated lead triage pipeline with human gate and Slack notifications",
        "conversation_history": [],
        "current_steps": [],
        "current_connections": [],
    }

    resp = await async_client.post(ai_assist_url, headers=headers, json=payload)
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["mode"] in ("proposal", "clarification", "suggestion", "explanation")
    assert "message" in data
    assert isinstance(data["message"], str)
    if data["mode"] == "proposal":
        assert data["proposal"] is not None
        assert "steps" in data["proposal"]
        assert "connections" in data["proposal"]
        assert "diff_summary" in data["proposal"]
        assert data["proposal"]["valid"] is True


@pytest.mark.asyncio
async def test_workflow_ai_assist_unauthorized(async_client: AsyncClient):
    fake_org = str(uuid.uuid4())
    fake_wf = str(uuid.uuid4())
    resp = await async_client.post(
        f"/api/v1/organizations/{fake_org}/workflows/{fake_wf}/ai-assist",
        json={"prompt": "Test"},
    )
    assert resp.status_code in (401, 403)
