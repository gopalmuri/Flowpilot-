import asyncio
import uuid
import pytest
from httpx import AsyncClient


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


@pytest.mark.asyncio
async def test_execute_published_workflow_success(async_client: AsyncClient):
    org_id, headers = await create_org_and_owner(async_client, "exec_success")

    # 1. Create Workflow
    wf = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows",
            headers=headers,
            json={"name": "End-to-End Pipeline"},
        )
    ).json()
    wf_id = wf["id"]
    v1_id = (
        await async_client.get(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions",
            headers=headers,
        )
    ).json()[0]["id"]

    # 2. Configure multi-step DAG:
    # Trigger -> ValidateData -> AIClassification -> MockCRM -> MockSlack
    await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}",
        headers=headers,
        json={
            "steps": [
                {
                    "step_key": "start",
                    "step_type": "MANUAL_TRIGGER",
                    "name": "Start",
                    "config": {},
                },
                {
                    "step_key": "val_lead",
                    "step_type": "VALIDATE_DATA",
                    "name": "Validate Lead",
                    "config": {"required_fields": ["email", "lead_source"]},
                },
                {
                    "step_key": "ai_triage",
                    "step_type": "AI_CLASSIFICATION",
                    "name": "AI Triage",
                    "config": {"categories": ["urgent", "standard", "low"]},
                },
                {
                    "step_key": "create_crm",
                    "step_type": "MOCK_CRM_CREATE",
                    "name": "Create Lead in CRM",
                    "config": {"entity_type": "lead", "mapping": {"lead_email": "email"}},
                },
                {
                    "step_key": "notify_slack",
                    "step_type": "SLACK_NOTIFICATION",
                    "name": "Slack Alert",
                    "config": {"channel": "#sales-alerts", "message": "New lead processed"},
                },
            ],
            "connections": [
                {"source_step_key": "start", "target_step_key": "val_lead"},
                {"source_step_key": "val_lead", "target_step_key": "ai_triage"},
                {"source_step_key": "ai_triage", "target_step_key": "create_crm"},
                {"source_step_key": "create_crm", "target_step_key": "notify_slack"},
            ],
        },
    )

    # 3. Publish Version (sets workflow ACTIVE)
    pub_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/publish",
        headers=headers,
    )
    assert pub_res.status_code == 200

    # 4. Trigger Execution
    exec_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/runs",
        headers=headers,
        json={
            "trigger_payload": {
                "email": "lead@enterprise.com",
                "lead_source": "website",
                "message": "We have an urgent issue and need enterprise pricing",
            }
        },
    )
    assert exec_res.status_code == 201
    run_data = exec_res.json()

    assert run_data["status"] == "COMPLETED"
    assert run_data["completed_at"] is not None
    assert len(run_data["step_runs"]) == 5

    # Check all step statuses
    for sr in run_data["step_runs"]:
        assert sr["status"] == "COMPLETED"
        assert sr["completed_at"] is not None

    # Verify AI classification output in step runs
    ai_step = next(s for s in run_data["step_runs"] if s["step_key"] == "ai_triage")
    assert ai_step["output_data"]["category"] == "urgent"
    assert ai_step["output_data"]["confidence"] == 0.95

    # Verify CRM creation output
    crm_step = next(s for s in run_data["step_runs"] if s["step_key"] == "create_crm")
    assert "crm_id" in crm_step["output_data"]
    assert crm_step["output_data"]["status"] == "created"


@pytest.mark.asyncio
async def test_cannot_execute_draft_or_paused_workflow(async_client: AsyncClient):
    org_id, headers = await create_org_and_owner(async_client, "draft_exec")

    # Workflow is in DRAFT status by default
    wf = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows",
            headers=headers,
            json={"name": "Draft Workflow"},
        )
    ).json()

    # Attempt execution -> 400
    res = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf['id']}/runs",
        headers=headers,
        json={"trigger_payload": {}},
    )
    assert res.status_code == 400
    assert "active" in res.json()["detail"].lower()


