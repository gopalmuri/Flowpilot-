import uuid
import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings
from app.models.usage import UsageRecord


async def create_authenticated_user(async_client: AsyncClient, name: str):
    unique = uuid.uuid4().hex[:8]
    email = f"{name}_{unique}@flowpilot.internal"
    password = f"SecurePass_{unique}!123"
    reg_payload = {
        "email": email,
        "password": password,
        "full_name": f"{name.capitalize()} User",
    }
    await async_client.post("/api/v1/auth/register", json=reg_payload)
    login_resp = await async_client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )
    token = login_resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    return email, password, headers


async def create_org_and_owner(async_client: AsyncClient, name: str):
    email, password, headers = await create_authenticated_user(async_client, name)
    resp = await async_client.post(
        "/api/v1/organizations",
        headers=headers,
        json={"name": f"{name.capitalize()} Corp"},
    )
    assert resp.status_code == 201
    org_id = resp.json()["id"]

    login_resp = await async_client.post(
        "/api/v1/auth/login", json={"email": email, "password": password, "organization_id": org_id}
    )
    org_token = login_resp.json()["access_token"]
    return org_id, {"Authorization": f"Bearer {org_token}"}


# ==============================================================================
# 1. End-to-End AI Classification Workflow Execution with Downstream Condition
# ==============================================================================

