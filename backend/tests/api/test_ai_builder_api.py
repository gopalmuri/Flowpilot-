import uuid
from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings
from app.core.security import create_access_token
from app.models.base import utc_now
from app.models.membership import OrganizationMember, OrganizationRole
from app.models.organization import Organization
from app.models.usage import UsageRecord
from app.models.user import User
from app.models.workflow import Workflow, WorkflowVersion
from app.models.workflow_run import WorkflowRun, WorkflowStepRun
from app.models.workflow_step import WorkflowStep
from app.schemas.workflow import StepType


def _session_factory():
    engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
    return async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)


async def _org_and_token(role: str = OrganizationRole.OWNER.value):
    unique = uuid.uuid4().hex[:8]
    email = f"builder_{unique}@flowpilot.internal"
    async with _session_factory()() as session:
        user = User(email=email, password_hash="argon2id$mock$hash", full_name="Builder", is_verified=True, is_active=True)
        session.add(user)
        await session.flush()
        org = Organization(name=f"Builder Org {unique}", slug=f"builder-{unique}")
        session.add(org)
        await session.flush()
        session.add(OrganizationMember(organization_id=org.id, user_id=user.id, role=role))
        await session.commit()
        token, _, _ = create_access_token(user_id=str(user.id), email=email, org_id=str(org.id), role=role)
        return str(org.id), {"Authorization": f"Bearer {token}"}


PROPOSAL = {
    "name": "Lead approval",
    "description": "Approve big leads",
    "steps": [
        {"step_key": "t", "step_type": "WEBHOOK_TRIGGER", "name": "Lead arrives", "config": {}, "ui_position": {"x": 300, "y": 80}},
        {"step_key": "a", "step_type": "HUMAN_APPROVAL", "name": "Manager approves", "config": {"approver_role": "MANAGER"}, "ui_position": {"x": 300, "y": 220}},
        {"step_key": "c", "step_type": "MOCK_CRM_CREATE", "name": "Add to CRM", "config": {"entity_type": "lead"}, "ui_position": {"x": 300, "y": 360}},
    ],
    "connections": [
        {"source_step_key": "t", "target_step_key": "a"},
        {"source_step_key": "a", "target_step_key": "c", "condition_label": "approved"},
    ],
}


@pytest.fixture(autouse=True)
def _mock_ai(monkeypatch):
    monkeypatch.setattr(settings, "AI_PROVIDER", "mock")


@pytest.mark.asyncio
async def test_catalog_lists_every_step_type_with_plain_labels(async_client: AsyncClient):
    org, h = await _org_and_token()
    resp = await async_client.get(f"/api/v1/organizations/{org}/workflows/catalog", headers=h)
    assert resp.status_code == 200, resp.text
    items = resp.json()
    assert {i["step_type"] for i in items} == {t.value for t in StepType}
    assert all(i["label"] and i["description"] for i in items)
    assert next(i for i in items if i["step_type"] == "HUMAN_APPROVAL")["edge_labels"] == ["approved", "rejected"]


@pytest.mark.asyncio
async def test_templates_endpoint(async_client: AsyncClient):
    org, h = await _org_and_token()
    resp = await async_client.get(f"/api/v1/organizations/{org}/workflows/templates", headers=h)
    assert resp.status_code == 200
    assert len(resp.json()) >= 6
    assert all(t["prompt"] and t["category"] for t in resp.json())


@pytest.mark.asyncio
async def test_endpoints_require_authentication(async_client: AsyncClient):
    org = str(uuid.uuid4())
    base = f"/api/v1/organizations/{org}/workflows"
    for method, url in [("get", "/catalog"), ("get", "/templates"), ("post", "/ai-builder"), ("post", "/ai-builder/create")]:
        resp = await getattr(async_client, method)(base + url, **({"json": {}} if method == "post" else {}))
        assert resp.status_code in (401, 403), (url, resp.status_code)


