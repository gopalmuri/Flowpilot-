import uuid
import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings
from app.models.audit_log import AuditLog
from app.models.integration import Integration
from app.models.membership import OrganizationRole


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


async def add_member_with_role(
    async_client: AsyncClient,
    owner_headers: dict,
    org_id: str,
    role: str,
    name: str,
):
    email, password, _ = await create_authenticated_user(async_client, name)

    inv_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/members",
        headers=owner_headers,
        json={"email": email, "role": role},
    )
    assert inv_res.status_code == 201

    login_resp = await async_client.post(
        "/api/v1/auth/login", json={"email": email, "password": password, "organization_id": org_id}
    )
    token = login_resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_integration_crud_and_zero_secret_exposure(async_client: AsyncClient):
    org_id, owner_headers, _ = await create_org_and_owner(async_client, "integrator")

    # 1. Create Mock CRM integration with credentials
    crm_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/integrations",
        headers=owner_headers,
        json={
            "name": "Production HubSpot Simulator",
            "type": "MOCK_CRM",
            "credentials": {"api_key": "sk-crm-secret-token-12345"},
            "config": {"simulated_latency_ms": 15},
        },
    )
    assert crm_res.status_code == 201
    crm_data = crm_res.json()
    assert crm_data["name"] == "Production HubSpot Simulator"
    assert crm_data["type"] == "MOCK_CRM"
    assert crm_data["status"] == "CONNECTED"
    assert crm_data["has_credentials"] is True
    # Invariant: Secret api_key MUST NEVER appear in API response
    assert "sk-crm-secret-token-12345" not in str(crm_res.content)
    assert "credentials" not in crm_data

    crm_id = crm_data["id"]

    # 2. Create Slack integration
    slack_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/integrations",
        headers=owner_headers,
        json={
            "name": "Sales Alerts Slack",
            "type": "SLACK",
            "credentials": {"webhook_url": "https://hooks.slack.com/services/MOCK/AAA/BBB"},
            "config": {"channel": "#sales-alerts", "mock_mode": True},
        },
    )
    assert slack_res.status_code == 201
    slack_data = slack_res.json()
    assert slack_data["has_credentials"] is True
    assert "https://hooks.slack.com/services/MOCK/AAA/BBB" not in str(slack_res.content)
    slack_id = slack_data["id"]

    # 3. List integrations
    list_res = await async_client.get(
        f"/api/v1/organizations/{org_id}/integrations",
        headers=owner_headers,
    )
    assert list_res.status_code == 200
    list_data = list_res.json()
    assert list_data["total"] >= 2
    assert any(i["id"] == crm_id for i in list_data["items"])
    assert any(i["id"] == slack_id for i in list_data["items"])

    # 4. Get integration detail
    get_res = await async_client.get(
        f"/api/v1/organizations/{org_id}/integrations/{crm_id}",
        headers=owner_headers,
    )
    assert get_res.status_code == 200
    assert get_res.json()["has_credentials"] is True
    assert "sk-crm-secret" not in str(get_res.content)

    # 5. Update config and preserve credentials
    up_res = await async_client.put(
        f"/api/v1/organizations/{org_id}/integrations/{crm_id}",
        headers=owner_headers,
        json={"name": "Renamed CRM", "config": {"simulated_latency_ms": 25}},
    )
    assert up_res.status_code == 200
    assert up_res.json()["name"] == "Renamed CRM"
    assert up_res.json()["has_credentials"] is True  # Preserved

    # 6. Clear credentials
    clear_res = await async_client.put(
        f"/api/v1/organizations/{org_id}/integrations/{crm_id}",
        headers=owner_headers,
        json={"clear_credentials": True},
    )
    assert clear_res.status_code == 200
    assert clear_res.json()["has_credentials"] is False

    # 7. Delete integration
    del_res = await async_client.delete(
        f"/api/v1/organizations/{org_id}/integrations/{crm_id}",
        headers=owner_headers,
    )
    assert del_res.status_code == 204

    # Confirm 404 after deletion
    get_del = await async_client.get(
        f"/api/v1/organizations/{org_id}/integrations/{crm_id}",
        headers=owner_headers,
    )
    assert get_del.status_code == 404


