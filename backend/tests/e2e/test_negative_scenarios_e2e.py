"""
Comprehensive Negative Failure Scenarios for FlowPilot (Phase 16).
Validates 16 distinct failure, edge-case, and security boundaries.
"""

import time
import uuid
import pytest
from httpx import AsyncClient

from app.core.ssrf import validate_outbound_url, SSRFValidationError
from app.services.webhook_service import calculate_hmac_signature


async def create_user_and_org(async_client: AsyncClient, name: str):
    unique = uuid.uuid4().hex[:8]
    email = f"{name}_{unique}@flowpilot.internal"
    password = f"SecurePass_{unique}!123"
    await async_client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "full_name": f"{name.capitalize()} User"},
    )
    login_resp = await async_client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    token = login_resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    org_resp = await async_client.post(
        "/api/v1/organizations",
        headers=headers,
        json={"name": f"{name.capitalize()} Org"},
    )
    org_id = org_resp.json()["id"]

    relogin = await async_client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password, "organization_id": org_id},
    )
    active_token = relogin.json()["access_token"]
    return org_id, {"Authorization": f"Bearer {active_token}"}


async def setup_test_workflow(async_client: AsyncClient, org_id: str, headers: dict, secret_token: str = "secret_123"):
    wf_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows",
        headers=headers,
        json={"name": "Test Workflow"},
    )
    wf_id = wf_res.json()["id"]
    webhook_key = wf_res.json()["webhook_key"]

    versions_res = await async_client.get(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions",
        headers=headers,
    )
    v1_id = versions_res.json()[0]["id"]

    await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}",
        headers=headers,
        json={
            "steps": [
                {
                    "step_key": "hook",
                    "step_type": "WEBHOOK_TRIGGER",
                    "name": "Webhook Trigger",
                    "config": {"allowed_methods": ["POST"], "secret_token": secret_token},
                },
                {
                    "step_key": "review",
                    "step_type": "HUMAN_APPROVAL",
                    "name": "Approval Review",
                    "config": {"approver_role": "OWNER"},
                },
            ],
            "connections": [
                {"source_step_key": "hook", "target_step_key": "review"},
            ],
        },
    )

    await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/publish",
        headers=headers,
    )
    return wf_id, webhook_key, v1_id


@pytest.mark.asyncio
async def test_negative_invalid_webhook_hmac_signature(async_client: AsyncClient):
    """Scenario 1: Mismatched HMAC signature returns 401."""
    org_id, headers = await create_user_and_org(async_client, "neg_sig")
    _, webhook_key, _ = await setup_test_workflow(async_client, org_id, headers)

    raw_body = b'{"data": "test"}'
    ts = str(int(time.time()))
    bad_sig = "sha256=0000000000000000000000000000000000000000000000000000000000000000"

    resp = await async_client.post(
        f"/api/v1/webhooks/{webhook_key}",
        headers={"X-Webhook-Timestamp": ts, "X-Webhook-Signature": bad_sig, "Content-Type": "application/json"},
        content=raw_body,
    )
    assert resp.status_code == 401
    assert "Invalid webhook signature" in resp.json().get("detail", "")


@pytest.mark.asyncio
async def test_negative_expired_webhook_timestamp(async_client: AsyncClient):
    """Scenario 2: Timestamp older than 300 seconds returns 401 (replay protection)."""
    org_id, headers = await create_user_and_org(async_client, "neg_replay")
    secret = "secret_123"
    _, webhook_key, _ = await setup_test_workflow(async_client, org_id, headers, secret_token=secret)

    raw_body = b'{"data": "replay"}'
    expired_ts = str(int(time.time()) - 600)  # 10 minutes ago
    sig = calculate_hmac_signature(secret, expired_ts, raw_body)

    resp = await async_client.post(
        f"/api/v1/webhooks/{webhook_key}",
        headers={"X-Webhook-Timestamp": expired_ts, "X-Webhook-Signature": sig, "Content-Type": "application/json"},
        content=raw_body,
    )
    assert resp.status_code == 401
    assert "timestamp expired" in resp.json().get("detail", "").lower()


