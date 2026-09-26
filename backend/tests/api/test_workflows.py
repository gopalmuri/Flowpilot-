import asyncio
import uuid
import pytest
from httpx import AsyncClient


async def create_authenticated_user(async_client: AsyncClient, name: str, org_name: str = None):
    unique = uuid.uuid4().hex[:8]
    email = f"{name}_{unique}@flowpilot.internal"
    password = f"SecurePass_{unique}!123"
    reg_payload = {
        "email": email,
        "password": password,
        "full_name": f"{name.capitalize()} User",
    }
    if org_name:
        reg_payload["organization_name"] = org_name

    await async_client.post("/api/v1/auth/register", json=reg_payload)
    login_resp = await async_client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )
    token = login_resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    return email, headers


async def create_org_and_owner(async_client: AsyncClient, name: str):
    email, headers = await create_authenticated_user(async_client, name)
    resp = await async_client.post(
        "/api/v1/organizations",
        headers=headers,
        json={"name": f"{name.capitalize()} Corp"},
    )
    assert resp.status_code == 201
    org_id = resp.json()["id"]
    return org_id, headers


@pytest.mark.asyncio
async def test_workflow_creation_and_listing(async_client: AsyncClient):
    org_id, headers = await create_org_and_owner(async_client, "owner_crud")

    # 1. Create Workflow
    create_resp = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows",
        headers=headers,
        json={
            "name": "Lead Triage Automation",
            "description": "Routes inbound webhook leads",
        },
    )
    assert create_resp.status_code == 201
    wf = create_resp.json()
    assert wf["name"] == "Lead Triage Automation"
    assert wf["status"] == "DRAFT"
    assert wf["active_version_id"] is None
    assert wf["webhook_key"] is not None
    assert wf["version_count"] == 1
    wf_id = wf["id"]

    # 2. List Workflows
    list_resp = await async_client.get(
        f"/api/v1/organizations/{org_id}/workflows",
        headers=headers,
    )
    assert list_resp.status_code == 200
    list_data = list_resp.json()
    assert list_data["total"] == 1
    assert list_data["items"][0]["id"] == wf_id

    # 3. Filter by status
    draft_filter = await async_client.get(
        f"/api/v1/organizations/{org_id}/workflows?status=DRAFT",
        headers=headers,
    )
    assert draft_filter.status_code == 200
    assert draft_filter.json()["total"] == 1

    active_filter = await async_client.get(
        f"/api/v1/organizations/{org_id}/workflows?status=ACTIVE",
        headers=headers,
    )
    assert active_filter.status_code == 200
    assert active_filter.json()["total"] == 0

    # 4. Search by name
    search_resp = await async_client.get(
        f"/api/v1/organizations/{org_id}/workflows?search=Triage",
        headers=headers,
    )
    assert search_resp.status_code == 200
    assert search_resp.json()["total"] == 1


@pytest.mark.asyncio
async def test_workflow_get_and_update_metadata(async_client: AsyncClient):
    org_id, headers = await create_org_and_owner(async_client, "owner_update")

    # Create workflow
    create_resp = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows",
        headers=headers,
        json={"name": "Initial Name", "description": "Initial Desc"},
    )
    wf_id = create_resp.json()["id"]

    # Retrieve workflow
    get_resp = await async_client.get(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}",
        headers=headers,
    )
    assert get_resp.status_code == 200
    assert get_resp.json()["name"] == "Initial Name"

    # Update metadata
    update_resp = await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}",
        headers=headers,
        json={"name": "Updated Name", "description": "Updated Desc"},
    )
    assert update_resp.status_code == 200
    updated = update_resp.json()
    assert updated["name"] == "Updated Name"
    assert updated["description"] == "Updated Desc"