@pytest.mark.asyncio
async def test_execution_failure_records_failed_step(async_client: AsyncClient):
    org_id, headers = await create_org_and_owner(async_client, "fail_flow")

    wf = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows",
            headers=headers,
            json={"name": "Failing Validation Flow"},
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
                    "step_key": "start",
                    "step_type": "MANUAL_TRIGGER",
                    "name": "Start",
                    "config": {},
                },
                {
                    "step_key": "val_node",
                    "step_type": "VALIDATE_DATA",
                    "name": "Validate Lead",
                    "config": {"required_fields": ["mandatory_token"]},
                },
                {
                    "step_key": "downstream_slack",
                    "step_type": "SLACK_NOTIFICATION",
                    "name": "Should Not Execute",
                    "config": {"channel": "#alerts"},
                },
            ],
            "connections": [
                {"source_step_key": "start", "target_step_key": "val_node"},
                {"source_step_key": "val_node", "target_step_key": "downstream_slack"},
            ],
        },
    )

    await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/publish",
        headers=headers,
    )

    # Trigger with missing required field
    exec_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/runs",
        headers=headers,
        json={"trigger_payload": {"other_field": 123}},
    )
    assert exec_res.status_code == 201
    run_data = exec_res.json()

    assert run_data["status"] == "FAILED"
    assert "missing required fields" in run_data["error_message"].lower()

    # Step run 1 (Start) is COMPLETED; Step run 2 (val_node) is FAILED; Downstream was not started
    step_runs = run_data["step_runs"]
    assert len(step_runs) == 2
    assert step_runs[0]["status"] == "COMPLETED"
    assert step_runs[1]["status"] == "FAILED"


@pytest.mark.asyncio
async def test_conditional_branching_and_convergence(async_client: AsyncClient):
    org_id, headers = await create_org_and_owner(async_client, "branch_conv")

    wf = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows",
            headers=headers,
            json={"name": "Branch and Merge Flow"},
        )
    ).json()
    wf_id = wf["id"]
    v1_id = (
        await async_client.get(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions",
            headers=headers,
        )
    ).json()[0]["id"]

    # Start -> Condition (amount > 1000)
    #   if true -> Branch_A (CRM Lead)
    #   if false -> Branch_B (Slack notification)
    # Both converge -> Final_Log (Slack notification)
    await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}",
        headers=headers,
        json={
            "steps": [
                {
                    "step_key": "start",
                    "step_type": "MANUAL_TRIGGER",
                    "name": "Start",
                    "config": {},
                },
                {
                    "step_key": "check_amount",
                    "step_type": "CONDITION",
                    "name": "Check Amount",
                    "config": {"field": "trigger.amount", "operator": "greater_than", "value": 1000},
                },
                {
                    "step_key": "vip_crm",
                    "step_type": "MOCK_CRM_CREATE",
                    "name": "VIP CRM Entry",
                    "config": {"entity_type": "vip_deal"},
                },
                {
                    "step_key": "standard_alert",
                    "step_type": "SLACK_NOTIFICATION",
                    "name": "Standard Slack Alert",
                    "config": {"channel": "#standard-leads"},
                },
                {
                    "step_key": "converged_step",
                    "step_type": "SLACK_NOTIFICATION",
                    "name": "Converged Final Notification",
                    "config": {"channel": "#summary"},
                },
            ],
            "connections": [
                {"source_step_key": "start", "target_step_key": "check_amount"},
                {"source_step_key": "check_amount", "target_step_key": "vip_crm", "condition_label": "true"},
                {"source_step_key": "check_amount", "target_step_key": "standard_alert", "condition_label": "false"},
                {"source_step_key": "vip_crm", "target_step_key": "converged_step"},
                {"source_step_key": "standard_alert", "target_step_key": "converged_step"},
            ],
        },
    )

    await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/publish",
        headers=headers,
    )

    # 1. Test True Branch (amount = 2500)
    res_true = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/runs",
        headers=headers,
        json={"trigger_payload": {"amount": 2500}},
    )
    run_true = res_true.json()
    assert run_true["status"] == "COMPLETED"
    step_dict = {s["step_key"]: s["status"] for s in run_true["step_runs"]}
    assert step_dict["vip_crm"] == "COMPLETED"
    assert step_dict["standard_alert"] == "SKIPPED"
    assert step_dict["converged_step"] == "COMPLETED"  # OR-convergence executed!

    # 2. Test False Branch (amount = 500)
    res_false = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/runs",
        headers=headers,
        json={"trigger_payload": {"amount": 500}},
    )
    run_false = res_false.json()
    assert run_false["status"] == "COMPLETED"
    step_dict_false = {s["step_key"]: s["status"] for s in run_false["step_runs"]}
    assert step_dict_false["vip_crm"] == "SKIPPED"
    assert step_dict_false["standard_alert"] == "COMPLETED"
    assert step_dict_false["converged_step"] == "COMPLETED"  # OR-convergence executed!