@pytest.mark.asyncio
async def test_negative_duplicate_webhook_idempotency(async_client: AsyncClient):
    """Scenario 3: Duplicate idempotency key returns cached idempotent response."""
    org_id, headers = await create_user_and_org(async_client, "neg_idem")
    secret = "secret_123"
    _, webhook_key, _ = await setup_test_workflow(async_client, org_id, headers, secret_token=secret)

    raw_body = b'{"event": "lead.created"}'
    ts = str(int(time.time()))
    sig = calculate_hmac_signature(secret, ts, raw_body)
    idem_key = f"idem_{uuid.uuid4().hex}"

    headers_hook = {
        "X-Webhook-Timestamp": ts,
        "X-Webhook-Signature": sig,
        "Idempotency-Key": idem_key,
        "Content-Type": "application/json",
    }

    # First request
    resp1 = await async_client.post(f"/api/v1/webhooks/{webhook_key}", headers=headers_hook, content=raw_body)
    assert resp1.status_code == 200
    run_id1 = resp1.json()["workflow_run_id"]
    assert resp1.json()["idempotent"] is False

    # Second request with identical key
    resp2 = await async_client.post(f"/api/v1/webhooks/{webhook_key}", headers=headers_hook, content=raw_body)
    assert resp2.status_code == 200
    assert resp2.json()["workflow_run_id"] == run_id1
    assert resp2.json()["idempotent"] is True


@pytest.mark.asyncio
async def test_negative_oversized_webhook_payload(async_client: AsyncClient):
    """Scenario 4: Webhook body exceeding 64KB returns 413."""
    org_id, headers = await create_user_and_org(async_client, "neg_size")
    _, webhook_key, _ = await setup_test_workflow(async_client, org_id, headers)

    oversized_body = b'{"data": "' + (b"A" * 70000) + b'"}'
    resp = await async_client.post(
        f"/api/v1/webhooks/{webhook_key}",
        headers={"Content-Type": "application/json"},
        content=oversized_body,
    )
    assert resp.status_code == 413


@pytest.mark.asyncio
async def test_negative_malformed_webhook_json(async_client: AsyncClient):
    """Scenario 5: Malformed unparseable JSON returns 400."""
    org_id, headers = await create_user_and_org(async_client, "neg_json")
    secret = "secret_123"
    _, webhook_key, _ = await setup_test_workflow(async_client, org_id, headers, secret_token=secret)

    malformed = b'{this is not json}'
    ts = str(int(time.time()))
    sig = calculate_hmac_signature(secret, ts, malformed)

    resp = await async_client.post(
        f"/api/v1/webhooks/{webhook_key}",
        headers={"X-Webhook-Timestamp": ts, "X-Webhook-Signature": sig, "Content-Type": "application/json"},
        content=malformed,
    )
    assert resp.status_code == 400
    assert "Invalid JSON" in resp.json().get("detail", "")


@pytest.mark.asyncio
async def test_negative_human_approval_rejection(async_client: AsyncClient):
    """Scenario 6: Approval rejection records REJECTED state and terminates execution."""
    org_id, headers = await create_user_and_org(async_client, "neg_rej")
    secret = "secret_123"
    _, webhook_key, _ = await setup_test_workflow(async_client, org_id, headers, secret_token=secret)

    raw_body = b'{"action": "needs_review"}'
    ts = str(int(time.time()))
    sig = calculate_hmac_signature(secret, ts, raw_body)

    hook_resp = await async_client.post(
        f"/api/v1/webhooks/{webhook_key}",
        headers={"X-Webhook-Timestamp": ts, "X-Webhook-Signature": sig, "Content-Type": "application/json"},
        content=raw_body,
    )
    run_id = hook_resp.json()["workflow_run_id"]

    # Get pending approval
    pending = (await async_client.get(f"/api/v1/organizations/{org_id}/approvals?status=PENDING", headers=headers)).json()["items"]
    target_app = next(a for a in pending if str(a["workflow_run_id"]) == str(run_id))

    # Reject
    rej_resp = await async_client.post(
        f"/api/v1/organizations/{org_id}/approvals/{target_app['id']}/reject",
        headers=headers,
        json={"comment": "Rejected due to policy violation"},
    )
    assert rej_resp.status_code == 200
    assert rej_resp.json()["status"] == "REJECTED"