@pytest.mark.asyncio
async def test_workflow_deletion_restricted_to_owner_and_admin(async_client: AsyncClient):
    org_id, owner_headers = await create_org_and_owner(async_client, "owner_del")

    # Add Manager to org
    mgr_email, mgr_headers = await create_authenticated_user(async_client, "mgr_del")
    add_resp = await async_client.post(
        f"/api/v1/organizations/{org_id}/members",
        headers=owner_headers,
        json={"email": mgr_email, "role": "MANAGER"},
    )
    assert add_resp.status_code == 201

    # Create workflow
    wf_resp = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows",
        headers=owner_headers,
        json={"name": "Delete Target WF"},
    )
    wf_id = wf_resp.json()["id"]

    # Manager attempts DELETE -> 403 Forbidden
    mgr_del_resp = await async_client.delete(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}",
        headers=mgr_headers,
    )
    assert mgr_del_resp.status_code == 403

    # Owner performs DELETE -> 204 No Content
    owner_del_resp = await async_client.delete(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}",
        headers=owner_headers,
    )
    assert owner_del_resp.status_code == 204

    # Subsequent retrieval returns 404
    get_after = await async_client.get(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}",
        headers=owner_headers,
    )
    assert get_after.status_code == 404


@pytest.mark.asyncio
async def test_tenant_isolation_cross_tenant_access_returns_404(async_client: AsyncClient):
    org1_id, org1_headers = await create_org_and_owner(async_client, "tenant1")
    org2_id, org2_headers = await create_org_and_owner(async_client, "tenant2")

    # Create workflow in Org 1
    create_resp = await async_client.post(
        f"/api/v1/organizations/{org1_id}/workflows",
        headers=org1_headers,
        json={"name": "Org 1 Secret Flow"},
    )
    wf_id = create_resp.json()["id"]

    # Org 2 attempts to access Org 1 workflow via Org 2 URL -> 404
    cross_get_resp = await async_client.get(
        f"/api/v1/organizations/{org2_id}/workflows/{wf_id}",
        headers=org2_headers,
    )
    assert cross_get_resp.status_code == 404

    # Org 2 user attempts to access Org 1 workflow via Org 1 URL (not a member) -> 404
    cross_direct_resp = await async_client.get(
        f"/api/v1/organizations/{org1_id}/workflows/{wf_id}",
        headers=org2_headers,
    )
    assert cross_direct_resp.status_code == 404

    # Org 2 user attempts to mutate Org 1 workflow -> 404
    cross_put_resp = await async_client.put(
        f"/api/v1/organizations/{org2_id}/workflows/{wf_id}",
        headers=org2_headers,
        json={"name": "Hacked Name"},
    )
    assert cross_put_resp.status_code == 404


@pytest.mark.asyncio
async def test_rbac_workflow_permissions(async_client: AsyncClient):
    org_id, owner_headers = await create_org_and_owner(async_client, "rbac_owner")

    # Add Operator and Viewer
    op_email, op_headers = await create_authenticated_user(async_client, "op_user")
    view_email, view_headers = await create_authenticated_user(async_client, "view_user")

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

    # Operator cannot create workflow -> 403
    op_create = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows",
        headers=op_headers,
        json={"name": "Operator Workflow"},
    )
    assert op_create.status_code == 403

    # Viewer cannot create workflow -> 403
    view_create = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows",
        headers=view_headers,
        json={"name": "Viewer Workflow"},
    )
    assert view_create.status_code == 403

    # Owner creates workflow
    wf = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows",
            headers=owner_headers,
            json={"name": "Read Only Target"},
        )
    ).json()

    # Both Operator and Viewer can view workflow
    op_get = await async_client.get(
        f"/api/v1/organizations/{org_id}/workflows/{wf['id']}",
        headers=op_headers,
    )
    assert op_get.status_code == 200

    view_get = await async_client.get(
        f"/api/v1/organizations/{org_id}/workflows/{wf['id']}",
        headers=view_headers,
    )
    assert view_get.status_code == 200


