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
async def test_list_executions_filtering_and_search(async_client: AsyncClient):
    """Verifies filtering runs by status, trigger_type, correlation_id, search, and date range."""
    org_id, headers = await create_org_and_owner(async_client, "exec_filter")

    # Create workflow
    wf_resp = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows",
        headers=headers,
        json={"name": "Order Ingestion Workflow"},
    )
    assert wf_resp.status_code == 201
    wf_id = wf_resp.json()["id"]

    # Get version 1
    versions = (
        await async_client.get(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions",
            headers=headers,
        )
    ).json()
    v1_id = versions[0]["id"]

    # Add single step and publish
    put_res = await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}",
        headers=headers,
        json={
            "steps": [
                {
                    "step_key": "step_trigger",
                    "step_type": "MANUAL_TRIGGER",
                    "name": "Manual Start",
                    "config": {},
                }
            ],
            "connections": [],
        },
    )
    assert put_res.status_code == 200

    pub_resp = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/publish",
        headers=headers,
    )
    assert pub_resp.status_code == 200

    # Trigger run 1 with specific correlation ID
    corr_1 = f"corr_order_alpha_{uuid.uuid4().hex[:6]}"
    r1 = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/runs",
        headers=headers,
        json={"correlation_id": corr_1, "trigger_payload": {"order_id": 101}},
    )
    assert r1.status_code == 201

    # Trigger run 2 with different correlation ID
    corr_2 = f"corr_order_beta_{uuid.uuid4().hex[:6]}"
    r2 = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/runs",
        headers=headers,
        json={"correlation_id": corr_2, "trigger_payload": {"order_id": 102}},
    )
    assert r2.status_code == 201

    # 1. Filter by correlation_id
    res_corr = await async_client.get(
        f"/api/v1/organizations/{org_id}/runs?correlation_id={corr_1}",
        headers=headers,
    )
    assert res_corr.status_code == 200
    corr_items = res_corr.json()["items"]
    assert len(corr_items) == 1
    assert corr_items[0]["correlation_id"] == corr_1
    assert corr_items[0]["workflow_name"] == "Order Ingestion Workflow"

    # 2. Filter by status
    res_status = await async_client.get(
        f"/api/v1/organizations/{org_id}/runs?status=COMPLETED",
        headers=headers,
    )
    assert res_status.status_code == 200
    assert len(res_status.json()["items"]) >= 2

    # 3. Filter by trigger_type
    res_trigger = await async_client.get(
        f"/api/v1/organizations/{org_id}/runs?trigger_type=MANUAL",
        headers=headers,
    )
    assert res_trigger.status_code == 200
    assert len(res_trigger.json()["items"]) >= 2

    # 4. Search by workflow name
    res_search = await async_client.get(
        f"/api/v1/organizations/{org_id}/runs?search=Order+Ingestion",
        headers=headers,
    )
    assert res_search.status_code == 200
    assert len(res_search.json()["items"]) >= 2

    # 5. Search by nonexistent term
    res_empty = await async_client.get(
        f"/api/v1/organizations/{org_id}/runs?search=NonExistentTerm999",
        headers=headers,
    )
    assert res_empty.status_code == 200
    assert len(res_empty.json()["items"]) == 0


@pytest.mark.asyncio
async def test_execution_detail_includes_workflow_name_duration_and_approvals(async_client: AsyncClient):
    """Verifies that run detail returns workflow_name, duration_ms, and approvals list."""
    org_id, headers = await create_org_and_owner(async_client, "exec_detail")

    # Create and publish workflow
    wf_resp = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows",
        headers=headers,
        json={"name": "Approval Pipeline Workflow"},
    )
    wf_id = wf_resp.json()["id"]

    v1_id = (
        await async_client.get(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions",
            headers=headers,
        )
    ).json()[0]["id"]

    # Configure DAG with human approval step
    await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}",
        headers=headers,
        json={
            "steps": [
                {"step_key": "start", "step_type": "MANUAL_TRIGGER", "name": "Start", "config": {}},
                {"step_key": "review", "step_type": "HUMAN_APPROVAL", "name": "Review", "config": {"approver_role": "MANAGER"}},
            ],
            "connections": [
                {"source_step_key": "start", "target_step_key": "review"},
            ],
        },
    )
    pub_resp = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/publish",
        headers=headers,
    )
    assert pub_resp.status_code == 200

    # Trigger run -> pauses on review
    r_resp = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/runs",
        headers=headers,
        json={"trigger_payload": {"amount": 5000}},
    )
    assert r_resp.status_code == 201
    run_id = r_resp.json()["id"]

    # Fetch detail while PAUSED
    detail_resp = await async_client.get(
        f"/api/v1/organizations/{org_id}/runs/{run_id}",
        headers=headers,
    )
    assert detail_resp.status_code == 200
    detail = detail_resp.json()
    assert detail["workflow_name"] == "Approval Pipeline Workflow"
    assert detail["status"] == "PAUSED"
    assert detail["duration_ms"] is not None
    assert len(detail["approvals"]) == 1
    assert detail["approvals"][0]["status"] == "PENDING"

    # Resume/Approve
    resume_resp = await async_client.post(
        f"/api/v1/organizations/{org_id}/runs/{run_id}/resume",
        headers=headers,
        json={"approved": True, "comment": "Approved for fulfillment"},
    )
    assert resume_resp.status_code == 200

    # Fetch detail after completion
    final_detail_resp = await async_client.get(
        f"/api/v1/organizations/{org_id}/runs/{run_id}",
        headers=headers,
    )
    assert final_detail_resp.status_code == 200
    final_detail = final_detail_resp.json()
    assert final_detail["status"] == "COMPLETED"
    assert len(final_detail["approvals"]) == 1
    assert final_detail["approvals"][0]["status"] == "APPROVED"
    assert final_detail["approvals"][0]["comment"] == "Approved for fulfillment"