@pytest.mark.asyncio
async def test_human_approval_pause_and_resume_lifecycle(async_client: AsyncClient):
    org_id, headers = await create_org_and_owner(async_client, "approval_flow")

    wf = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows",
            headers=headers,
            json={"name": "Human Governance Flow"},
        )
    ).json()
    wf_id = wf["id"]
    v1_id = (
        await async_client.get(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions",
            headers=headers,
        )
    ).json()[0]["id"]

    # Start -> Approval -> Final Notification
    await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}",
        headers=headers,
        json={
            "steps": [
                {
                    "step_key": "start",
                    "step_type": "MANUAL_TRIGGER",
                    "name": "Start",
                    "config": {},
                },
                {
                    "step_key": "require_manager",
                    "step_type": "HUMAN_APPROVAL",
                    "name": "Manager Review",
                    "config": {"approver_role": "MANAGER", "title": "Contract Approval"},
                },
                {
                    "step_key": "post_approval_alert",
                    "step_type": "SLACK_NOTIFICATION",
                    "name": "Notify Deal Approved",
                    "config": {"channel": "#deals"},
                },
            ],
            "connections": [
                {"source_step_key": "start", "target_step_key": "require_manager"},
                {"source_step_key": "require_manager", "target_step_key": "post_approval_alert"},
            ],
        },
    )

    await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/publish",
        headers=headers,
    )

    # 1. Trigger execution -> Pauses at approval
    init_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/runs",
        headers=headers,
        json={"trigger_payload": {"deal_size": 100000}},
    )
    assert init_res.status_code == 201
    run_paused = init_res.json()
    run_id = run_paused["id"]

    assert run_paused["status"] == "PAUSED"
    step_dict = {s["step_key"]: s["status"] for s in run_paused["step_runs"]}
    assert step_dict["start"] == "COMPLETED"
    assert step_dict["require_manager"] == "PAUSED"
    assert "post_approval_alert" not in step_dict  # Has not executed yet!

    # 2. Resume with Approval (approved = True)
    resume_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/runs/{run_id}/resume",
        headers=headers,
        json={"approved": True, "comment": "Deal looks great, approved!"},
    )
    assert resume_res.status_code == 200
    run_resumed = resume_res.json()
    assert run_resumed["status"] == "COMPLETED"

    # Step dictionary after resume
    resumed_steps = {s["step_key"]: s["status"] for s in run_resumed["step_runs"]}
    assert resumed_steps["start"] == "COMPLETED"
    assert resumed_steps["require_manager"] == "COMPLETED"
    assert resumed_steps["post_approval_alert"] == "COMPLETED"

    # 3. Duplicate Resume Idempotency (calling resume again returns current state with 200)
    dup_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/runs/{run_id}/resume",
        headers=headers,
        json={"approved": True},
    )
    assert dup_res.status_code == 200