@pytest.mark.asyncio
async def test_workflow_versions_and_draft_updates(async_client: AsyncClient):
    org_id, headers = await create_org_and_owner(async_client, "version_tester")

    wf = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows",
            headers=headers,
            json={"name": "Multi-Version Pipeline"},
        )
    ).json()
    wf_id = wf["id"]

    # List versions -> contains initial version 1 (Draft)
    v_list = (
        await async_client.get(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions",
            headers=headers,
        )
    ).json()
    assert len(v_list) == 1
    v1_id = v_list[0]["id"]
    assert v_list[0]["version_number"] == 1
    assert v_list[0]["status"] == "DRAFT"

    # Update version 1 steps and connections
    update_v1 = await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}",
        headers=headers,
        json={
            "steps": [
                {
                    "step_key": "step_1",
                    "step_type": "WEBHOOK_TRIGGER",
                    "name": "Webhook Ingestion",
                    "config": {},
                    "ui_position": {"x": 100, "y": 100},
                },
                {
                    "step_key": "step_2",
                    "step_type": "AI_CLASSIFICATION",
                    "name": "AI Priority Triage",
                    "config": {"prompt": "Analyze priority", "categories": ["high", "low"]},
                    "ui_position": {"x": 100, "y": 250},
                },
            ],
            "connections": [
                {
                    "source_step_key": "step_1",
                    "target_step_key": "step_2",
                }
            ],
        },
    )
    assert update_v1.status_code == 200
    v1_detail = update_v1.json()
    assert len(v1_detail["steps"]) == 2
    assert len(v1_detail["connections"]) == 1
    assert v1_detail["connections"][0]["source_step_key"] == "step_1"
    assert v1_detail["connections"][0]["target_step_key"] == "step_2"

    # Create version 2 cloned from version 1
    create_v2 = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions",
        headers=headers,
        json={"base_version_id": v1_id},
    )
    assert create_v2.status_code == 201
    v2_detail = create_v2.json()
    assert v2_detail["version_number"] == 2
    assert v2_detail["status"] == "DRAFT"
    assert len(v2_detail["steps"]) == 2


@pytest.mark.asyncio
async def test_dry_run_validation_results(async_client: AsyncClient):
    org_id, headers = await create_org_and_owner(async_client, "val_tester")

    wf = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows",
            headers=headers,
            json={"name": "Validation Test Workflow"},
        )
    ).json()
    v1_id = (
        await async_client.get(
            f"/api/v1/organizations/{org_id}/workflows/{wf['id']}/versions",
            headers=headers,
        )
    ).json()[0]["id"]

    # 1. Empty steps validation -> valid: false
    val_empty = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf['id']}/versions/{v1_id}/validate",
        headers=headers,
    )
    assert val_empty.status_code == 200
    res_empty = val_empty.json()
    assert res_empty["valid"] is False
    assert any("at least one step" in err for err in res_empty["errors"])

    # 2. Add step with cycle and missing trigger
    await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf['id']}/versions/{v1_id}",
        headers=headers,
        json={
            "steps": [
                {
                    "step_key": "step_a",
                    "step_type": "VALIDATE_DATA",
                    "name": "Step A",
                    "config": {},
                },
                {
                    "step_key": "step_b",
                    "step_type": "VALIDATE_DATA",
                    "name": "Step B",
                    "config": {},
                },
            ],
            "connections": [
                {"source_step_key": "step_a", "target_step_key": "step_b"},
                {"source_step_key": "step_b", "target_step_key": "step_a"},
            ],
        },
    )

    val_cycle = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf['id']}/versions/{v1_id}/validate",
        headers=headers,
    )
    assert val_cycle.status_code == 200
    res_cycle = val_cycle.json()
    assert res_cycle["valid"] is False
    assert any("trigger" in err for err in res_cycle["errors"])
    assert any("circular" in err or "cycles" in err for err in res_cycle["errors"])


@pytest.mark.asyncio
async def test_publishing_invalid_workflow_fails_with_422(async_client: AsyncClient):
    org_id, headers = await create_org_and_owner(async_client, "publish_fail")

    wf = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows",
            headers=headers,
            json={"name": "Invalid Publish Flow"},
        )
    ).json()
    v1_id = (
        await async_client.get(
            f"/api/v1/organizations/{org_id}/workflows/{wf['id']}/versions",
            headers=headers,
        )
    ).json()[0]["id"]

    # Attempt to publish empty draft
    pub_resp = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf['id']}/versions/{v1_id}/publish",
        headers=headers,
    )
    assert pub_resp.status_code == 422
    data = pub_resp.json()
    assert "detail" in data
    assert "errors" in data["detail"]
    assert len(data["detail"]["errors"]) > 0

    # Verify workflow and version statuses remain DRAFT
    wf_after = (
        await async_client.get(
            f"/api/v1/organizations/{org_id}/workflows/{wf['id']}",
            headers=headers,
        )
    ).json()
    assert wf_after["status"] == "DRAFT"
    assert wf_after["active_version_id"] is None


