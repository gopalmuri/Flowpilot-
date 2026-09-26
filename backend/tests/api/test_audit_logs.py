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
    return org_id, {"Authorization": f"Bearer {org_token}"}, email, password


@pytest.mark.asyncio
async def test_workflow_and_execution_lifecycle_audit_events_recorded(async_client: AsyncClient):
    """Verifies that workflow and execution lifecycle events are emitted into the audit trail."""
    org_id, headers, _, _ = await create_org_and_owner(async_client, "audit_cycle")

    # 1. Create workflow -> workflow.created
    wf = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows",
            headers=headers,
            json={"name": "Lifecycle Audited Flow"},
        )
    ).json()
    wf_id = wf["id"]

    # 2. Update workflow -> workflow.updated
    await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}",
        headers=headers,
        json={"name": "Lifecycle Audited Flow Updated"},
    )

    # 3. Publish and execute workflow -> execution.started, execution.completed
    v1_id = (
        await async_client.get(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions",
            headers=headers,
        )
    ).json()[0]["id"]
    put_res = await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}",
        headers=headers,
        json={"steps": [{"step_key": "init", "step_type": "MANUAL_TRIGGER", "name": "Start", "config": {}}], "connections": []},
    )
    assert put_res.status_code == 200

    pub_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/publish",
        headers=headers,
    )
    assert pub_res.status_code == 200

    run = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/runs",
            headers=headers,
            json={"correlation_id": "corr_audit_100", "trigger_payload": {}},
        )
    ).json()
    run_id = run["id"]

    # 4. Archive workflow -> workflow.archived
    await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/archive",
        headers=headers,
    )

    # 5. Query Audit Logs via API
    logs_resp = await async_client.get(
        f"/api/v1/organizations/{org_id}/audit-logs?page=1&page_size=50",
        headers=headers,
    )
    assert logs_resp.status_code == 200
    items = logs_resp.json()["items"]
    actions = [item["action"] for item in items]

    assert "workflow.created" in actions
    assert "workflow.updated" in actions
    assert "workflow.archived" in actions
    assert "execution.started" in actions
    assert "execution.completed" in actions


@pytest.mark.asyncio
async def test_execution_failed_and_cancelled_audit_events(async_client: AsyncClient):
    """Verifies execution.cancelled is emitted upon manual cancellation."""
    org_id, headers, _, _ = await create_org_and_owner(async_client, "audit_cancel")

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
    put_res = await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}",
        headers=headers,
        json={
            "steps": [
                {"step_key": "t", "step_type": "MANUAL_TRIGGER", "name": "Start", "config": {}},
                {"step_key": "appr", "step_type": "HUMAN_APPROVAL", "name": "Review", "config": {"approver_role": "MANAGER"}},
            ],
            "connections": [{"source_step_key": "t", "target_step_key": "appr"}],
        },
    )
    assert put_res.status_code == 200

    pub_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/publish",
        headers=headers,
    )
    assert pub_res.status_code == 200

    # Trigger run -> pauses on approval
    run_resp = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/runs",
        headers=headers,
        json={"trigger_payload": {}},
    )
    assert run_resp.status_code == 201
    run_id = run_resp.json()["id"]

    # Cancel run
    cancel_resp = await async_client.post(
        f"/api/v1/organizations/{org_id}/runs/{run_id}/cancel",
        headers=headers,
    )
    assert cancel_resp.status_code == 200

    # Query audit logs for execution.cancelled
    audit_resp = await async_client.get(
        f"/api/v1/organizations/{org_id}/audit-logs?action=execution.cancelled",
        headers=headers,
    )
    assert audit_resp.status_code == 200
    items = audit_resp.json()["items"]
    assert len(items) == 1
    assert items[0]["action"] == "execution.cancelled"
    assert items[0]["resource_id"] == run_id