@pytest.mark.asyncio
async def test_ai_classification_workflow_downstream_condition_and_token_usage(async_client: AsyncClient):
    org_id, headers = await create_org_and_owner(async_client, "ai_e2e")

    # 1. Create Workflow
    wf = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows",
            headers=headers,
            json={"name": "AI Triage & Route Pipeline"},
        )
    ).json()
    wf_id = wf["id"]
    v1_id = (
        await async_client.get(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions",
            headers=headers,
        )
    ).json()[0]["id"]

    # 2. Configure DAG:
    # MANUAL_TRIGGER -> AI_CLASSIFICATION -> CONDITION (category == 'enterprise')
    #                                           ├── [true]  -> MOCK_CRM_CREATE
    #                                           └── [false] -> SLACK_NOTIFICATION
    await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}",
        headers=headers,
        json={
            "steps": [
                {
                    "step_key": "trigger",
                    "step_type": "MANUAL_TRIGGER",
                    "name": "Trigger",
                    "config": {},
                },
                {
                    "step_key": "ai_classify",
                    "step_type": "AI_CLASSIFICATION",
                    "name": "AI Lead Classifier",
                    "config": {
                        "categories": ["enterprise", "sales", "support", "billing", "urgent"],
                    },
                },
                {
                    "step_key": "check_category",
                    "step_type": "CONDITION",
                    "name": "Is Enterprise Lead",
                    "config": {
                        "field": "category",
                        "operator": "equals",
                        "value": "enterprise",
                    },
                },
                {
                    "step_key": "crm_lead",
                    "step_type": "MOCK_CRM_CREATE",
                    "name": "Create Enterprise CRM Record",
                    "config": {"entity_type": "lead", "mapping": {"email": "email"}},
                },
                {
                    "step_key": "slack_notify",
                    "step_type": "SLACK_NOTIFICATION",
                    "name": "Notify Standard Sales",
                    "config": {"channel": "#sales", "message": "Standard lead received"},
                },
            ],
            "connections": [
                {"source_step_key": "trigger", "target_step_key": "ai_classify"},
                {"source_step_key": "ai_classify", "target_step_key": "check_category"},
                {"source_step_key": "check_category", "target_step_key": "crm_lead", "condition_label": "true"},
                {"source_step_key": "check_category", "target_step_key": "slack_notify", "condition_label": "false"},
            ],
        },
    )

    # 3. Publish Version
    pub_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/publish",
        headers=headers,
    )
    assert pub_res.status_code == 200

    # 4. Trigger Execution with Enterprise Text
    exec_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/runs",
        headers=headers,
        json={
            "trigger_payload": {
                "email": "cto@globalenterprise.com",
                "message": "We are a global enterprise looking for dedicated SLA and SOC2 compliance.",
            }
        },
    )
    assert exec_res.status_code == 201
    run_data = exec_res.json()
    assert run_data["status"] == "COMPLETED"

    # 5. Verify Step Runs
    step_runs = {sr["step_key"]: sr for sr in run_data["step_runs"]}

    # Verify AI step output structure and validation
    ai_run = step_runs["ai_classify"]
    assert ai_run["status"] == "COMPLETED"
    ai_out = ai_run["output_data"]
    assert ai_out["category"] == "enterprise"
    assert ai_out["priority"] == "high"
    assert 0.0 <= ai_out["confidence"] <= 1.0
    assert ai_out["confidence"] == 0.95
    assert "enterprise" in ai_out["reasoning"]
    assert ai_out["tokens_used"] > 0
    assert ai_out["is_fallback"] is False
    assert ai_out["fallback_reason"] is None

    # Verify Downstream CONDITION evaluated the AI output
    cond_run = step_runs["check_category"]
    assert cond_run["status"] == "COMPLETED"
    assert cond_run["output_data"]["selected_branch"] == "true"
    assert cond_run["output_data"]["evaluation_result"] is True

    # Branch true: CRM step was executed
    crm_run = step_runs["crm_lead"]
    assert crm_run["status"] == "COMPLETED"
    assert crm_run["output_data"]["status"] == "created"

    # Branch false: Slack step was SKIPPED
    slack_run = step_runs["slack_notify"]
    assert slack_run["status"] == "SKIPPED"

    # 6. Verify Token Accounting in Database
    test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
    test_session_maker = async_sessionmaker(
        bind=test_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    async with test_session_maker() as session:
        stmt = select(UsageRecord).where(
            UsageRecord.organization_id == uuid.UUID(org_id),
            UsageRecord.metric_type == "ai_tokens",
        )
        records = (await session.execute(stmt)).scalars().all()
        assert len(records) >= 1
        assert records[0].quantity > 0
        assert str(records[0].workflow_id) == wf_id
    await test_engine.dispose()


# ==============================================================================
# 2. Deterministic Fallback During Workflow Execution
# ==============================================================================

@pytest.mark.asyncio
async def test_ai_workflow_fallback_continues_execution(async_client: AsyncClient):
    org_id, headers = await create_org_and_owner(async_client, "ai_fallback")

    # Workflow with explicit OpenAI provider configured (which has no API key in test env)
    wf = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows",
            headers=headers,
            json={"name": "Fallback Resilience Workflow"},
        )
    ).json()
    wf_id = wf["id"]
    v1_id = (
        await async_client.get(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions",
            headers=headers,
        )
    ).json()[0]["id"]

    await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}",
        headers=headers,
        json={
            "steps": [
                {
                    "step_key": "trigger",
                    "step_type": "MANUAL_TRIGGER",
                    "name": "Start",
                    "config": {},
                },
                {
                    "step_key": "ai_triage",
                    "step_type": "AI_CLASSIFICATION",
                    "name": "AI Classifier",
                    "config": {
                        "provider": "openai",  # Unconfigured provider triggers fallback
                        "categories": ["urgent", "billing", "general"],
                    },
                },
            ],
            "connections": [
                {"source_step_key": "trigger", "target_step_key": "ai_triage"},
            ],
        },
    )

    await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/publish",
        headers=headers,
    )

    # Execute workflow with urgent text
    exec_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/runs",
        headers=headers,
        json={
            "trigger_payload": {
                "message": "URGENT payment failure and critical service disruption",
            }
        },
    )
    assert exec_res.status_code == 201
    run_data = exec_res.json()
    assert run_data["status"] == "COMPLETED"

    ai_run = next(s for s in run_data["step_runs"] if s["step_key"] == "ai_triage")
    assert ai_run["status"] == "COMPLETED"
    ai_out = ai_run["output_data"]

    # Fallback engaged successfully and classified deterministically
    assert ai_out["is_fallback"] is True
    assert ai_out["fallback_reason"] in ["missing_configuration", "provider_unavailable"]
    assert ai_out["category"] in ["urgent", "billing"]
    assert ai_out["provider"] == "fallback"
    assert ai_out["tokens_used"] == 0


# ==============================================================================
# 3. Provider + Fallback Double Failure Produces Workflow Step Failure
# ==============================================================================