@pytest.mark.asyncio
async def test_publishing_valid_workflow_and_immutability(async_client: AsyncClient):
    org_id, headers = await create_org_and_owner(async_client, "pub_success")

    wf = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows",
            headers=headers,
            json={"name": "Production Valid Workflow"},
        )
    ).json()
    wf_id = wf["id"]
    v1_id = (
        await async_client.get(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions",
            headers=headers,
        )
    ).json()[0]["id"]

    # Configure valid DAG
    await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}",
        headers=headers,
        json={
            "steps": [
                {
                    "step_key": "trigger_node",
                    "step_type": "WEBHOOK_TRIGGER",
                    "name": "Inbound Webhook",
                    "config": {},
                },
                {
                    "step_key": "ai_triage",
                    "step_type": "AI_CLASSIFICATION",
                    "name": "AI Lead Classifier",
                    "config": {"prompt": "Classify priority"},
                },
                {
                    "step_key": "notify_slack",
                    "step_type": "SLACK_NOTIFICATION",
                    "name": "Slack Alert",
                    "config": {"channel": "#leads"},
                },
            ],
            "connections": [
                {"source_step_key": "trigger_node", "target_step_key": "ai_triage"},
                {"source_step_key": "ai_triage", "target_step_key": "notify_slack"},
            ],
        },
    )

    # Dry-run validation
    val_check = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/validate",
        headers=headers,
    )
    assert val_check.status_code == 200
    assert val_check.json()["valid"] is True

    # Publish
    pub_resp = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/publish",
        headers=headers,
    )
    assert pub_resp.status_code == 200
    published_wf = pub_resp.json()
    assert published_wf["status"] == "ACTIVE"
    assert published_wf["active_version_id"] == v1_id

    # Verify published version status
    v_detail = (
        await async_client.get(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}",
            headers=headers,
        )
    ).json()
    assert v_detail["status"] == "PUBLISHED"

    # Attempt to modify published version -> 400 Bad Request (Immutable)
    mutate_pub = await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}",
        headers=headers,
        json={"steps": [], "connections": []},
    )
    assert mutate_pub.status_code == 400
    assert "immutable" in mutate_pub.json()["detail"].lower()

    # Attempt to publish already published version -> 400 Bad Request
    repub = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/publish",
        headers=headers,
    )
    assert repub.status_code == 400


@pytest.mark.asyncio
async def test_enable_and_disable_workflow_lifecycle(async_client: AsyncClient):
    org_id, headers = await create_org_and_owner(async_client, "lifecycle_user")

    wf = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows",
            headers=headers,
            json={"name": "Lifecycle Test Flow"},
        )
    ).json()
    wf_id = wf["id"]

    # 1. Enabling an un-published workflow fails -> 400
    enable_fail = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/enable",
        headers=headers,
    )
    assert enable_fail.status_code == 400

    # 2. Add valid DAG and publish
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
                    "step_key": "manual_start",
                    "step_type": "MANUAL_TRIGGER",
                    "name": "Manual Start",
                    "config": {},
                }
            ],
            "connections": [],
        },
    )

    await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/publish",
        headers=headers,
    )

    # 3. Disable / Pause active workflow
    disable_resp = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/disable",
        headers=headers,
    )
    assert disable_resp.status_code == 200
    assert disable_resp.json()["status"] == "PAUSED"

    # 4. Enable paused workflow
    enable_resp = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/enable",
        headers=headers,
    )
    assert enable_resp.status_code == 200
    assert enable_resp.json()["status"] == "ACTIVE"


@pytest.mark.asyncio
async def test_concurrent_publish_safety(async_client: AsyncClient):
    org_id, headers = await create_org_and_owner(async_client, "concurrent_user")

    wf = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows",
            headers=headers,
            json={"name": "Concurrent Safety Flow"},
        )
    ).json()
    wf_id = wf["id"]
    v1_id = (
        await async_client.get(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions",
            headers=headers,
        )
    ).json()[0]["id"]

    # Configure valid DAG
    await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}",
        headers=headers,
        json={
            "steps": [
                {
                    "step_key": "start_node",
                    "step_type": "MANUAL_TRIGGER",
                    "name": "Start Node",
                    "config": {},
                }
            ],
            "connections": [],
        },
    )

    # Trigger concurrent publish requests
    task1 = async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/publish",
        headers=headers,
    )
    task2 = async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/publish",
        headers=headers,
    )

    resp1, resp2 = await asyncio.gather(task1, task2)
    statuses = [resp1.status_code, resp2.status_code]

    # Exactly one request must succeed with 200, and the concurrent one must receive 400
    assert 200 in statuses
    assert 400 in statuses