@pytest.mark.asyncio
async def test_prompt_first_builder_returns_validated_proposal_with_setup_checklist(async_client: AsyncClient):
    org, h = await _org_and_token()
    resp = await async_client.post(
        f"/api/v1/organizations/{org}/workflows/ai-builder",
        headers=h,
        json={"prompt": "Create a lead flow with a manager approval and a Slack alert on #sales"},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["mode"] == "proposal"
    assert data["proposal"]["valid"] is True
    assert isinstance(data["setup_needed"], list)
    # nothing is created by just asking
    async with _session_factory()() as s:
        assert (await s.scalars(select(Workflow).where(Workflow.organization_id == uuid.UUID(org)))).first() is None


@pytest.mark.asyncio
async def test_unsupported_requests_are_reported_not_faked(async_client: AsyncClient):
    org, h = await _org_and_token()
    resp = await async_client.post(
        f"/api/v1/organizations/{org}/workflows/ai-builder",
        headers=h,
        json={"prompt": "Create a lead flow with approval then send a WhatsApp message and wait 2 days"},
    )
    assert resp.status_code == 200
    joined = " ".join(resp.json()["unsupported"]).lower()
    assert "whatsapp" in joined and "waiting" in joined


@pytest.mark.asyncio
async def test_operator_cannot_use_the_builder(async_client: AsyncClient):
    org, h = await _org_and_token(role=OrganizationRole.OPERATOR.value)
    resp = await async_client.post(f"/api/v1/organizations/{org}/workflows/ai-builder", headers=h, json={"prompt": "x"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_create_makes_a_draft_and_never_activates(async_client: AsyncClient):
    org, h = await _org_and_token()
    base = f"/api/v1/organizations/{org}/workflows"
    resp = await async_client.post(f"{base}/ai-builder/create", headers=h, json=PROPOSAL)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["status"] == "DRAFT" and body["valid"] is True

    detail = await async_client.get(f"{base}/{body['workflow_id']}", headers=h)
    assert detail.status_code == 200
    assert detail.json()["status"] == "DRAFT" and detail.json()["active_version_id"] is None

    version = await async_client.get(f"{base}/{body['workflow_id']}/versions/{body['version_id']}", headers=h)
    assert version.status_code == 200
    v = version.json()
    assert v["status"] == "DRAFT" and len(v["steps"]) == 3 and len(v["connections"]) == 2
    assert {c["condition_label"] for c in v["connections"]} == {None, "approved"}


@pytest.mark.asyncio
async def test_create_rejects_duplicate_keys_and_dangling_connections(async_client: AsyncClient):
    org, h = await _org_and_token()
    url = f"/api/v1/organizations/{org}/workflows/ai-builder/create"

    dup = {**PROPOSAL, "steps": PROPOSAL["steps"] + [PROPOSAL["steps"][0]]}
    assert (await async_client.post(url, headers=h, json=dup)).status_code == 400

    dangling = {**PROPOSAL, "connections": [{"source_step_key": "t", "target_step_key": "nope"}]}
    assert (await async_client.post(url, headers=h, json=dangling)).status_code == 400


@pytest.mark.asyncio
async def test_create_reports_an_invalid_flow_but_still_saves_a_draft(async_client: AsyncClient):
    org, h = await _org_and_token()
    broken = {**PROPOSAL, "steps": [{"step_key": "x", "step_type": "VALIDATE_DATA", "name": "Check", "config": {}}], "connections": []}
    resp = await async_client.post(f"/api/v1/organizations/{org}/workflows/ai-builder/create", headers=h, json=broken)
    assert resp.status_code == 201
    assert resp.json()["valid"] is False and resp.json()["warnings"]


@pytest.mark.asyncio
async def test_daily_ai_limit_returns_a_friendly_429_and_counts_usage(async_client: AsyncClient, monkeypatch):
    monkeypatch.setattr(settings, "AI_DAILY_REQUEST_LIMIT_PER_ORG", 2)
    org, h = await _org_and_token()
    url = f"/api/v1/organizations/{org}/workflows/ai-builder"
    body = {"prompt": "lead flow with approval"}

    assert (await async_client.post(url, headers=h, json=body)).status_code == 200
    assert (await async_client.post(url, headers=h, json=body)).status_code == 200
    third = await async_client.post(url, headers=h, json=body)
    assert third.status_code == 429
    assert "AI requests for today" in third.json()["detail"]

    async with _session_factory()() as s:
        rows = list(await s.scalars(select(UsageRecord).where(UsageRecord.organization_id == uuid.UUID(org), UsageRecord.metric_type == "ai_request")))
        assert sum(r.quantity for r in rows) == 2


@pytest.mark.asyncio
async def test_limit_is_per_organisation(async_client: AsyncClient, monkeypatch):
    monkeypatch.setattr(settings, "AI_DAILY_REQUEST_LIMIT_PER_ORG", 1)
    org_a, ha = await _org_and_token()
    org_b, hb = await _org_and_token()
    body = {"prompt": "lead flow"}
    assert (await async_client.post(f"/api/v1/organizations/{org_a}/workflows/ai-builder", headers=ha, json=body)).status_code == 200
    assert (await async_client.post(f"/api/v1/organizations/{org_a}/workflows/ai-builder", headers=ha, json=body)).status_code == 429
    assert (await async_client.post(f"/api/v1/organizations/{org_b}/workflows/ai-builder", headers=hb, json=body)).status_code == 200


# ---------------------------------------------------------------------------- failed-run explain + suggestions
async def _workflow_with_failed_run(async_client, org, h, runs: int = 1):
    base = f"/api/v1/organizations/{org}/workflows"
    created = (await async_client.post(f"{base}/ai-builder/create", headers=h, json={
        **PROPOSAL,
        "steps": [
            {"step_key": "t", "step_type": "WEBHOOK_TRIGGER", "name": "Lead arrives", "config": {}},
            {"step_key": "v", "step_type": "VALIDATE_DATA", "name": "Check email present", "config": {"required_fields": ["email"]}},
        ],
        "connections": [{"source_step_key": "t", "target_step_key": "v"}],
    })).json()
    wf_id, version_id = uuid.UUID(created["workflow_id"]), uuid.UUID(created["version_id"])
    run_ids = []
    async with _session_factory()() as s:
        step = await s.scalar(select(WorkflowStep).where(WorkflowStep.workflow_version_id == version_id, WorkflowStep.step_key == "v"))
        for _ in range(runs):
            run = WorkflowRun(
                organization_id=uuid.UUID(org), workflow_id=wf_id, workflow_version_id=version_id, status="FAILED",
                trigger_type="WEBHOOK", trigger_payload={"name": "Asha", "api_key": "sk-secret"},
                correlation_id=uuid.uuid4().hex, error_message="Validation failed: missing required fields: email",
            )
            s.add(run)
            await s.flush()
            s.add(WorkflowStepRun(workflow_run_id=run.id, step_id=step.id, status="FAILED",
                                  error_message="Validation failed: missing required fields: email"))
            run_ids.append(run.id)
        await s.commit()
    return str(wf_id), run_ids


@pytest.mark.asyncio
async def test_explain_failed_run_gives_plain_language_without_a_model(async_client: AsyncClient):
    org, h = await _org_and_token()
    wf_id, [run_id] = await _workflow_with_failed_run(async_client, org, h)
    resp = await async_client.post(f"/api/v1/organizations/{org}/workflows/{wf_id}/runs/{run_id}/ai-explain", headers=h)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["used_ai"] is False  # mock provider: deterministic answer only
    assert "Check email present" in data["explanation"]
    assert data["failed_steps"][0]["step_key"] == "v"
    assert any("email" in n for n in data["next_steps"])
    assert data["suggested_fix"] is None and data["base_version_id"]


@pytest.mark.asyncio
async def test_explain_is_tenant_isolated(async_client: AsyncClient):
    org_a, ha = await _org_and_token()
    org_b, hb = await _org_and_token()
    wf_id, [run_id] = await _workflow_with_failed_run(async_client, org_a, ha)
    resp = await async_client.post(f"/api/v1/organizations/{org_b}/workflows/{wf_id}/runs/{run_id}/ai-explain", headers=hb)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_explain_unknown_run_is_404(async_client: AsyncClient):
    org, h = await _org_and_token()
    wf_id, _ = await _workflow_with_failed_run(async_client, org, h)
    resp = await async_client.post(f"/api/v1/organizations/{org}/workflows/{wf_id}/runs/{uuid.uuid4()}/ai-explain", headers=h)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_suggestions_for_a_workflow_with_no_runs(async_client: AsyncClient):
    org, h = await _org_and_token()
    created = (await async_client.post(f"/api/v1/organizations/{org}/workflows/ai-builder/create", headers=h, json=PROPOSAL)).json()
    resp = await async_client.post(f"/api/v1/organizations/{org}/workflows/{created['workflow_id']}/ai-suggestions", headers=h)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["stats"]["total_runs"] == 0
    assert data["suggestions"][0]["id"] == "no_runs"
    assert data["proposal"] is None


@pytest.mark.asyncio
async def test_suggestions_report_real_failure_statistics(async_client: AsyncClient):
    org, h = await _org_and_token()
    wf_id, _ = await _workflow_with_failed_run(async_client, org, h, runs=3)
    resp = await async_client.post(f"/api/v1/organizations/{org}/workflows/{wf_id}/ai-suggestions", headers=h)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["stats"]["total_runs"] == 3 and data["stats"]["failed_runs"] == 3
    assert data["stats"]["failure_rate"] == 1.0
    assert data["stats"]["top_failing_steps"][0] == {"step_key": "v", "name": "Check email present", "failures": 3}
    top = data["suggestions"][0]
    assert top["id"] == "high_failure" and top["severity"] == "critical"
    assert "100%" in top["title"] and "Check email present" in top["detail"]


@pytest.mark.asyncio
async def test_existing_editor_assist_is_metered_too(async_client: AsyncClient, monkeypatch):
    monkeypatch.setattr(settings, "AI_DAILY_REQUEST_LIMIT_PER_ORG", 1)
    org, h = await _org_and_token()
    base = f"/api/v1/organizations/{org}/workflows"
    wf = (await async_client.post(base, headers=h, json={"name": "Editor"})).json()["id"]
    assert (await async_client.post(f"{base}/{wf}/ai-assist", headers=h, json={"prompt": "lead flow"})).status_code == 200
    assert (await async_client.post(f"{base}/{wf}/ai-assist", headers=h, json={"prompt": "lead flow"})).status_code == 429


# ---------------------------------------------------------------------------- stateless simulation + last-run info
@pytest.mark.asyncio
async def test_simulate_a_proposal_before_it_is_saved(async_client: AsyncClient):
    org, h = await _org_and_token()
    base = f"/api/v1/organizations/{org}/workflows/ai-builder"
    body = {"steps": PROPOSAL["steps"], "connections": PROPOSAL["connections"]}

    sample = await async_client.post(f"{base}/simulate-payload", headers=h, json={**body, "scenario": "happy_path"})
    assert sample.status_code == 200, sample.text
    assert isinstance(sample.json()["payload"], dict) and sample.json()["payload"]

    run = await async_client.post(f"{base}/simulate-run", headers=h, json={**body, "payload": sample.json()["payload"]})
    assert run.status_code == 200, run.text
    data = run.json()
    assert data["overall_outcome"] == "PENDING_APPROVAL"  # approval gate is on the path
    assert [s["step_id"] for s in data["steps"]][:2] == ["t", "a"]

    # purely a dry run: nothing was saved
    async with _session_factory()() as s:
        assert (await s.scalars(select(Workflow).where(Workflow.organization_id == uuid.UUID(org)))).first() is None


@pytest.mark.asyncio
async def test_simulation_endpoints_are_role_and_auth_protected(async_client: AsyncClient):
    org, h = await _org_and_token(role=OrganizationRole.OPERATOR.value)
    url = f"/api/v1/organizations/{org}/workflows/ai-builder/simulate-run"
    assert (await async_client.post(url, headers=h, json={"steps": [], "connections": [], "payload": {}})).status_code == 403
    assert (await async_client.post(url, json={"steps": []})).status_code in (401, 403)


@pytest.mark.asyncio
async def test_workflow_list_reports_last_run_status(async_client: AsyncClient):
    org, h = await _org_and_token()
    base = f"/api/v1/organizations/{org}/workflows"
    never = (await async_client.post(f"{base}/ai-builder/create", headers=h, json=PROPOSAL)).json()["workflow_id"]
    wf_id, _ = await _workflow_with_failed_run(async_client, org, h, runs=2)

    items = {i["id"]: i for i in (await async_client.get(base, headers=h)).json()["items"]}
    assert items[never]["last_run_status"] is None and items[never]["last_run_at"] is None
    assert items[wf_id]["last_run_status"] == "FAILED" and items[wf_id]["last_run_at"]
