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
    email = f"ai_sim_user_{unique}@flowpilot.internal"

    async with session_factory() as session:
        user = User(
            email=email,
            password_hash="argon2id$mock$hash",
            full_name="AI Sim Tester",
            is_verified=True,
            is_active=True,
        )
        session.add(user)
        await session.flush()

        org = Organization(
            name=f"AI Sim Org {unique}",
            slug=f"ai-sim-org-{unique}",
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
async def test_workflow_ai_simulate_payload_api(async_client: AsyncClient, monkeypatch):
    monkeypatch.setattr(settings, "AI_PROVIDER", "mock")
    org_id, headers = await _create_test_workflow_and_token()

    base = f"/api/v1/organizations/{org_id}/workflows"
    wf_resp = await async_client.post(base, headers=headers, json={"name": "Sim Payload Workflow"})
    assert wf_resp.status_code == 201, wf_resp.text
    wf_id = wf_resp.json()["id"]

    sim_payload_url = f"{base}/{wf_id}/ai-simulate-payload"
    payload_body = {
        "steps": [
            {"step_key": "webhook_1", "step_type": "WEBHOOK_TRIGGER", "name": "Trigger", "config": {}},
            {"step_key": "cond_1", "step_type": "CONDITION", "name": "Rule", "config": {"field": "lead_score", "operator": ">=", "value": 75}},
        ],
        "connections": [{"source_step_key": "webhook_1", "target_step_key": "cond_1"}],
        "scenario": "happy_path",
    }
    resp = await async_client.post(sim_payload_url, headers=headers, json=payload_body)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["scenario"] == "happy_path"
    assert "lead_score" in data["payload"]


@pytest.mark.asyncio
async def test_workflow_ai_simulate_run_api(async_client: AsyncClient, monkeypatch):
    monkeypatch.setattr(settings, "AI_PROVIDER", "mock")
    org_id, headers = await _create_test_workflow_and_token()

    base = f"/api/v1/organizations/{org_id}/workflows"
    wf_resp = await async_client.post(base, headers=headers, json={"name": "Sim Run Workflow"})
    assert wf_resp.status_code == 201, wf_resp.text
    wf_id = wf_resp.json()["id"]

    sim_run_url = f"{base}/{wf_id}/ai-simulate-run"
    run_body = {
        "steps": [
            {"step_key": "webhook_1", "step_type": "WEBHOOK_TRIGGER", "name": "Trigger", "config": {}},
            {"step_key": "crm_1", "step_type": "MOCK_CRM_CREATE", "name": "CRM Sync", "config": {"entity_type": "lead"}},
        ],
        "connections": [{"source_step_key": "webhook_1", "target_step_key": "crm_1"}],
        "payload": {"company": "Acme", "email": "test@acme.com"},
    }
    resp = await async_client.post(sim_run_url, headers=headers, json=run_body)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["overall_outcome"] == "COMPLETED"
    assert len(data["steps"]) == 2
    assert data["steps"][0]["status"] == "SUCCESS"
    assert data["steps"][1]["status"] == "SUCCESS"
