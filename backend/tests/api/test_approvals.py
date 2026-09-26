import uuid
import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings
from app.models.approval import ApprovalRequest
from app.models.audit_log import AuditLog
from app.models.workflow_run import WorkflowRun, WorkflowStepRun


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
    return org_id, {"Authorization": f"Bearer {org_token}"}, (email, password)


async def setup_hitl_workflow(async_client: AsyncClient, org_id: str, headers: dict, approver_role: str = "MANAGER"):
    wf_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows",
        headers=headers,
        json={"name": "Approval Governance Pipeline"},
    )
    assert wf_res.status_code == 201
    wf_id = wf_res.json()["id"]

    v_res = await async_client.get(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions",
        headers=headers,
    )
    assert v_res.status_code == 200
    v1_id = v_res.json()[0]["id"]

    # Trigger -> Approval -> (approved -> CRM, rejected -> Slack)
    put_res = await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}",
        headers=headers,
        json={
            "steps": [
                {
                    "step_key": "trigger",
                    "step_type": "MANUAL_TRIGGER",
                    "name": "Manual Start",
                    "config": {},
                },
                {
                    "step_key": "deal_review",
                    "step_type": "HUMAN_APPROVAL",
                    "name": "Manager Deal Approval",
                    "config": {"approver_role": approver_role, "timeout_hours": 24},
                },
                {
                    "step_key": "create_crm_deal",
                    "step_type": "MOCK_CRM_CREATE",
                    "name": "Create CRM Deal",
                    "config": {"entity_type": "deal"},
                },
                {
                    "step_key": "notify_rejection",
                    "step_type": "SLACK_NOTIFICATION",
                    "name": "Notify Rejection Slack",
                    "config": {"channel": "#rejected-deals"},
                },
            ],
            "connections": [
                {"source_step_key": "trigger", "target_step_key": "deal_review"},
                {
                    "source_step_key": "deal_review",
                    "target_step_key": "create_crm_deal",
                    "condition_label": "approved",
                },
                {
                    "source_step_key": "deal_review",
                    "target_step_key": "notify_rejection",
                    "condition_label": "rejected",
                },
            ],
        },
    )
    assert put_res.status_code == 200

    pub_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/publish",
        headers=headers,
    )
    assert pub_res.status_code == 200
    return wf_id


@pytest.mark.asyncio
async def test_list_and_get_approval_details(async_client: AsyncClient):
    org_id, headers, _ = await create_org_and_owner(async_client, "list_appr")
    wf_id = await setup_hitl_workflow(async_client, org_id, headers)

    # 1. Start execution -> Pauses at approval
    run_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/runs",
        headers=headers,
        json={"trigger_payload": {"amount": 50000}},
    )
    assert run_res.status_code == 201
    run_data = run_res.json()
    print("RUN_DATA_DEBUG:", [(s["step_key"], s["status"], s.get("output_data")) for s in run_data.get("step_runs", [])]); assert run_data["status"] == "PAUSED"

    # 2. List approvals (default status=PENDING)
    list_res = await async_client.get(
        f"/api/v1/organizations/{org_id}/approvals",
        headers=headers,
    )
    assert list_res.status_code == 200
    data = list_res.json()
    assert data["total"] >= 1
    item = data["items"][0]
    assert item["status"] == "PENDING"
    assert item["step_key"] == "deal_review"
    assert item["approver_role"] == "MANAGER"
    assert item["time_remaining_seconds"] is not None
    assert item["time_remaining_seconds"] > 0
    approval_id = item["id"]

    # 3. Get single approval detail
    detail_res = await async_client.get(
        f"/api/v1/organizations/{org_id}/approvals/{approval_id}",
        headers=headers,
    )
    assert detail_res.status_code == 200
    detail = detail_res.json()
    assert detail["id"] == approval_id
    assert detail["workflow_run_id"] == run_data["id"]
    assert detail["status"] == "PENDING"