@pytest.mark.asyncio
async def test_negative_unauthorized_approval_attempt(async_client: AsyncClient):
    """Scenario 7: Member with VIEWER role attempting approval action returns 403."""
    org_id, owner_headers = await create_user_and_org(async_client, "neg_role_owner")
    secret = "secret_123"
    _, webhook_key, _ = await setup_test_workflow(async_client, org_id, owner_headers, secret_token=secret)

    # Create a VIEWER member in the same org
    viewer_email = f"viewer_{uuid.uuid4().hex[:8]}@flowpilot.internal"
    pwd = "ViewerPass_123!"
    await async_client.post("/api/v1/auth/register", json={"email": viewer_email, "password": pwd, "full_name": "Viewer User"})
    v_login = await async_client.post("/api/v1/auth/login", json={"email": viewer_email, "password": pwd})
    viewer_user_id = v_login.json()["access_token"]

    # Add viewer to org
    from app.models.membership import OrganizationRole
    await async_client.post(
        f"/api/v1/organizations/{org_id}/members",
        headers=owner_headers,
        json={"email": viewer_email, "role": OrganizationRole.VIEWER.value},
    )

    # Login as viewer
    v_active = await async_client.post("/api/v1/auth/login", json={"email": viewer_email, "password": pwd, "organization_id": org_id})
    viewer_headers = {"Authorization": f"Bearer {v_active.json()['access_token']}"}

    # Trigger a run
    raw_body = b'{"data": "review"}'
    ts = str(int(time.time()))
    sig = calculate_hmac_signature(secret, ts, raw_body)
    hook_res = await async_client.post(
        f"/api/v1/webhooks/{webhook_key}",
        headers={"X-Webhook-Timestamp": ts, "X-Webhook-Signature": sig, "Content-Type": "application/json"},
        content=raw_body,
    )
    run_id = hook_res.json()["workflow_run_id"]

    pending = (await async_client.get(f"/api/v1/organizations/{org_id}/approvals?status=PENDING", headers=owner_headers)).json()["items"]
    target_app = next(a for a in pending if str(a["workflow_run_id"]) == str(run_id))

    # Viewer tries to approve
    act_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/approvals/{target_app['id']}/approve",
        headers=viewer_headers,
        json={"comment": "Unauthorized approve"},
    )
    assert act_res.status_code == 403


@pytest.mark.asyncio
async def test_negative_cross_tenant_run_query(async_client: AsyncClient):
    """Scenario 8: Tenant B requesting Tenant A's run returns 404."""
    org_a, headers_a = await create_user_and_org(async_client, "tenant_a")
    org_b, headers_b = await create_user_and_org(async_client, "tenant_b")

    _, webhook_key, _ = await setup_test_workflow(async_client, org_a, headers_a)

    raw_body = b'{"event": "start"}'
    ts = str(int(time.time()))
    sig = calculate_hmac_signature("secret_123", ts, raw_body)
    hook = await async_client.post(
        f"/api/v1/webhooks/{webhook_key}",
        headers={"X-Webhook-Timestamp": ts, "X-Webhook-Signature": sig, "Content-Type": "application/json"},
        content=raw_body,
    )
    run_id = hook.json()["workflow_run_id"]

    # Tenant B queries Tenant A's run
    resp = await async_client.get(f"/api/v1/organizations/{org_b}/runs/{run_id}", headers=headers_b)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_negative_draft_sla_update_on_published_version(async_client: AsyncClient):
    """Scenario 9: Attempting PUT /sla on a PUBLISHED version returns 400."""
    org_id, headers = await create_user_and_org(async_client, "neg_sla_pub")
    wf_id, _, v1_id = await setup_test_workflow(async_client, org_id, headers)

    resp = await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/sla",
        headers=headers,
        json={"target_seconds": 30.0, "warning_threshold_seconds": 20.0, "enabled": True},
    )
    assert resp.status_code == 400
    assert "immutable" in resp.json().get("detail", "").lower()