@pytest.mark.asyncio
async def test_human_approval_rejection_and_conflict_handling(async_client: AsyncClient):
    org_id, headers = await create_org_and_owner(async_client, "reject_flow")

    wf = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows",
            headers=headers,
            json={"name": "Rejection Flow"},
        )
    ).json()
    wf_id = wf["id"]
    v1_id = (
        await async_client.get(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions",
            headers=headers,
        )
    ).json()[0]["id"]

    # DAG: start -> approval_step -> post_approval_step
    await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}",
        headers=headers,
        json={
            "steps": [
                {
                    "step_key": "start",
                    "step_type": "MANUAL_TRIGGER",
                    "name": "Start",
                    "config": {},
                },
                {
                    "step_key": "approval_step",
                    "step_type": "HUMAN_APPROVAL",
                    "name": "Approval",
                    "config": {"approver_role": "MANAGER"},
                },
                {
                    "step_key": "post_approval_step",
                    "step_type": "SLACK_NOTIFICATION",
                    "name": "Post Approval Alert",
                    "config": {"channel": "#approved-ops"},
                },
            ],
            "connections": [
                {"source_step_key": "start", "target_step_key": "approval_step"},
                {"source_step_key": "approval_step", "target_step_key": "post_approval_step"},
            ],
        },
    )

    await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/publish",
        headers=headers,
    )

    run = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/runs",
            headers=headers,
            json={"trigger_payload": {}},
        )
    ).json()
    run_id = run["id"]
    assert run["status"] == "PAUSED"

    # 1. Reject run with persistent comment (Phase 10: rejection branches to 'rejected', non-fatal)
    rejection_comment = "Budget exceeded for Q3 capital allocation"
    reject_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/runs/{run_id}/resume",
        headers=headers,
        json={"approved": False, "comment": rejection_comment},
    )
    assert reject_res.status_code == 200
    reject_data = reject_res.json()
    # In Phase 10, rejection is non-fatal: run completes normally, downstream unlabelled step is skipped
    assert reject_data["status"] == "COMPLETED"
    step_dict = {s["step_key"]: s["status"] for s in reject_data["step_runs"]}
    assert step_dict["approval_step"] == "COMPLETED"
    assert step_dict.get("post_approval_step") == "SKIPPED"

    # 2. Check run details endpoint
    detail_res = await async_client.get(
        f"/api/v1/organizations/{org_id}/runs/{run_id}",
        headers=headers,
    )
    assert detail_res.status_code == 200
    detail_data = detail_res.json()
    assert detail_data["status"] == "COMPLETED"
    detail_steps = {s["step_key"]: s["status"] for s in detail_data["step_runs"]}
    assert detail_steps["approval_step"] == "COMPLETED"
    assert detail_steps.get("post_approval_step") == "SKIPPED"

    # 3. Subsequent resume request with approved=True returns 409 Conflict
    sub_resume = await async_client.post(
        f"/api/v1/organizations/{org_id}/runs/{run_id}/resume",
        headers=headers,
        json={"approved": True, "comment": "Attempting to overwrite rejection"},
    )
    assert sub_resume.status_code == 409
    assert "rejected" in sub_resume.json()["detail"].lower()

    # 4. Subsequent resume request with approved=False returns 200 OK (idempotent repeat)
    sub_reject = await async_client.post(
        f"/api/v1/organizations/{org_id}/runs/{run_id}/resume",
        headers=headers,
        json={"approved": False, "comment": "Trying to reject again"},
    )
    assert sub_reject.status_code == 200
    assert sub_reject.json()["status"] == "COMPLETED"


@pytest.mark.asyncio
async def test_cancellation_lifecycle_and_conflict(async_client: AsyncClient):
    org_id, headers = await create_org_and_owner(async_client, "cancel_flow")

    wf = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows",
            headers=headers,
            json={"name": "Cancel Flow"},
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
                {"step_key": "start", "step_type": "MANUAL_TRIGGER", "name": "Start", "config": {}},
                {"step_key": "approval", "step_type": "HUMAN_APPROVAL", "name": "Review", "config": {"approver_role": "MANAGER"}},
            ],
            "connections": [{"source_step_key": "start", "target_step_key": "approval"}],
        },
    )

    await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/publish",
        headers=headers,
    )

    run = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/runs",
            headers=headers,
            json={"trigger_payload": {}},
        )
    ).json()
    run_id = run["id"]

    # Cancel the paused run
    cancel_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/runs/{run_id}/cancel",
        headers=headers,
    )
    assert cancel_res.status_code == 200
    assert cancel_res.json()["status"] == "CANCELLED"

    # Cancelling again returns 409 Conflict
    re_cancel = await async_client.post(
        f"/api/v1/organizations/{org_id}/runs/{run_id}/cancel",
        headers=headers,
    )
    assert re_cancel.status_code == 409

    # Resuming cancelled run returns 409 Conflict
    res_resume = await async_client.post(
        f"/api/v1/organizations/{org_id}/runs/{run_id}/resume",
        headers=headers,
        json={"approved": True},
    )
    assert res_resume.status_code == 409