@pytest.mark.asyncio
async def test_rbac_approvals_enforcement(async_client: AsyncClient):
    """
    Verifies strict server-side RBAC:
    - VIEWER is always forbidden (403)
    - OPERATOR is forbidden when required_role is MANAGER (403)
    - MANAGER and OWNER succeed (200)
    """
    org_id, owner_headers, _ = await create_org_and_owner(async_client, "rbac_appr")
    wf_id = await setup_hitl_workflow(async_client, org_id, owner_headers, approver_role="MANAGER")

    # Add Viewer and Operator
    viewer_email, viewer_pass, _ = await create_authenticated_user(async_client, "appr_viewer")
    await async_client.post(
        f"/api/v1/organizations/{org_id}/members",
        headers=owner_headers,
        json={"email": viewer_email, "role": "VIEWER"},
    )
    v_login = await async_client.post(
        "/api/v1/auth/login",
        json={"email": viewer_email, "password": viewer_pass, "organization_id": org_id},
    )
    viewer_headers = {"Authorization": f"Bearer {v_login.json()['access_token']}"}

    op_email, op_pass, _ = await create_authenticated_user(async_client, "appr_operator")
    await async_client.post(
        f"/api/v1/organizations/{org_id}/members",
        headers=owner_headers,
        json={"email": op_email, "role": "OPERATOR"},
    )
    op_login = await async_client.post(
        "/api/v1/auth/login",
        json={"email": op_email, "password": op_pass, "organization_id": org_id},
    )
    op_headers = {"Authorization": f"Bearer {op_login.json()['access_token']}"}

    mgr_email, mgr_pass, _ = await create_authenticated_user(async_client, "appr_manager")
    await async_client.post(
        f"/api/v1/organizations/{org_id}/members",
        headers=owner_headers,
        json={"email": mgr_email, "role": "MANAGER"},
    )
    mgr_login = await async_client.post(
        "/api/v1/auth/login",
        json={"email": mgr_email, "password": mgr_pass, "organization_id": org_id},
    )
    mgr_headers = {"Authorization": f"Bearer {mgr_login.json()['access_token']}"}

    # Start run to create approval
    run_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/runs",
        headers=owner_headers,
        json={"trigger_payload": {}},
    )
    run_id = run_res.json()["id"]

    list_res = await async_client.get(
        f"/api/v1/organizations/{org_id}/approvals",
        headers=owner_headers,
    )
    approval_id = list_res.json()["items"][0]["id"]

    # 1. Viewer can read approval
    vr = await async_client.get(
        f"/api/v1/organizations/{org_id}/approvals/{approval_id}",
        headers=viewer_headers,
    )
    assert vr.status_code == 200

    # 2. Viewer cannot approve or reject (403)
    va = await async_client.post(
        f"/api/v1/organizations/{org_id}/approvals/{approval_id}/approve",
        headers=viewer_headers,
        json={"comment": "Viewer trying to approve"},
    )
    assert va.status_code == 403

    # 3. Operator cannot approve when required_role is MANAGER (403)
    oa = await async_client.post(
        f"/api/v1/organizations/{org_id}/approvals/{approval_id}/approve",
        headers=op_headers,
        json={"comment": "Operator trying to approve"},
    )
    assert oa.status_code == 403

    # 4. Manager can approve (200)
    ma = await async_client.post(
        f"/api/v1/organizations/{org_id}/approvals/{approval_id}/approve",
        headers=mgr_headers,
        json={"comment": "Manager approved"},
    )
    assert ma.status_code == 200
    assert ma.json()["status"] == "APPROVED"


@pytest.mark.asyncio
async def test_tenant_isolation_approvals(async_client: AsyncClient):
    """
    Proves Tenant B cannot see or resolve Tenant A's approval requests (returns 404).
    """
    org_a, headers_a, _ = await create_org_and_owner(async_client, "tenant_a_appr")
    org_b, headers_b, _ = await create_org_and_owner(async_client, "tenant_b_appr")

    wf_id = await setup_hitl_workflow(async_client, org_a, headers_a)

    await async_client.post(
        f"/api/v1/organizations/{org_a}/workflows/{wf_id}/runs",
        headers=headers_a,
        json={"trigger_payload": {}},
    )
    list_a = await async_client.get(
        f"/api/v1/organizations/{org_a}/approvals",
        headers=headers_a,
    )
    approval_a_id = list_a.json()["items"][0]["id"]

    # Tenant B tries to inspect Tenant A's approval
    res1 = await async_client.get(
        f"/api/v1/organizations/{org_b}/approvals/{approval_a_id}",
        headers=headers_b,
    )
    assert res1.status_code == 404

    # Tenant B tries to approve Tenant A's approval
    res2 = await async_client.post(
        f"/api/v1/organizations/{org_b}/approvals/{approval_a_id}/approve",
        headers=headers_b,
        json={"comment": "Cross-tenant attack"},
    )
    assert res2.status_code == 404

    # Tenant B lists approvals -> must be empty
    res3 = await async_client.get(
        f"/api/v1/organizations/{org_b}/approvals",
        headers=headers_b,
    )
    assert res3.status_code == 200
    assert res3.json()["total"] == 0