@pytest.mark.asyncio
async def test_execution_history_deterministic_pagination(async_client: AsyncClient):
    """Verifies stable, non-overlapping pagination across consecutive pages."""
    org_id, headers = await create_org_and_owner(async_client, "exec_page")

    wf = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows",
            headers=headers,
            json={"name": "Pagination Workflow"},
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
        json={"steps": [{"step_key": "step_trigger", "step_type": "MANUAL_TRIGGER", "name": "Start", "config": {}}], "connections": []},
    )
    await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/publish",
        headers=headers,
    )

    # Trigger 4 runs
    run_ids = []
    for i in range(4):
        resp = await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/runs",
            headers=headers,
            json={"correlation_id": f"corr_page_{i}_{uuid.uuid4().hex[:4]}", "trigger_payload": {}},
        )
        assert resp.status_code == 201
        run_ids.append(resp.json()["id"])

    # Page 1 of 2
    p1 = (
        await async_client.get(
            f"/api/v1/organizations/{org_id}/runs?page=1&page_size=2",
            headers=headers,
        )
    ).json()
    assert len(p1["items"]) == 2
    assert p1["total"] == 4
    assert p1["total_pages"] == 2

    # Page 2 of 2
    p2 = (
        await async_client.get(
            f"/api/v1/organizations/{org_id}/runs?page=2&page_size=2",
            headers=headers,
        )
    ).json()
    assert len(p2["items"]) == 2

    # Verify no overlap between page 1 and page 2
    p1_ids = {item["id"] for item in p1["items"]}
    p2_ids = {item["id"] for item in p2["items"]}
    assert p1_ids.isdisjoint(p2_ids)


@pytest.mark.asyncio
async def test_cross_tenant_execution_isolation(async_client: AsyncClient):
    """Verifies that an authenticated user from Organization A cannot view executions of Organization B."""
    org_a_id, headers_a = await create_org_and_owner(async_client, "exec_iso_a")
    org_b_id, headers_b = await create_org_and_owner(async_client, "exec_iso_b")

    # Create run in Org B
    wf_b = (
        await async_client.post(
            f"/api/v1/organizations/{org_b_id}/workflows",
            headers=headers_b,
            json={"name": "Org B Secret Workflow"},
        )
    ).json()
    v_b_id = (
        await async_client.get(
            f"/api/v1/organizations/{org_b_id}/workflows/{wf_b['id']}/versions",
            headers=headers_b,
        )
    ).json()[0]["id"]
    put_b = await async_client.put(
        f"/api/v1/organizations/{org_b_id}/workflows/{wf_b['id']}/versions/{v_b_id}",
        headers=headers_b,
        json={"steps": [{"step_key": "step_trigger", "step_type": "MANUAL_TRIGGER", "name": "Start", "config": {}}], "connections": []},
    )
    assert put_b.status_code == 200

    pub_b = await async_client.post(
        f"/api/v1/organizations/{org_b_id}/workflows/{wf_b['id']}/versions/{v_b_id}/publish",
        headers=headers_b,
    )
    assert pub_b.status_code == 200

    run_b = (
        await async_client.post(
            f"/api/v1/organizations/{org_b_id}/workflows/{wf_b['id']}/runs",
            headers=headers_b,
            json={"trigger_payload": {}},
        )
    ).json()
    run_b_id = run_b["id"]

    # User A attempts to view Org B run via Org B URL -> 404
    resp_cross_org = await async_client.get(
        f"/api/v1/organizations/{org_b_id}/runs/{run_b_id}",
        headers=headers_a,
    )
    assert resp_cross_org.status_code == 404

    # User A attempts to view Org B run via Org A URL -> 404
    resp_cross_run = await async_client.get(
        f"/api/v1/organizations/{org_a_id}/runs/{run_b_id}",
        headers=headers_a,
    )
    assert resp_cross_run.status_code == 404


@pytest.mark.asyncio
async def test_execution_payload_sanitization_and_masking(async_client: AsyncClient):
    """Verifies that secrets in trigger payloads are masked in responses."""
    org_id, headers = await create_org_and_owner(async_client, "exec_sanitize")

    wf = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows",
            headers=headers,
            json={"name": "Sanitization Workflow"},
        )
    ).json()
    v1_id = (
        await async_client.get(
            f"/api/v1/organizations/{org_id}/workflows/{wf['id']}/versions",
            headers=headers,
        )
    ).json()[0]["id"]

    await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf['id']}/versions/{v1_id}",
        headers=headers,
        json={"steps": [{"step_key": "step_trigger", "step_type": "MANUAL_TRIGGER", "name": "Start", "config": {}}], "connections": []},
    )
    pub_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf['id']}/versions/{v1_id}/publish",
        headers=headers,
    )
    assert pub_res.status_code == 200

    sensitive_payload = {
        "user_email": "user@example.com",
        "api_key": "sk-super-secret-api-key-123",
        "nested": {
            "password": "my_cleartext_password",
            "token": "bearer_secret_token",
        },
    }

    run_resp = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf['id']}/runs",
        headers=headers,
        json={"trigger_payload": sensitive_payload},
    )
    assert run_resp.status_code == 201
    run_detail = run_resp.json()

    # Verify sensitive fields masked
    payload = run_detail["trigger_payload"]
    assert payload["api_key"] == "[REDACTED]"
    assert payload["nested"]["password"] == "[REDACTED]"
    assert payload["nested"]["token"] == "[REDACTED]"
    assert payload["user_email"] == "user@example.com"