@pytest.mark.asyncio
async def test_tenant_isolation_runs_return_404(async_client: AsyncClient):
    org_a_id, headers_a = await create_org_and_owner(async_client, "tenant_a")
    org_b_id, headers_b = await create_org_and_owner(async_client, "tenant_b")

    wf = (
        await async_client.post(
            f"/api/v1/organizations/{org_a_id}/workflows",
            headers=headers_a,
            json={"name": "Org A Workflow"},
        )
    ).json()
    v1_id = (
        await async_client.get(
            f"/api/v1/organizations/{org_a_id}/workflows/{wf['id']}/versions",
            headers=headers_a,
        )
    ).json()[0]["id"]

    await async_client.put(
        f"/api/v1/organizations/{org_a_id}/workflows/{wf['id']}/versions/{v1_id}",
        headers=headers_a,
        json={
            "steps": [{"step_key": "start", "step_type": "MANUAL_TRIGGER", "name": "Start", "config": {}}],
            "connections": [],
        },
    )
    await async_client.post(
        f"/api/v1/organizations/{org_a_id}/workflows/{wf['id']}/versions/{v1_id}/publish",
        headers=headers_a,
    )

    run_a = (
        await async_client.post(
            f"/api/v1/organizations/{org_a_id}/workflows/{wf['id']}/runs",
            headers=headers_a,
            json={"trigger_payload": {}},
        )
    ).json()

    # Org B attempts to access Org A's run -> 404
    cross_get = await async_client.get(
        f"/api/v1/organizations/{org_b_id}/runs/{run_a['id']}",
        headers=headers_b,
    )
    assert cross_get.status_code == 404

    cross_cancel = await async_client.post(
        f"/api/v1/organizations/{org_b_id}/runs/{run_a['id']}/cancel",
        headers=headers_b,
    )
    assert cross_cancel.status_code == 404


@pytest.mark.asyncio
async def test_rbac_execution_permissions(async_client: AsyncClient):
    org_id, owner_headers = await create_org_and_owner(async_client, "rbac_exec")

    # Create Operator and Viewer users
    op_email, op_pwd, _ = await create_authenticated_user(async_client, "op")
    view_email, view_pwd, _ = await create_authenticated_user(async_client, "view")

    await async_client.post(
        f"/api/v1/organizations/{org_id}/members",
        headers=owner_headers,
        json={"email": op_email, "role": "OPERATOR"},
    )
    await async_client.post(
        f"/api/v1/organizations/{org_id}/members",
        headers=owner_headers,
        json={"email": view_email, "role": "VIEWER"},
    )

    op_token = (
        await async_client.post(
            "/api/v1/auth/login",
            json={"email": op_email, "password": op_pwd, "organization_id": org_id},
        )
    ).json()["access_token"]
    op_headers = {"Authorization": f"Bearer {op_token}"}

    view_token = (
        await async_client.post(
            "/api/v1/auth/login",
            json={"email": view_email, "password": view_pwd, "organization_id": org_id},
        )
    ).json()["access_token"]
    view_headers = {"Authorization": f"Bearer {view_token}"}

    # Setup active workflow
    wf = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows",
            headers=owner_headers,
            json={"name": "RBAC Flow"},
        )
    ).json()
    wf_id = wf["id"]
    v1_id = (
        await async_client.get(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions",
            headers=owner_headers,
        )
    ).json()[0]["id"]

    await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}",
        headers=owner_headers,
        json={
            "steps": [
                {"step_key": "start", "step_type": "MANUAL_TRIGGER", "name": "Start", "config": {}},
                {"step_key": "app", "step_type": "HUMAN_APPROVAL", "name": "App", "config": {"approver_role": "MANAGER"}},
            ],
            "connections": [{"source_step_key": "start", "target_step_key": "app"}],
        },
    )
    await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/publish",
        headers=owner_headers,
    )

    # 1. Viewer cannot trigger run -> 403
    view_trigger = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/runs",
        headers=view_headers,
        json={"trigger_payload": {}},
    )
    assert view_trigger.status_code == 403

    # 2. Operator CAN trigger run -> 201
    op_trigger = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/runs",
        headers=op_headers,
        json={"trigger_payload": {}},
    )
    assert op_trigger.status_code == 201
    run_id = op_trigger.json()["id"]

    # 3. Operator CANNOT approve/resume -> 403
    op_resume = await async_client.post(
        f"/api/v1/organizations/{org_id}/runs/{run_id}/resume",
        headers=op_headers,
        json={"approved": True},
    )
    assert op_resume.status_code == 403

    # 4. Viewer cannot cancel -> 403
    view_cancel = await async_client.post(
        f"/api/v1/organizations/{org_id}/runs/{run_id}/cancel",
        headers=view_headers,
    )
    assert view_cancel.status_code == 403

    # 5. Owner CAN approve/resume -> 200
    owner_resume = await async_client.post(
        f"/api/v1/organizations/{org_id}/runs/{run_id}/resume",
        headers=owner_headers,
        json={"approved": True},
    )
    assert owner_resume.status_code == 200