@pytest.mark.asyncio
async def test_validate_data_and_human_approval_step_validation(async_client: AsyncClient):
    org_id, headers = await create_org_and_owner(async_client, "step_types_user")

    wf = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows",
            headers=headers,
            json={"name": "Step Types Validation Flow"},
        )
    ).json()
    wf_id = wf["id"]
    v1_id = (
        await async_client.get(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions",
            headers=headers,
        )
    ).json()[0]["id"]

    # 1. Test VALIDATE_DATA and HUMAN_APPROVAL with empty configs -> validation errors
    await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}",
        headers=headers,
        json={
            "steps": [
                {
                    "step_key": "webhook_in",
                    "step_type": "WEBHOOK_TRIGGER",
                    "name": "Webhook In",
                    "config": {},
                },
                {
                    "step_key": "val_node",
                    "step_type": "VALIDATE_DATA",
                    "name": "Payload Validator",
                    "config": {},
                },
                {
                    "step_key": "approval_node",
                    "step_type": "HUMAN_APPROVAL",
                    "name": "Manager Approval",
                    "config": {},
                },
            ],
            "connections": [
                {"source_step_key": "webhook_in", "target_step_key": "val_node"},
                {"source_step_key": "val_node", "target_step_key": "approval_node"},
            ],
        },
    )

    val_resp = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/validate",
        headers=headers,
    )
    assert val_resp.status_code == 200
    res = val_resp.json()
    assert res["valid"] is False
    assert any("VALIDATE_DATA" in err for err in res["errors"])
    assert any("HUMAN_APPROVAL" in err for err in res["errors"])

    # 2. Update with valid configs -> validation passes
    await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}",
        headers=headers,
        json={
            "steps": [
                {
                    "step_key": "webhook_in",
                    "step_type": "WEBHOOK_TRIGGER",
                    "name": "Webhook In",
                    "config": {},
                },
                {
                    "step_key": "val_node",
                    "step_type": "VALIDATE_DATA",
                    "name": "Payload Validator",
                    "config": {"required_fields": ["email", "name"]},
                },
                {
                    "step_key": "approval_node",
                    "step_type": "HUMAN_APPROVAL",
                    "name": "Manager Approval",
                    "config": {"approver_role": "MANAGER", "timeout_hours": 48},
                },
            ],
            "connections": [
                {"source_step_key": "webhook_in", "target_step_key": "val_node"},
                {"source_step_key": "val_node", "target_step_key": "approval_node"},
            ],
        },
    )

    val_resp_valid = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/validate",
        headers=headers,
    )
    assert val_resp_valid.status_code == 200
    assert val_resp_valid.json()["valid"] is True


@pytest.mark.asyncio
async def test_archive_workflow_lifecycle(async_client: AsyncClient):
    org_id, headers = await create_org_and_owner(async_client, "archive_user")

    wf = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows",
            headers=headers,
            json={"name": "Archival Target Flow"},
        )
    ).json()
    wf_id = wf["id"]

    # Archive workflow (soft deletion)
    arch_resp = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/archive",
        headers=headers,
    )
    assert arch_resp.status_code == 200
    assert arch_resp.json()["status"] == "ARCHIVED"

    # Verify queryable with ?status=ARCHIVED
    list_arch = await async_client.get(
        f"/api/v1/organizations/{org_id}/workflows?status=ARCHIVED",
        headers=headers,
    )
    assert list_arch.status_code == 200
    items = list_arch.json()["items"]
    assert len(items) == 1
    assert items[0]["id"] == wf_id

    # Verify versions remain accessible
    versions_resp = await async_client.get(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions",
        headers=headers,
    )
    assert versions_resp.status_code == 200
    assert len(versions_resp.json()) >= 1
