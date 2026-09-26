import uuid
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_register_success(async_client: AsyncClient):
    unique_email = f"test_{uuid.uuid4().hex[:8]}@flowpilot.internal"
    payload = {
        "email": unique_email,
        "password": "SecurePassword123!",
        "full_name": "Test User",
        "organization_name": "Test Org",
    }
    resp = await async_client.post("/api/v1/auth/register", json=payload)
    assert resp.status_code == 201
    data = resp.json()
    assert data["email"] == unique_email
    assert data["full_name"] == "Test User"
    assert "password_hash" not in data
    assert "id" in data


@pytest.mark.asyncio
async def test_register_duplicate_email(async_client: AsyncClient):
    unique_email = f"dup_{uuid.uuid4().hex[:8]}@flowpilot.internal"
    payload = {
        "email": unique_email,
        "password": "SecurePassword123!",
        "full_name": "First User",
    }
    resp1 = await async_client.post("/api/v1/auth/register", json=payload)
    assert resp1.status_code == 201

    resp2 = await async_client.post("/api/v1/auth/register", json=payload)
    assert resp2.status_code == 409
    assert "already exists" in resp2.json()["detail"]


@pytest.mark.asyncio
async def test_register_weak_password_validation(async_client: AsyncClient):
    payload = {
        "email": "weak@flowpilot.internal",
        "password": "weak",
        "full_name": "Weak Password User",
    }
    resp = await async_client.post("/api/v1/auth/register", json=payload)
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_login_success_and_invalid_credentials(async_client: AsyncClient):
    email = f"login_{uuid.uuid4().hex[:8]}@flowpilot.internal"
    password = "CorrectPassword123!"
    reg_payload = {
        "email": email,
        "password": password,
        "full_name": "Login User",
        "organization_name": "Acme Login Corp",
    }
    reg_resp = await async_client.post("/api/v1/auth/register", json=reg_payload)
    assert reg_resp.status_code == 201

    # Successful login
    login_resp = await async_client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert login_resp.status_code == 200
    tokens = login_resp.json()
    assert "access_token" in tokens
    assert "refresh_token" in tokens
    assert tokens["token_type"] == "bearer"
    assert tokens["expires_in"] == 1800

    # Invalid password
    bad_pass_resp = await async_client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "WrongPassword123!"},
    )
    assert bad_pass_resp.status_code == 401
    assert bad_pass_resp.json()["detail"] == "Invalid email or password"

    # Non-existent email
    bad_email_resp = await async_client.post(
        "/api/v1/auth/login",
        json={"email": "nonexistent@flowpilot.internal", "password": password},
    )
    assert bad_email_resp.status_code == 401
    assert bad_email_resp.json()["detail"] == "Invalid email or password"


@pytest.mark.asyncio
async def test_auth_me_endpoint(async_client: AsyncClient):
    email = f"me_{uuid.uuid4().hex[:8]}@flowpilot.internal"
    password = "MeSecurePassword123!"
    reg_payload = {
        "email": email,
        "password": password,
        "full_name": "Me User",
        "organization_name": "Me Org",
    }
    await async_client.post("/api/v1/auth/register", json=reg_payload)
    login_resp = await async_client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )
    access_token = login_resp.json()["access_token"]

    # Authenticated request
    resp = await async_client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["user"]["email"] == email
    assert len(data["organizations"]) >= 1
    assert data["organizations"][0]["role"] == "OWNER"
    assert data["active_role"] == "OWNER"

    # Unauthenticated request
    unauth_resp = await async_client.get("/api/v1/auth/me")
    assert unauth_resp.status_code == 401


@pytest.mark.asyncio
async def test_refresh_token_rotation_and_replay_prevention(async_client: AsyncClient):
    email = f"refresh_{uuid.uuid4().hex[:8]}@flowpilot.internal"
    password = "RefreshPassword123!"
    await async_client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "full_name": "Refresh User"},
    )
    login_resp = await async_client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )
    tokens = login_resp.json()
    old_refresh_token = tokens["refresh_token"]

    # First refresh: succeeds and rotates
    ref_resp = await async_client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": old_refresh_token},
    )
    assert ref_resp.status_code == 200
    new_tokens = ref_resp.json()
    assert "access_token" in new_tokens
    new_refresh_token = new_tokens["refresh_token"]
    assert new_refresh_token != old_refresh_token

    # Replay attack: using the old refresh token again MUST fail
    replay_resp = await async_client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": old_refresh_token},
    )
    assert replay_resp.status_code == 401
    assert "Invalid or revoked refresh token" in replay_resp.json()["detail"]


@pytest.mark.asyncio
async def test_logout_revocation(async_client: AsyncClient):
    email = f"logout_{uuid.uuid4().hex[:8]}@flowpilot.internal"
    password = "LogoutPassword123!"
    await async_client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "full_name": "Logout User"},
    )
    login_resp = await async_client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )
    tokens = login_resp.json()
    access_token = tokens["access_token"]
    refresh_token = tokens["refresh_token"]

    # Verify access token works initially
    me_resp = await async_client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    assert me_resp.status_code == 200

    # Logout
    logout_resp = await async_client.post(
        "/api/v1/auth/logout",
        headers={"Authorization": f"Bearer {access_token}"},
        json={"refresh_token": refresh_token},
    )
    assert logout_resp.status_code == 200

    # Verify access token is now blacklisted/revoked
    me_after_resp = await async_client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    assert me_after_resp.status_code == 401
    assert "Token has been revoked" in me_after_resp.json()["detail"]

    # Verify refresh token is also revoked
    ref_resp = await async_client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": refresh_token},
    )
    assert ref_resp.status_code == 401