@pytest.mark.asyncio
async def test_approval_branching_approved_and_rejected(async_client: AsyncClient):
    """
    Test branching:
    - Run 1 (Approve): CRM executes, Slack skipped, Run status COMPLETED.
    - Run 2 (Reject): Slack executes, CRM skipped, Run status COMPLETED (non-fatal).
    """
    org_id, headers, _ = await create_org_and_owner(async_client, "branch_appr")
    wf_id = await setup_hitl_workflow(async_client, org_id, headers)

    # ------------------ Run 1: Approve ------------------
    run1 = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/runs",
            headers=headers,
            json={"trigger_payload": {"run": 1}},
        )
    ).json()
    run1_id = run1["id"]

    list1 = (await async_client.get(f"/api/v1/organizations/{org_id}/approvals", headers=headers)).json()
    appr1_id = list1["items"][0]["id"]

    app1_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/approvals/{appr1_id}/approve",
        headers=headers,
        json={"comment": "Approving Deal 1"},
    )
    assert app1_res.status_code == 200

    detail1 = (await async_client.get(f"/api/v1/organizations/{org_id}/runs/{run1_id}", headers=headers)).json()
    assert detail1["status"] == "COMPLETED"
    steps1 = {s["step_key"]: s["status"] for s in detail1["step_runs"]}
    assert steps1["trigger"] == "COMPLETED"
    assert steps1["deal_review"] == "COMPLETED"
    assert steps1["create_crm_deal"] == "COMPLETED"
    assert steps1.get("notify_rejection") == "SKIPPED"

    # ------------------ Run 2: Reject ------------------
    run2 = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/runs",
            headers=headers,
            json={"trigger_payload": {"run": 2}},
        )
    ).json()
    run2_id = run2["id"]

    list2 = (await async_client.get(f"/api/v1/organizations/{org_id}/approvals", headers=headers)).json()
    # Find pending approval for run2
    appr2_id = [a["id"] for a in list2["items"] if a["workflow_run_id"] == run2_id][0]

    rej2_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/approvals/{appr2_id}/reject",
        headers=headers,
        json={"comment": "Rejecting Deal 2"},
    )
    assert rej2_res.status_code == 200
    assert rej2_res.json()["status"] == "REJECTED"

    detail2 = (await async_client.get(f"/api/v1/organizations/{org_id}/runs/{run2_id}", headers=headers)).json()
    # Non-fatal rejection guarantee: Run status is COMPLETED
    assert detail2["status"] == "COMPLETED"
    steps2 = {s["step_key"]: s["status"] for s in detail2["step_runs"]}
    assert steps2["trigger"] == "COMPLETED"
    assert steps2["deal_review"] == "COMPLETED"
    assert steps2["notify_rejection"] == "COMPLETED"
    assert steps2.get("create_crm_deal") == "SKIPPED"


@pytest.mark.asyncio
async def test_audit_logs_recorded_for_approvals(async_client: AsyncClient):
    """
    Verifies AuditLog records are emitted for approval.requested, approval.approved, approval.rejected.
    """
    org_id, headers, _ = await create_org_and_owner(async_client, "audit_appr")
    wf_id = await setup_hitl_workflow(async_client, org_id, headers)

    # 1. Start run -> approval.requested
    run = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/runs",
            headers=headers,
            json={"trigger_payload": {}},
        )
    ).json()

    list_res = (await async_client.get(f"/api/v1/organizations/{org_id}/approvals", headers=headers)).json()
    appr_id = list_res["items"][0]["id"]

    # 2. Approve -> approval.approved
    await async_client.post(
        f"/api/v1/organizations/{org_id}/approvals/{appr_id}/approve",
        headers=headers,
        json={"comment": "Approved for audit test"},
    )

    # Inspect audit_logs in database
    engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
    async with AsyncSession(engine) as session:
        stmt = select(AuditLog).where(
            AuditLog.organization_id == uuid.UUID(org_id),
            AuditLog.resource_type == "approval_request",
        )
        logs = (await session.execute(stmt)).scalars().all()
        actions = [l.action for l in logs]
        assert "approval.requested" in actions
        assert "approval.approved" in actions
    await engine.dispose()