@pytest.mark.asyncio
async def test_integration_name_uniqueness(async_client: AsyncClient):
    org_id, owner_headers, _ = await create_org_and_owner(async_client, "uniqueorg")

    payload = {
        "name": "Team Slack",
        "type": "SLACK",
        "credentials": {},
        "config": {"channel": "#general"},
    }
    res1 = await async_client.post(
        f"/api/v1/organizations/{org_id}/integrations",
        headers=owner_headers,
        json=payload,
    )
    assert res1.status_code == 201

    # Attempt same name (case-insensitive)
    payload_dup = {
        "name": "  team slack  ",
        "type": "SLACK",
        "credentials": {},
        "config": {"channel": "#random"},
    }
    res2 = await async_client.post(
        f"/api/v1/organizations/{org_id}/integrations",
        headers=owner_headers,
        json=payload_dup,
    )
    assert res2.status_code == 409
    assert "already exists" in res2.json()["detail"]


@pytest.mark.asyncio
async def test_integration_rbac_enforcement(async_client: AsyncClient):
    org_id, owner_headers, _ = await create_org_and_owner(async_client, "rbacorg")

    manager_headers = await add_member_with_role(async_client, owner_headers, org_id, "MANAGER", "manager_user")
    viewer_headers = await add_member_with_role(async_client, owner_headers, org_id, "VIEWER", "viewer_user")

    # 1. VIEWER cannot create integration -> 403 Forbidden
    res_viewer_create = await async_client.post(
        f"/api/v1/organizations/{org_id}/integrations",
        headers=viewer_headers,
        json={"name": "Viewer Slack", "type": "SLACK"},
    )
    assert res_viewer_create.status_code == 403

    # 2. MANAGER cannot create integration -> 403 Forbidden
    res_mgr_create = await async_client.post(
        f"/api/v1/organizations/{org_id}/integrations",
        headers=manager_headers,
        json={"name": "Manager Slack", "type": "SLACK"},
    )
    assert res_mgr_create.status_code == 403

    # 3. OWNER creates integration
    create_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/integrations",
        headers=owner_headers,
        json={
            "name": "Owner Slack",
            "type": "SLACK",
            "credentials": {"webhook_url": "mock://slack"},
            "config": {"mock_mode": True},
        },
    )
    assert create_res.status_code == 201
    int_id = create_res.json()["id"]

    # 4. VIEWER can view integration
    get_res = await async_client.get(
        f"/api/v1/organizations/{org_id}/integrations/{int_id}",
        headers=viewer_headers,
    )
    assert get_res.status_code == 200

    # 5. VIEWER cannot test connection -> 403 Forbidden
    test_viewer = await async_client.post(
        f"/api/v1/organizations/{org_id}/integrations/{int_id}/test",
        headers=viewer_headers,
    )
    assert test_viewer.status_code == 403

    # 6. MANAGER CAN test connection -> 200 OK
    test_mgr = await async_client.post(
        f"/api/v1/organizations/{org_id}/integrations/{int_id}/test",
        headers=manager_headers,
    )
    assert test_mgr.status_code == 200
    assert test_mgr.json()["status"] == "healthy"


@pytest.mark.asyncio
async def test_tenant_isolation_integrations(async_client: AsyncClient):
    org_a, headers_a, _ = await create_org_and_owner(async_client, "orga")
    org_b, headers_b, _ = await create_org_and_owner(async_client, "orgb")

    # Org A creates integration
    res_a = await async_client.post(
        f"/api/v1/organizations/{org_a}/integrations",
        headers=headers_a,
        json={"name": "Org A Secret CRM", "type": "MOCK_CRM"},
    )
    assert res_a.status_code == 201
    int_a_id = res_a.json()["id"]

    # Org B attempts to access Org A's integration -> 404 Not Found
    res_b_get = await async_client.get(
        f"/api/v1/organizations/{org_b}/integrations/{int_a_id}",
        headers=headers_b,
    )
    assert res_b_get.status_code == 404

    # Org B attempts to update Org A's integration -> 404 Not Found
    res_b_put = await async_client.put(
        f"/api/v1/organizations/{org_b}/integrations/{int_a_id}",
        headers=headers_b,
        json={"name": "Hacked"},
    )
    assert res_b_put.status_code == 404

    # Org B attempts to delete Org A's integration -> 404 Not Found
    res_b_del = await async_client.delete(
        f"/api/v1/organizations/{org_b}/integrations/{int_a_id}",
        headers=headers_b,
    )
    assert res_b_del.status_code == 404