@pytest.mark.asyncio
async def test_oversized_and_sensitive_payloads(async_client: AsyncClient):
    org_id, headers = await create_org_and_owner(async_client, "sensitive_flow")

    wf = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows",
            headers=headers,
            json={"name": "Data Protection Flow"},
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
            "steps": [{"step_key": "start", "step_type": "MANUAL_TRIGGER", "name": "Start", "config": {}}],
            "connections": [],
        },
    )
    await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/publish",
        headers=headers,
    )

    # Pass sensitive password, api_key, credit_card in payload
    exec_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/runs",
        headers=headers,
        json={
            "trigger_payload": {
                "user": "alice",
                "password": "super_secret_password_999",
                "api_key": "sk-live-1234567890",
                "credit_card": "4111-2222-3333-4444",
            }
        },
    )
    assert exec_res.status_code == 201
    run_detail = exec_res.json()

    # Sensitive values must be redacted
    trigger_pl = run_detail["trigger_payload"]
    assert trigger_pl["password"] == "[REDACTED]"
    assert trigger_pl["api_key"] == "[REDACTED]"
    assert trigger_pl["credit_card"] == "[REDACTED]"
    assert trigger_pl["user"] == "alice"


@pytest.mark.asyncio
async def test_concurrent_resume_requests_safe(async_client: AsyncClient):
    org_id, headers = await create_org_and_owner(async_client, "concur_resume")

    wf = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows",
            headers=headers,
            json={"name": "Concurrent Resume Flow"},
        )
    ).json()
    wf_id = wf["id"]
    v1_id = (
        await async_client.get(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions",
            headers=headers,
        )
    ).json()[0]["id"]

    # DAG: start -> app (HUMAN_APPROVAL) -> post_app (SLACK_NOTIFICATION)
    await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}",
        headers=headers,
        json={
            "steps": [
                {"step_key": "start", "step_type": "MANUAL_TRIGGER", "name": "Start", "config": {}},
                {"step_key": "app", "step_type": "HUMAN_APPROVAL", "name": "Review", "config": {"approver_role": "MANAGER"}},
                {"step_key": "post_app", "step_type": "SLACK_NOTIFICATION", "name": "Post App", "config": {"channel": "#general"}},
            ],
            "connections": [
                {"source_step_key": "start", "target_step_key": "app"},
                {"source_step_key": "app", "target_step_key": "post_app"},
            ],
        },
    )
    await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/publish",
        headers=headers,
    )

    run = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/runs",
            headers=headers,
            json={"trigger_payload": {}},
        )
    ).json()
    run_id = run["id"]
    assert run["status"] == "PAUSED"

    # Fire two concurrent resume requests
    task1 = async_client.post(
        f"/api/v1/organizations/{org_id}/runs/{run_id}/resume",
        headers=headers,
        json={"approved": True, "comment": "Task 1 approval"},
    )
    task2 = async_client.post(
        f"/api/v1/organizations/{org_id}/runs/{run_id}/resume",
        headers=headers,
        json={"approved": True, "comment": "Task 2 approval"},
    )

    r1, r2 = await asyncio.gather(task1, task2)
    # Both must succeed without crash or deadlock; due to row lock and idempotency,
    # both return 200 (or one 200 and one 200 idempotent)
    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r1.json()["status"] in ("RUNNING", "COMPLETED")
    assert r2.json()["status"] in ("RUNNING", "COMPLETED")

    # Fetch final details and verify downstream step was executed EXACTLY ONCE
    detail_res = await async_client.get(
        f"/api/v1/organizations/{org_id}/runs/{run_id}",
        headers=headers,
    )
    assert detail_res.status_code == 200
    detail_data = detail_res.json()
    assert detail_data["status"] == "COMPLETED"

    # Verify no duplicate downstream step execution
    post_app_runs = [s for s in detail_data["step_runs"] if s["step_key"] == "post_app"]
    assert len(post_app_runs) == 1
    assert post_app_runs[0]["status"] == "COMPLETED"

    app_runs = [s for s in detail_data["step_runs"] if s["step_key"] == "app"]
    assert len(app_runs) == 1
    assert app_runs[0]["status"] == "COMPLETED"