@pytest.mark.asyncio
async def test_end_to_end_ai_condition_approval_pipeline(async_client: AsyncClient):
    """
    Full end-to-end pipeline:
    MANUAL_TRIGGER -> AI_CLASSIFICATION -> CONDITION (category == 'ENTERPRISE')
    -> HUMAN_APPROVAL -> (APPROVED -> CRM, REJECTED -> SLACK)
    """
    org_id, headers, _ = await create_org_and_owner(async_client, "e2e_hitl")

    wf = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows",
            headers=headers,
            json={"name": "AI Lead Qualification to Human Approval"},
        )
    ).json()
    wf_id = wf["id"]
    v1_id = (
        await async_client.get(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions",
            headers=headers,
        )
    ).json()[0]["id"]

    put_res = await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}",
        headers=headers,
        json={
            "steps": [
                {
                    "step_key": "lead_in",
                    "step_type": "MANUAL_TRIGGER",
                    "name": "New Inbound Lead",
                    "config": {},
                },
                {
                    "step_key": "ai_classifier",
                    "step_type": "AI_CLASSIFICATION",
                    "name": "AI Lead Classifier",
                    "config": {
                        "prompt": "Classify inbound lead",
                        "categories": ["ENTERPRISE", "MID_MARKET", "SMB"],
                        "allowed_categories": ["ENTERPRISE", "MID_MARKET", "SMB"],
                        "confidence_threshold": 0.5,
                        "mock_response": {
                            "category": "ENTERPRISE",
                            "confidence": 0.95,
                            "explanation": "High employee count and enterprise budget",
                            "suggested_action": "route_to_sales",
                        },
                    },
                },
                {
                    "step_key": "check_enterprise",
                    "step_type": "CONDITION",
                    "name": "Is Enterprise?",
                    "config": {
                        "field": "ai_classifier.category",
                        "operator": "equals",
                        "value": "enterprise",
                    },
                },
                {
                    "step_key": "human_gate",
                    "step_type": "HUMAN_APPROVAL",
                    "name": "Executive Approval",
                    "config": {"approver_role": "OWNER", "title": "Enterprise Review"},
                },
                {
                    "step_key": "crm_sync",
                    "step_type": "MOCK_CRM_CREATE",
                    "name": "Sync to Salesforce",
                    "config": {"entity_type": "contact"},
                },
            ],
            "connections": [
                {"source_step_key": "lead_in", "target_step_key": "ai_classifier"},
                {"source_step_key": "ai_classifier", "target_step_key": "check_enterprise"},
                {
                    "source_step_key": "check_enterprise",
                    "target_step_key": "human_gate",
                    "condition_label": "true",
                },
                {
                    "source_step_key": "human_gate",
                    "target_step_key": "crm_sync",
                    "condition_label": "approved",
                },
            ],
        },
    )
    assert put_res.status_code == 200

    await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/publish",
        headers=headers,
    )

    # 1. Trigger lead execution
    run_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/runs",
        headers=headers,
        json={
            "trigger_payload": {
                "company": "Acme Corp",
                "employees": 5000,
                "domain": "acme.com",
            }
        },
    )
    assert run_res.status_code == 201
    run_data = run_res.json()
    assert run_data["status"] == "PAUSED"

    step_status = {s["step_key"]: s["status"] for s in run_data["step_runs"]}
    assert step_status["lead_in"] == "COMPLETED"
    assert step_status["ai_classifier"] == "COMPLETED"
    assert step_status["check_enterprise"] == "COMPLETED"
    assert step_status["human_gate"] == "PAUSED"
    assert "crm_sync" not in step_status

    # 2. Review and approve
    list_res = await async_client.get(
        f"/api/v1/organizations/{org_id}/approvals",
        headers=headers,
    )
    appr_id = list_res.json()["items"][0]["id"]

    approve_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/approvals/{appr_id}/approve",
        headers=headers,
        json={"comment": "Approved VIP enterprise account"},
    )
    assert approve_res.status_code == 200
    assert approve_res.json()["status"] == "APPROVED"

    # 3. Final verification: CRM sync ran and run is COMPLETED
    final_detail = (
        await async_client.get(
            f"/api/v1/organizations/{org_id}/runs/{run_data['id']}",
            headers=headers,
        )
    ).json()
    assert final_detail["status"] == "COMPLETED"
    final_steps = {s["step_key"]: s["status"] for s in final_detail["step_runs"]}
    assert final_steps["crm_sync"] == "COMPLETED"