@pytest.mark.asyncio
async def test_negative_invalid_sla_threshold_configuration(async_client: AsyncClient):
    """Scenario 10: Setting warning_threshold >= target_seconds returns 422."""
    org_id, headers = await create_user_and_org(async_client, "neg_sla_val")
    wf_res = await async_client.post(f"/api/v1/organizations/{org_id}/workflows", headers=headers, json={"name": "SLA Val"})
    wf_id = wf_res.json()["id"]
    v1_id = (await async_client.get(f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions", headers=headers)).json()[0]["id"]

    # warning >= target
    resp = await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/sla",
        headers=headers,
        json={"target_seconds": 30.0, "warning_threshold_seconds": 35.0, "enabled": True},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_negative_in_flight_run_cancellation(async_client: AsyncClient):
    """Scenario 11: Active run can be cancelled via POST /runs/{id}/cancel."""
    org_id, headers = await create_user_and_org(async_client, "neg_cancel")
    secret = "secret_123"
    _, webhook_key, _ = await setup_test_workflow(async_client, org_id, headers, secret_token=secret)

    raw_body = b'{"task": "cancel_me"}'
    ts = str(int(time.time()))
    sig = calculate_hmac_signature(secret, ts, raw_body)
    hook = await async_client.post(
        f"/api/v1/webhooks/{webhook_key}",
        headers={"X-Webhook-Timestamp": ts, "X-Webhook-Signature": sig, "Content-Type": "application/json"},
        content=raw_body,
    )
    run_id = hook.json()["workflow_run_id"]

    # Cancel the run
    cancel_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/runs/{run_id}/cancel",
        headers=headers,
    )
    assert cancel_res.status_code == 200
    assert cancel_res.json()["status"] == "CANCELLED"


def test_negative_ssrf_validator_blocks_private_ip():
    """Scenario 12: SSRF validator blocks attempt to connect to loopback or cloud metadata IPs."""
    with pytest.raises(SSRFValidationError):
        validate_outbound_url("http://127.0.0.1:8080/internal")

    with pytest.raises(SSRFValidationError):
        validate_outbound_url("http://169.254.169.254/latest/meta-data/")

    with pytest.raises(SSRFValidationError):
        validate_outbound_url("http://10.0.0.1/admin")


@pytest.mark.asyncio
async def test_negative_malformed_jwt_token(async_client: AsyncClient):
    """Scenario 13: Malformed authorization header returns 401."""
    resp = await async_client.get(
        "/api/v1/auth/me",
        headers={"Authorization": "Bearer not.a.valid.jwt.token"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_negative_missing_webhook_body(async_client: AsyncClient):
    """Scenario 14: Non-object JSON payload returns 400."""
    org_id, headers = await create_user_and_org(async_client, "neg_empty")
    _, webhook_key, _ = await setup_test_workflow(async_client, org_id, headers)

    raw_body = b'["item1", "item2"]'
    ts = str(int(time.time()))
    sig = calculate_hmac_signature("secret_123", ts, raw_body)

    resp = await async_client.post(
        f"/api/v1/webhooks/{webhook_key}",
        headers={
            "X-Webhook-Timestamp": ts,
            "X-Webhook-Signature": sig,
            "Content-Type": "application/json",
        },
        content=raw_body,
    )
    assert resp.status_code == 400
    assert "Payload must be a JSON object" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_negative_step_limit_clamping_in_analytics(async_client: AsyncClient):
    """Scenario 15: Requesting limit=500 in step analytics clamps gracefully without 422 error."""
    org_id, headers = await create_user_and_org(async_client, "neg_clamp")
    resp = await async_client.get(
        f"/api/v1/organizations/{org_id}/analytics/steps?limit=500",
        headers=headers,
    )
    assert resp.status_code == 200
    assert len(resp.json()) <= 100


@pytest.mark.asyncio
async def test_negative_date_range_inverted_rejected(async_client: AsyncClient):
    """Scenario 16: Requesting analytics with start_time > end_time returns 400."""
    org_id, headers = await create_user_and_org(async_client, "neg_dates")
    resp = await async_client.get(
        f"/api/v1/organizations/{org_id}/analytics/overview?range=custom&start_time=2026-09-24T12:00:00Z&end_time=2026-09-20T12:00:00Z",
        headers=headers,
    )
    assert resp.status_code == 400
    assert "start_time must be strictly before end_time" in resp.json().get("detail", "")