@pytest.mark.asyncio
async def test_step_timeout_marks_step_and_run_failed(async_client: AsyncClient, monkeypatch):
    """
    Mandatory Item 1: TIMEOUT TEST
    - Verifies executor timeout is enforced.
    - Verifies step status becomes FAILED.
    - Verifies workflow run status becomes FAILED.
    - Verifies no downstream steps execute.
    """
    from app.engine.workflow_engine import WorkflowEngine
    from app.engine.executors import MockCRMCreateExecutor
    from app.engine.base import StepExecutionResult

    # Set engine step timeout to 0.2 seconds
    monkeypatch.setattr(WorkflowEngine, "default_step_timeout_seconds", 0.2)

    # Monkeypatch MockCRMCreateExecutor to simulate slow step exceeding timeout
    async def slow_crm_execute(self, ctx):
        await asyncio.sleep(1.0)
        return StepExecutionResult(status="COMPLETED", output_data={"id": "crm_1"})

    monkeypatch.setattr(MockCRMCreateExecutor, "execute", slow_crm_execute)

    org_id, headers = await create_org_and_owner(async_client, "timeout_flow")

    wf = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows",
            headers=headers,
            json={"name": "Timeout Pipeline"},
        )
    ).json()
    wf_id = wf["id"]
    v1_id = (
        await async_client.get(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions",
            headers=headers,
        )
    ).json()[0]["id"]

    # Start -> slow_crm -> downstream_alert
    await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}",
        headers=headers,
        json={
            "steps": [
                {"step_key": "start", "step_type": "MANUAL_TRIGGER", "name": "Start", "config": {}},
                {"step_key": "slow_crm", "step_type": "MOCK_CRM_CREATE", "name": "Slow CRM", "config": {"entity_type": "lead"}},
                {"step_key": "downstream_alert", "step_type": "SLACK_NOTIFICATION", "name": "Slack Alert", "config": {"channel": "#alerts"}},
            ],
            "connections": [
                {"source_step_key": "start", "target_step_key": "slow_crm"},
                {"source_step_key": "slow_crm", "target_step_key": "downstream_alert"},
            ],
        },
    )
    await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/publish",
        headers=headers,
    )

    exec_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/runs",
        headers=headers,
        json={"trigger_payload": {}},
    )
    assert exec_res.status_code == 201
    run_data = exec_res.json()

    # Verify workflow run status becomes FAILED
    assert run_data["status"] == "FAILED"
    assert "timed out" in run_data["error_message"].lower()

    # Verify step status becomes FAILED
    step_dict = {s["step_key"]: s for s in run_data["step_runs"]}
    assert step_dict["start"]["status"] == "COMPLETED"
    assert step_dict["slow_crm"]["status"] == "FAILED"
    assert "timed out" in step_dict["slow_crm"]["error_message"].lower()

    # Verify no downstream steps execute
    assert "downstream_alert" not in step_dict


