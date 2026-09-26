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


@pytest.mark.asyncio
async def test_create_organization_assigns_owner(async_client: AsyncClient):
    _, headers = await create_authenticated_user(async_client, "alice")
    resp = await async_client.post(
        "/api/v1/organizations",
        headers=headers,
        json={"name": "Alice Enterprise Corp"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Alice Enterprise Corp"
    assert data["role"] == "OWNER"
    assert data["member_count"] == 1
    assert "slug" in data


@pytest.mark.asyncio
async def test_list_organizations_tenant_scoped(async_client: AsyncClient):
    # Alice creates 2 orgs
    _, alice_headers = await create_authenticated_user(async_client, "alice_list")
    resp1 = await async_client.post(
        "/api/v1/organizations",
        headers=alice_headers,
        json={"name": "Alice Org 1"},
    )
    resp2 = await async_client.post(
        "/api/v1/organizations",
        headers=alice_headers,
        json={"name": "Alice Org 2"},
    )
    assert resp1.status_code == 201
    assert resp2.status_code == 201

    # Bob creates 1 org
    _, bob_headers = await create_authenticated_user(async_client, "bob_list")
    resp_bob = await async_client.post(
        "/api/v1/organizations",
        headers=bob_headers,
        json={"name": "Bob Org Solo"},
    )
    assert resp_bob.status_code == 201

    # Alice lists organizations: must only see Alice's orgs
    alice_list = await async_client.get("/api/v1/organizations", headers=alice_headers)
    assert alice_list.status_code == 200
    alice_org_names = [o["name"] for o in alice_list.json()]
    assert "Alice Org 1" in alice_org_names
    assert "Alice Org 2" in alice_org_names
    assert "Bob Org Solo" not in alice_org_names

    # Bob lists organizations: must only see Bob's org
    bob_list = await async_client.get("/api/v1/organizations", headers=bob_headers)
    assert bob_list.status_code == 200
    bob_org_names = [o["name"] for o in bob_list.json()]
    assert "Bob Org Solo" in bob_org_names
    assert "Alice Org 1" not in bob_org_names


@pytest.mark.asyncio
async def test_cross_tenant_access_returns_404(async_client: AsyncClient):
    """
    Proves that a user from Tenant A cannot access Tenant B's organization.
    Must return 404 rather than 403 to prevent resource enumeration.
    """
    _, tenant_a_headers = await create_authenticated_user(async_client, "tenant_a")
    resp_a = await async_client.post(
        "/api/v1/organizations",
        headers=tenant_a_headers,
        json={"name": "Tenant A Secret Org"},
    )
    org_a_id = resp_a.json()["id"]

    _, tenant_b_headers = await create_authenticated_user(async_client, "tenant_b")

    # Tenant B tries to inspect Tenant A's organization
    cross_resp = await async_client.get(
        f"/api/v1/organizations/{org_a_id}",
        headers=tenant_b_headers,
    )
    assert cross_resp.status_code == 404
    assert cross_resp.json()["detail"] == "Organization not found"


@pytest.mark.asyncio
async def test_add_member_and_duplicate_prevention(async_client: AsyncClient):
    _, owner_headers = await create_authenticated_user(async_client, "owner")
    org_resp = await async_client.post(
        "/api/v1/organizations",
        headers=owner_headers,
        json={"name": "Collaborative Org"},
    )
    org_id = org_resp.json()["id"]

    collab_email, _ = await create_authenticated_user(async_client, "collab_user")

    # Owner adds collab_user as MANAGER
    add_resp = await async_client.post(
        f"/api/v1/organizations/{org_id}/members",
        headers=owner_headers,
        json={"email": collab_email, "role": "MANAGER"},
    )
    assert add_resp.status_code == 201
    member_data = add_resp.json()
    assert member_data["email"] == collab_email
    assert member_data["role"] == "MANAGER"

    # Duplicate membership attempt must fail with 409 Conflict
    dup_resp = await async_client.post(
        f"/api/v1/organizations/{org_id}/members",
        headers=owner_headers,
        json={"email": collab_email, "role": "OPERATOR"},
    )
    assert dup_resp.status_code == 409
    assert "already a member" in dup_resp.json()["detail"]


@pytest.mark.asyncio
async def test_add_nonexistent_member_returns_404(async_client: AsyncClient):
    _, owner_headers = await create_authenticated_user(async_client, "org_owner")
    org_resp = await async_client.post(
        "/api/v1/organizations",
        headers=owner_headers,
        json={"name": "Invite Org"},
    )
    org_id = org_resp.json()["id"]

    resp = await async_client.post(
        f"/api/v1/organizations/{org_id}/members",
        headers=owner_headers,
        json={"email": "nobody_exists@flowpilot.internal", "role": "VIEWER"},
    )
    assert resp.status_code == 404
    assert "User not found" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_rbac_admin_and_viewer_restrictions(async_client: AsyncClient):
    # 1. Owner creates organization
    _, owner_headers = await create_authenticated_user(async_client, "corp_owner")
    org_resp = await async_client.post(
        "/api/v1/organizations",
        headers=owner_headers,
        json={"name": "RBAC Corp"},
    )
    org_id = org_resp.json()["id"]

    # 2. Add an Admin and a Viewer
    admin_email, admin_headers = await create_authenticated_user(async_client, "corp_admin")
    viewer_email, viewer_headers = await create_authenticated_user(async_client, "corp_viewer")
    newbie_email, _ = await create_authenticated_user(async_client, "corp_newbie")

    await async_client.post(
        f"/api/v1/organizations/{org_id}/members",
        headers=owner_headers,
        json={"email": admin_email, "role": "ADMIN"},
    )
    await async_client.post(
        f"/api/v1/organizations/{org_id}/members",
        headers=owner_headers,
        json={"email": viewer_email, "role": "VIEWER"},
    )

    # 3. Viewer attempts to add a member -> MUST fail with 403 Forbidden
    viewer_add = await async_client.post(
        f"/api/v1/organizations/{org_id}/members",
        headers=viewer_headers,
        json={"email": newbie_email, "role": "OPERATOR"},
    )
    assert viewer_add.status_code == 403

    # 4. Admin attempts to grant OWNER role -> MUST fail with 403 Forbidden
    admin_grant_owner = await async_client.post(
        f"/api/v1/organizations/{org_id}/members",
        headers=admin_headers,
        json={"email": newbie_email, "role": "OWNER"},
    )
    assert admin_grant_owner.status_code == 403
    assert "Admins cannot grant owner privileges" in admin_grant_owner.json()["detail"]

    # 5. Admin can add newbie as OPERATOR -> Success
    admin_add_op = await async_client.post(
        f"/api/v1/organizations/{org_id}/members",
        headers=admin_headers,
        json={"email": newbie_email, "role": "OPERATOR"},
    )
    assert admin_add_op.status_code == 201


@pytest.mark.asyncio
async def test_member_removal_rules(async_client: AsyncClient):
    owner_email, owner_headers = await create_authenticated_user(async_client, "del_owner")
    org_resp = await async_client.post(
        "/api/v1/organizations",
        headers=owner_headers,
        json={"name": "Removal Org"},
    )
    org_id = org_resp.json()["id"]

    # Get owner user_id
    me_resp = await async_client.get("/api/v1/auth/me", headers=owner_headers)
    owner_user_id = me_resp.json()["user"]["id"]

    admin_email, admin_headers = await create_authenticated_user(async_client, "del_admin")
    member_email, _ = await create_authenticated_user(async_client, "del_member")

    admin_member_resp = await async_client.post(
        f"/api/v1/organizations/{org_id}/members",
        headers=owner_headers,
        json={"email": admin_email, "role": "ADMIN"},
    )
    admin_user_id = admin_member_resp.json()["user_id"]

    norm_member_resp = await async_client.post(
        f"/api/v1/organizations/{org_id}/members",
        headers=owner_headers,
        json={"email": member_email, "role": "OPERATOR"},
    )
    norm_user_id = norm_member_resp.json()["user_id"]

    # 1. Owner cannot remove themselves when they are the only owner (400)
    del_last_owner = await async_client.delete(
        f"/api/v1/organizations/{org_id}/members/{owner_user_id}",
        headers=owner_headers,
    )
    assert del_last_owner.status_code == 400
    assert "Cannot remove the only owner" in del_last_owner.json()["detail"]

    # 2. Admin cannot remove Owner (403)
    admin_del_owner = await async_client.delete(
        f"/api/v1/organizations/{org_id}/members/{owner_user_id}",
        headers=admin_headers,
    )
    assert admin_del_owner.status_code == 403
    assert "Admins cannot remove an organization owner" in admin_del_owner.json()["detail"]

    # 3. Owner can remove normal member (200)
    del_member_resp = await async_client.delete(
        f"/api/v1/organizations/{org_id}/members/{norm_user_id}",
        headers=owner_headers,
    )
    assert del_member_resp.status_code == 200
    assert del_member_resp.json()["message"] == "Member removed successfully"