@pytest.mark.asyncio
async def test_ai_workflow_both_fail_produces_failed_step(async_client: AsyncClient):
    org_id, headers = await create_org_and_owner(async_client, "ai_double_fail")

    wf = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows",
            headers=headers,
            json={"name": "Failing Workflow"},
        )
    ).json()
    wf_id = wf["id"]
    v1_id = (
        await async_client.get(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions",
            headers=headers,
        )
    ).json()[0]["id"]

    await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}",
        headers=headers,
        json={
            "steps": [
                {
                    "step_key": "trigger",
                    "step_type": "MANUAL_TRIGGER",
                    "name": "Start",
                    "config": {},
                },
                {
                    "step_key": "ai_triage",
                    "step_type": "AI_CLASSIFICATION",
                    "name": "AI Classifier",
                    "config": {
                        "categories": ["sales", "support"],
                    },
                },
            ],
            "connections": [
                {"source_step_key": "trigger", "target_step_key": "ai_triage"},
            ],
        },
    )

    await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/publish",
        headers=headers,
    )

    # Empty payload with no text/message: both input extraction and classification fail
    exec_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/runs",
        headers=headers,
        json={"trigger_payload": {}},
    )
    assert exec_res.status_code == 201
    run_data = exec_res.json()

    # Step and WorkflowRun both fail according to Phase 7 semantics
    assert run_data["status"] == "FAILED"
    ai_run = next(s for s in run_data["step_runs"] if s["step_key"] == "ai_triage")
    assert ai_run["status"] == "FAILED"
    assert "AI classification failed" in ai_run["error_message"]


# ==============================================================================
# 4. Multi-Tenant Isolation & RBAC
# ==============================================================================

@pytest.mark.asyncio
async def test_ai_workflow_tenant_isolation_and_rbac(async_client: AsyncClient):
    # Org A
    org_a_id, headers_a = await create_org_and_owner(async_client, "tenant_a")
    # Org B
    org_b_id, headers_b = await create_org_and_owner(async_client, "tenant_b")

    wf = (
        await async_client.post(
            f"/api/v1/organizations/{org_a_id}/workflows",
            headers=headers_a,
            json={"name": "Org A AI Workflow"},
        )
    ).json()
    wf_id = wf["id"]

    # 1. Tenant B tries to execute Org A's workflow -> 404 (OWASP tenant enumeration prevention)
    foreign_exec = await async_client.post(
        f"/api/v1/organizations/{org_b_id}/workflows/{wf_id}/runs",
        headers=headers_b,
        json={"trigger_payload": {"message": "Hello from tenant B"}},
    )
    assert foreign_exec.status_code == 404

    # Direct access across tenant boundary with Org A in URL but Tenant B token -> 404 (anti-enumeration)
    cross_access = await async_client.post(
        f"/api/v1/organizations/{org_a_id}/workflows/{wf_id}/runs",
        headers=headers_b,
        json={"trigger_payload": {"message": "Cross tenant probe"}},
    )
    assert cross_access.status_code == 404

    # 2. RBAC Enforcement: Invite a VIEWER into Org A
    viewer_email, viewer_pass, _ = await create_authenticated_user(async_client, "viewer_user")
    # Owner invites viewer
    invite_res = await async_client.post(
        f"/api/v1/organizations/{org_a_id}/members",
        headers=headers_a,
        json={"email": viewer_email, "role": "VIEWER"},
    )
    assert invite_res.status_code in [200, 201]

    # Login as VIEWER
    viewer_login = await async_client.post(
        "/api/v1/auth/login",
        json={"email": viewer_email, "password": viewer_pass, "organization_id": org_a_id},
    )
    viewer_token = viewer_login.json()["access_token"]
    viewer_headers = {"Authorization": f"Bearer {viewer_token}"}

    # VIEWER attempts to execute workflow run -> 403 Forbidden
    viewer_exec = await async_client.post(
        f"/api/v1/organizations/{org_a_id}/workflows/{wf_id}/runs",
        headers=viewer_headers,
        json={"trigger_payload": {"message": "Viewer cannot run workflows"}},
    )
    assert viewer_exec.status_code == 403