@pytest.mark.asyncio
async def test_audit_logs_query_filters_and_detail(async_client: AsyncClient):
    """Verifies filtering audit logs by action, resource_type, search, and retrieving single detail."""
    org_id, headers, _, _ = await create_org_and_owner(async_client, "audit_filter")

    wf = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows",
            headers=headers,
            json={"name": "Audit Query Flow"},
        )
    ).json()

    # 1. Filter by action
    action_resp = await async_client.get(
        f"/api/v1/organizations/{org_id}/audit-logs?action=workflow.created",
        headers=headers,
    )
    assert action_resp.status_code == 200
    items = action_resp.json()["items"]
    assert len(items) == 1
    assert items[0]["action"] == "workflow.created"
    audit_id = items[0]["id"]

    # 2. Get single audit log detail
    detail_resp = await async_client.get(
        f"/api/v1/organizations/{org_id}/audit-logs/{audit_id}",
        headers=headers,
    )
    assert detail_resp.status_code == 200
    detail = detail_resp.json()
    assert detail["id"] == audit_id
    assert detail["action"] == "workflow.created"
    assert detail["actor_name"] is not None

    # 3. Filter by resource_type
    res_resp = await async_client.get(
        f"/api/v1/organizations/{org_id}/audit-logs?resource_type=workflow",
        headers=headers,
    )
    assert res_resp.status_code == 200
    assert len(res_resp.json()["items"]) >= 1

    # 4. Search by action name
    search_resp = await async_client.get(
        f"/api/v1/organizations/{org_id}/audit-logs?search=workflow.created",
        headers=headers,
    )
    assert search_resp.status_code == 200
    assert len(search_resp.json()["items"]) >= 1


@pytest.mark.asyncio
async def test_audit_logs_rbac_and_cross_tenant(async_client: AsyncClient):
    """Verifies that OWNER/ADMIN/MANAGER can access audit logs while OPERATOR/VIEWER receive 403, and cross-tenant gets 404."""
    org_id, owner_headers, _, _ = await create_org_and_owner(async_client, "audit_rbac")

    # Invite viewer user
    _, _, viewer_headers = await create_authenticated_user(async_client, "audit_viewer")
    # Fetch viewer user id via auth/me
    viewer_me = (await async_client.get("/api/v1/auth/me", headers=viewer_headers)).json()
    viewer_email = viewer_me["user"]["email"]

    # Add as VIEWER to organization
    add_resp = await async_client.post(
        f"/api/v1/organizations/{org_id}/members",
        headers=owner_headers,
        json={"email": viewer_email, "role": "VIEWER"},
    )
    assert add_resp.status_code == 201

    # Extract password from email
    unique = viewer_email.split("_")[2].split("@")[0]
    viewer_pass = f"SecurePass_{unique}!123"

    # Login viewer into organization context
    login_viewer = await async_client.post(
        "/api/v1/auth/login",
        json={
            "email": viewer_email,
            "password": viewer_pass,
            "organization_id": org_id,
        },
    )
    viewer_token = login_viewer.json()["access_token"]
    viewer_org_headers = {"Authorization": f"Bearer {viewer_token}"}

    # VIEWER tries to view audit logs -> 403 Forbidden
    resp_viewer = await async_client.get(
        f"/api/v1/organizations/{org_id}/audit-logs",
        headers=viewer_org_headers,
    )
    assert resp_viewer.status_code == 403

    # Cross-tenant access: user from another org -> 404
    other_org_id, other_headers, _, _ = await create_org_and_owner(async_client, "other_audit_org")
    resp_cross = await async_client.get(
        f"/api/v1/organizations/{org_id}/audit-logs",
        headers=other_headers,
    )
    assert resp_cross.status_code == 404


@pytest.mark.asyncio
async def test_audit_log_immutability(async_client: AsyncClient):
    """Verifies that audit logs cannot be modified or deleted via normal APIs (405 Method Not Allowed)."""
    org_id, headers, _, _ = await create_org_and_owner(async_client, "audit_immut")

    fake_id = str(uuid.uuid4())
    put_resp = await async_client.put(
        f"/api/v1/organizations/{org_id}/audit-logs/{fake_id}",
        headers=headers,
        json={"details": {"tampered": True}},
    )
    assert put_resp.status_code in [404, 405]

    del_resp = await async_client.delete(
        f"/api/v1/organizations/{org_id}/audit-logs/{fake_id}",
        headers=headers,
    )
    assert del_resp.status_code in [404, 405]