@pytest.mark.asyncio
async def test_integration_connection_testing_mock_crm_and_slack(async_client: AsyncClient):
    org_id, owner_headers, _ = await create_org_and_owner(async_client, "testconn")

    # 1. Test Mock CRM
    crm_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/integrations",
        headers=owner_headers,
        json={"name": "Test Mock CRM", "type": "MOCK_CRM"},
    )
    crm_id = crm_res.json()["id"]

    test_crm = await async_client.post(
        f"/api/v1/organizations/{org_id}/integrations/{crm_id}/test",
        headers=owner_headers,
    )
    assert test_crm.status_code == 200
    assert test_crm.json()["status"] == "healthy"
    assert test_crm.json()["latency_ms"] >= 0.0

    # 2. Test Slack Mock Mode
    slack_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/integrations",
        headers=owner_headers,
        json={
            "name": "Test Slack Mock",
            "type": "SLACK",
            "credentials": {"webhook_url": "mock://slack"},
            "config": {"mock_mode": True},
        },
    )
    slack_id = slack_res.json()["id"]

    test_slack = await async_client.post(
        f"/api/v1/organizations/{org_id}/integrations/{slack_id}/test",
        headers=owner_headers,
    )
    assert test_slack.status_code == 200
    assert test_slack.json()["status"] == "healthy"

    # 3. Test Slack with SSRF blocked URL
    bad_slack = await async_client.post(
        f"/api/v1/organizations/{org_id}/integrations",
        headers=owner_headers,
        json={
            "name": "SSRF Slack",
            "type": "SLACK",
            "credentials": {"webhook_url": "https://127.0.0.1/bad-hook"},
            "config": {"mock_mode": False},
        },
    )
    bad_id = bad_slack.json()["id"]

    test_bad = await async_client.post(
        f"/api/v1/organizations/{org_id}/integrations/{bad_id}/test",
        headers=owner_headers,
    )
    assert test_bad.status_code == 200
    assert test_bad.json()["status"] == "error"
    assert "SSRF" in test_bad.json()["message"] or "blocked" in test_bad.json()["message"]


@pytest.mark.asyncio
async def test_audit_logs_recorded_for_integrations(async_client: AsyncClient):
    org_id, owner_headers, _ = await create_org_and_owner(async_client, "auditint")

    # Create
    c_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/integrations",
        headers=owner_headers,
        json={"name": "Audit Slack", "type": "SLACK", "credentials": {"webhook_url": "mock://slack"}},
    )
    int_id = c_res.json()["id"]

    # Update
    await async_client.put(
        f"/api/v1/organizations/{org_id}/integrations/{int_id}",
        headers=owner_headers,
        json={"name": "Audit Slack Renamed"},
    )

    # Test
    await async_client.post(
        f"/api/v1/organizations/{org_id}/integrations/{int_id}/test",
        headers=owner_headers,
    )

    # Delete
    await async_client.delete(
        f"/api/v1/organizations/{org_id}/integrations/{int_id}",
        headers=owner_headers,
    )

    # Inspect audit_logs table
    engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

    async with session_factory() as session:
        logs_stmt = (
            select(AuditLog)
            .where(AuditLog.organization_id == uuid.UUID(org_id))
            .order_by(AuditLog.created_at.asc())
        )
        logs = (await session.execute(logs_stmt)).scalars().all()

        actions = [log.action for log in logs]
        assert "integration.created" in actions
        assert "integration.updated" in actions
        assert "integration.connection_tested" in actions
        assert "integration.deleted" in actions

        # Zero secret exposure invariant in audit logs
        for log in logs:
            log_str = str(log.details)
            assert "mock://slack" not in log_str
            assert "webhook_url" not in log_str
            assert "api_key" not in log_str

    await engine.dispose()