@pytest.mark.asyncio
async def test_failed_parent_convergence_prevents_converged_execution(async_client: AsyncClient):
    """
    Mandatory Item 2: FAILED-PARENT CONVERGENCE
    - Verifies conditional branching and OR convergence.
    - A convergence node must not execute if a required upstream path has FAILED.
    - Distinguishes COMPLETED, SKIPPED, FAILED execution paths and terminal workflow state.
    - Ensures no node executes more than once.
    """
    org_id, headers = await create_org_and_owner(async_client, "fail_parent_conv")

    wf = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows",
            headers=headers,
            json={"name": "Failed Parent Convergence Flow"},
        )
    ).json()
    wf_id = wf["id"]
    v1_id = (
        await async_client.get(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions",
            headers=headers,
        )
    ).json()[0]["id"]

    # Start -> Condition (amount > 1000)
    #   if true -> failing_branch (VALIDATE_DATA requiring "mandatory_tax_id" which will be missing)
    #   if false -> inactive_branch (SLACK_NOTIFICATION)
    # Both converge to -> converged_step (SLACK_NOTIFICATION)
    await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}",
        headers=headers,
        json={
            "steps": [
                {
                    "step_key": "start",
                    "step_type": "MANUAL_TRIGGER",
                    "name": "Start",
                    "config": {},
                },
                {
                    "step_key": "check_amount",
                    "step_type": "CONDITION",
                    "name": "Check Amount",
                    "config": {"field": "trigger.amount", "operator": "greater_than", "value": 1000},
                },
                {
                    "step_key": "failing_branch",
                    "step_type": "VALIDATE_DATA",
                    "name": "Failing Validation",
                    "config": {"required_fields": ["mandatory_tax_id"]},
                },
                {
                    "step_key": "inactive_branch",
                    "step_type": "SLACK_NOTIFICATION",
                    "name": "Inactive Branch",
                    "config": {"channel": "#low-priority"},
                },
                {
                    "step_key": "converged_step",
                    "step_type": "SLACK_NOTIFICATION",
                    "name": "Converged Step",
                    "config": {"channel": "#summary"},
                },
            ],
            "connections": [
                {"source_step_key": "start", "target_step_key": "check_amount"},
                {"source_step_key": "check_amount", "target_step_key": "failing_branch", "condition_label": "true"},
                {"source_step_key": "check_amount", "target_step_key": "inactive_branch", "condition_label": "false"},
                {"source_step_key": "failing_branch", "target_step_key": "converged_step"},
                {"source_step_key": "inactive_branch", "target_step_key": "converged_step"},
            ],
        },
    )
    await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/publish",
        headers=headers,
    )

    # Trigger with amount=5000 (routes to failing_branch), but omit mandatory_tax_id
    exec_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/runs",
        headers=headers,
        json={"trigger_payload": {"amount": 5000}},
    )
    assert exec_res.status_code == 201
    run_data = exec_res.json()

    # Workflow run status must be FAILED
    assert run_data["status"] == "FAILED"
    assert "failing_branch" in run_data["error_message"]

    step_dict = {s["step_key"]: s["status"] for s in run_data["step_runs"]}
    # failing_branch was executed and FAILED
    assert step_dict["failing_branch"] == "FAILED"
    # inactive_branch was not executed
    assert "inactive_branch" not in step_dict
    # CRITICAL: converged_step must NOT execute when upstream required parent has FAILED
    assert "converged_step" not in step_dict

    # Check run detail via GET endpoint
    detail_res = await async_client.get(
        f"/api/v1/organizations/{org_id}/runs/{run_data['id']}",
        headers=headers,
    )
    assert detail_res.status_code == 200
    detail_data = detail_res.json()
    assert detail_data["status"] == "FAILED"
    detail_steps = {s["step_key"]: s["status"] for s in detail_data["step_runs"]}
    assert detail_steps["failing_branch"] == "FAILED"
    assert "converged_step" not in detail_steps

    # Verify no step was executed more than once
    step_keys = [s["step_key"] for s in detail_data["step_runs"]]
    assert len(step_keys) == len(set(step_keys))
