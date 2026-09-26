import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import Dict, Optional

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings
from app.models.audit_log import AuditLog
from app.services.webhook_service import calculate_hmac_signature


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


async def setup_webhook_workflow(
    async_client: AsyncClient,
    org_id: str,
    headers: dict,
    secret_token: Optional[str] = "webhook_secret_key_123",
    fail_validation: bool = False,
    is_active: bool = True,
):
    wf = (
        await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows",
            headers=headers,
            json={"name": "Inbound Webhook Pipeline"},
        )
    ).json()
    wf_id = wf["id"]
    webhook_key = wf["webhook_key"]
    v1_id = (
        await async_client.get(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions",
            headers=headers,
        )
    ).json()[0]["id"]

    req_fields = ["email", "fail_key"] if fail_validation else ["email"]

    config = {"allowed_methods": ["POST"]}
    if secret_token is not None:
        config["secret_token"] = secret_token

    await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}",
        headers=headers,
        json={
            "steps": [
                {
                    "step_key": "inbound_hook",
                    "step_type": "WEBHOOK_TRIGGER",
                    "name": "Webhook Trigger",
                    "config": config,
                },
                {
                    "step_key": "validate_payload",
                    "step_type": "VALIDATE_DATA",
                    "name": "Validate Lead",
                    "config": {"required_fields": req_fields},
                },
            ],
            "connections": [
                {
                    "source_step_key": "inbound_hook",
                    "target_step_key": "validate_payload",
                },
            ],
        },
    )

    if is_active:
        pub_res = await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/publish",
            headers=headers,
        )
        assert pub_res.status_code == 200

    return wf_id, webhook_key, v1_id


def make_webhook_headers(
    secret_token: str,
    raw_body: bytes,
    timestamp: Optional[float] = None,
    idempotency_key: Optional[str] = None,
    correlation_id: Optional[str] = None,
    signature_override: Optional[str] = None,
    timestamp_override: Optional[str] = None,
) -> Dict[str, str]:
    if timestamp_override is not None:
        ts = timestamp_override
    else:
        ts = str(int(timestamp if timestamp is not None else datetime.now(timezone.utc).timestamp()))

    if signature_override is not None:
        sig = signature_override
    else:
        sig = calculate_hmac_signature(secret_token, ts, raw_body)

    headers = {
        "Content-Type": "application/json",
        "X-Webhook-Timestamp": ts,
        "X-Webhook-Signature": sig,
    }
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    if correlation_id:
        headers["X-Correlation-ID"] = correlation_id
    return headers


# ==============================================================================
# 1. Ingestion & HMAC Signature Verification
# ==============================================================================

@pytest.mark.asyncio
async def test_valid_signed_webhook_triggers_execution(async_client: AsyncClient):
    """Valid HMAC signature and timestamp trigger workflow execution successfully."""
    org_id, headers = await create_org_and_owner(async_client, "wb_success")
    secret = "secret_valid_123"
    wf_id, webhook_key, _ = await setup_webhook_workflow(
        async_client, org_id, headers, secret_token=secret
    )

    raw_body = json.dumps({"email": "lead@test.com"}).encode("utf-8")
    webhook_headers = make_webhook_headers(secret, raw_body)

    resp = await async_client.post(
        f"/api/v1/webhooks/{webhook_key}",
        content=raw_body,
        headers=webhook_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "COMPLETED"
    assert data["idempotent"] is False
    assert data["workflow_id"] == wf_id
    assert "workflow_run_id" in data
    assert "correlation_id" in data


@pytest.mark.asyncio
async def test_public_webhook_rejects_unsigned(async_client: AsyncClient):
    """Public webhook route rejects requests without signature header with HTTP 401."""
    org_id, headers = await create_org_and_owner(async_client, "wb_unsigned")
    secret = "secret_unsigned_123"
    wf_id, webhook_key, _ = await setup_webhook_workflow(
        async_client, org_id, headers, secret_token=secret
    )

    raw_body = json.dumps({"email": "lead@test.com"}).encode("utf-8")
    ts = str(int(datetime.now(timezone.utc).timestamp()))

    # Missing signature header
    resp = await async_client.post(
        f"/api/v1/webhooks/{webhook_key}",
        content=raw_body,
        headers={"Content-Type": "application/json", "X-Webhook-Timestamp": ts},
    )
    assert resp.status_code == 401
    assert "Missing signature header" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_public_webhook_rejects_invalid_hmac(async_client: AsyncClient):
    """Public webhook route rejects invalid HMAC signatures with HTTP 401."""
    org_id, headers = await create_org_and_owner(async_client, "wb_invalid_sig")
    secret = "secret_valid_456"
    wf_id, webhook_key, _ = await setup_webhook_workflow(
        async_client, org_id, headers, secret_token=secret
    )

    raw_body = json.dumps({"email": "lead@test.com"}).encode("utf-8")
    wrong_sig = "sha256=" + "a" * 64
    webhook_headers = make_webhook_headers(secret, raw_body, signature_override=wrong_sig)

    resp = await async_client.post(
        f"/api/v1/webhooks/{webhook_key}",
        content=raw_body,
        headers=webhook_headers,
    )
    assert resp.status_code == 401
    assert "Invalid webhook signature" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_public_webhook_rejects_malformed_signature_format(async_client: AsyncClient):
    """Signatures without sha256= prefix or non-hex return HTTP 401."""
    org_id, headers = await create_org_and_owner(async_client, "wb_malformed_sig")
    secret = "secret_malformed_123"
    wf_id, webhook_key, _ = await setup_webhook_workflow(
        async_client, org_id, headers, secret_token=secret
    )

    raw_body = json.dumps({"email": "lead@test.com"}).encode("utf-8")

    # Missing prefix
    resp = await async_client.post(
        f"/api/v1/webhooks/{webhook_key}",
        content=raw_body,
        headers=make_webhook_headers(secret, raw_body, signature_override="notsha256"),
    )
    assert resp.status_code == 401

    # Invalid hex
    resp2 = await async_client.post(
        f"/api/v1/webhooks/{webhook_key}",
        content=raw_body,
        headers=make_webhook_headers(secret, raw_body, signature_override="sha256=invalid_hex_string_xyz"),
    )
    assert resp2.status_code == 401


@pytest.mark.asyncio
async def test_public_webhook_rejects_missing_and_expired_timestamp(async_client: AsyncClient):
    """Missing or expired (>300s) timestamps return HTTP 401."""
    org_id, headers = await create_org_and_owner(async_client, "wb_replay")
    secret = "secret_replay_123"
    wf_id, webhook_key, _ = await setup_webhook_workflow(
        async_client, org_id, headers, secret_token=secret
    )

    raw_body = json.dumps({"email": "lead@test.com"}).encode("utf-8")

    # 1. Missing timestamp header
    sig = calculate_hmac_signature(secret, "12345", raw_body)
    resp_missing = await async_client.post(
        f"/api/v1/webhooks/{webhook_key}",
        content=raw_body,
        headers={"Content-Type": "application/json", "X-Webhook-Signature": sig},
    )
    assert resp_missing.status_code == 401
    assert "Missing required X-Webhook-Timestamp header" in resp_missing.json()["detail"]

    # 2. Expired timestamp (>300s in past)
    old_ts = datetime.now(timezone.utc).timestamp() - 350
    headers_expired = make_webhook_headers(secret, raw_body, timestamp=old_ts)
    resp_expired = await async_client.post(
        f"/api/v1/webhooks/{webhook_key}",
        content=raw_body,
        headers=headers_expired,
    )
    assert resp_expired.status_code == 401
    assert "Webhook timestamp expired" in resp_expired.json()["detail"]

    # 3. Future timestamp (>300s in future)
    future_ts = datetime.now(timezone.utc).timestamp() + 350
    headers_future = make_webhook_headers(secret, raw_body, timestamp=future_ts)
    resp_future = await async_client.post(
        f"/api/v1/webhooks/{webhook_key}",
        content=raw_body,
        headers=headers_future,
    )
    assert resp_future.status_code == 401
    assert "Webhook timestamp skewed into the future" in resp_future.json()["detail"]


@pytest.mark.asyncio
async def test_public_webhook_invalid_webhook_key_404(async_client: AsyncClient):
    """Non-existent webhook_key returns HTTP 404."""
    resp = await async_client.post(
        "/api/v1/webhooks/non_existent_webhook_key_99999",
        content=b"{}",
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 404
    assert "Webhook endpoint not found" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_public_webhook_inactive_or_draft_workflow_400(async_client: AsyncClient):
    """Unpublished/draft workflow rejects public webhooks with HTTP 400."""
    org_id, headers = await create_org_and_owner(async_client, "wb_draft")
    secret = "secret_draft_123"
    wf_id, webhook_key, _ = await setup_webhook_workflow(
        async_client, org_id, headers, secret_token=secret, is_active=False
    )

    raw_body = json.dumps({"email": "draft@test.com"}).encode("utf-8")
    webhook_headers = make_webhook_headers(secret, raw_body)

    resp = await async_client.post(
        f"/api/v1/webhooks/{webhook_key}",
        content=raw_body,
        headers=webhook_headers,
    )
    assert resp.status_code == 400
    assert "Workflow is not in ACTIVE status" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_public_webhook_no_secret_configured_403(async_client: AsyncClient):
    """Workflow with no secret_token in its WEBHOOK_TRIGGER configuration returns HTTP 403."""
    org_id, headers = await create_org_and_owner(async_client, "wb_no_secret")
    wf_id, webhook_key, _ = await setup_webhook_workflow(
        async_client, org_id, headers, secret_token=None
    )

    raw_body = json.dumps({"email": "test@test.com"}).encode("utf-8")
    ts = str(int(datetime.now(timezone.utc).timestamp()))
    resp = await async_client.post(
        f"/api/v1/webhooks/{webhook_key}",
        content=raw_body,
        headers={
            "Content-Type": "application/json",
            "X-Webhook-Timestamp": ts,
            "X-Webhook-Signature": "sha256=" + "0" * 64,
        },
    )
    assert resp.status_code == 403
    assert "Webhook signing secret is not configured" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_public_webhook_oversized_payload_413(async_client: AsyncClient):
    """Payloads exceeding 64KB are rejected immediately with HTTP 413 Payload Too Large."""
    oversized_body = b"a" * (65536 + 1)
    resp = await async_client.post(
        "/api/v1/webhooks/any_key",
        content=oversized_body,
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 413
    assert "Payload exceeds maximum limit" in resp.json()["detail"]


# ==============================================================================
# 2. Idempotency & Concurrency Serialization
# ==============================================================================

@pytest.mark.asyncio
async def test_idempotency_repeated_identical_request_returns_original_run(
    async_client: AsyncClient,
):
    """Repeated request with same Idempotency-Key returns original run with idempotent: True."""
    org_id, headers = await create_org_and_owner(async_client, "wb_idem_repeat")
    secret = "secret_idem_123"
    wf_id, webhook_key, _ = await setup_webhook_workflow(
        async_client, org_id, headers, secret_token=secret
    )

    raw_body = json.dumps({"email": "repeat@example.com"}).encode("utf-8")
    idemp_key = f"repeat_key_{uuid.uuid4().hex}"
    webhook_headers = make_webhook_headers(secret, raw_body, idempotency_key=idemp_key)

    # First request
    res1 = await async_client.post(
        f"/api/v1/webhooks/{webhook_key}",
        content=raw_body,
        headers=webhook_headers,
    )
    assert res1.status_code == 200
    data1 = res1.json()
    assert data1["idempotent"] is False
    assert data1["status"] == "COMPLETED"
    run_id1 = data1["workflow_run_id"]

    # Second request with identical Idempotency-Key
    res2 = await async_client.post(
        f"/api/v1/webhooks/{webhook_key}",
        content=raw_body,
        headers=webhook_headers,
    )
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["idempotent"] is True
    assert data2["workflow_run_id"] == run_id1


@pytest.mark.asyncio
async def test_idempotency_concurrent_requests_serialize_and_execute_dag_once(
    async_client: AsyncClient,
):
    """
    Concurrent requests with identical Idempotency-Key serialize safely via savepoint.
    Only one request obtains execution ownership (idempotent: False) and initiates DAG traversal.
    Duplicate requests return idempotent: True and never initiate a second traversal.
    """
    org_id, headers = await create_org_and_owner(async_client, "wb_concurrent")
    secret = "secret_concurrent_789"
    wf_id, webhook_key, _ = await setup_webhook_workflow(
        async_client, org_id, headers, secret_token=secret
    )

    raw_body = json.dumps({"email": "concurrent@example.com"}).encode("utf-8")
    idemp_key = f"concurrent_key_{uuid.uuid4().hex}"
    webhook_headers = make_webhook_headers(secret, raw_body, idempotency_key=idemp_key)

    # Launch 5 concurrent requests
    tasks = [
        async_client.post(
            f"/api/v1/webhooks/{webhook_key}",
            content=raw_body,
            headers=webhook_headers,
        )
        for _ in range(5)
    ]
    responses = await asyncio.gather(*tasks)

    for r in responses:
        assert r.status_code == 200

    results = [r.json() for r in responses]
    run_ids = {res["workflow_run_id"] for res in results}
    assert len(run_ids) == 1, "All responses must point to the same unique workflow run"

    winners = [res for res in results if res["idempotent"] is False]
    duplicates = [res for res in results if res["idempotent"] is True]

    assert len(winners) == 1, "Exactly one request must obtain execution ownership"
    assert len(duplicates) == 4, "All 4 duplicates must be identified as idempotent"


@pytest.mark.asyncio
async def test_idempotency_preserves_failed_run_no_retry(async_client: AsyncClient):
    """
    Idempotency preserves a failed workflow run.
    Subsequent duplicate requests return status: FAILED and do not create a retry run.
    """
    org_id, headers = await create_org_and_owner(async_client, "wb_fail_idem")
    secret = "secret_fail_idem"
    # Workflow configured with fail_validation=True (requires 'fail_key')
    wf_id, webhook_key, _ = await setup_webhook_workflow(
        async_client, org_id, headers, secret_token=secret, fail_validation=True
    )

    # Payload missing 'fail_key' -> causes validation step failure
    raw_body = json.dumps({"email": "fail@example.com"}).encode("utf-8")
    idemp_key = f"fail_idem_key_{uuid.uuid4().hex}"
    webhook_headers = make_webhook_headers(secret, raw_body, idempotency_key=idemp_key)

    # First request: fails
    res1 = await async_client.post(
        f"/api/v1/webhooks/{webhook_key}",
        content=raw_body,
        headers=webhook_headers,
    )
    assert res1.status_code == 200
    data1 = res1.json()
    assert data1["status"] == "FAILED"
    assert data1["idempotent"] is False
    run_id1 = data1["workflow_run_id"]

    # Duplicate request: returns original FAILED run
    res2 = await async_client.post(
        f"/api/v1/webhooks/{webhook_key}",
        content=raw_body,
        headers=webhook_headers,
    )
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["status"] == "FAILED"
    assert data2["idempotent"] is True
    assert data2["workflow_run_id"] == run_id1

    # Verify only 1 run exists in total for this workflow
    runs_res = await async_client.get(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/runs",
        headers=headers,
    )
    assert runs_res.status_code == 200
    assert runs_res.json()["total"] == 1


# ==============================================================================
# 3. Key Rotation & Audit Logging
# ==============================================================================

@pytest.mark.asyncio
async def test_webhook_key_rotation_invalidates_old_and_activates_new(
    async_client: AsyncClient,
):
    """
    Key rotation atomically updates workflow.webhook_key.
    Old key immediately returns HTTP 404. New key succeeds.
    """
    org_id, headers = await create_org_and_owner(async_client, "wb_rotate")
    secret = "secret_rotate_123"
    wf_id, old_key, _ = await setup_webhook_workflow(
        async_client, org_id, headers, secret_token=secret
    )

    # Rotate key
    rot_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/webhook/rotate-key",
        headers=headers,
    )
    assert rot_res.status_code == 200
    rot_data = rot_res.json()
    new_key = rot_data["webhook_key"]
    assert new_key != old_key
    assert rot_data["webhook_url"] == f"/api/v1/webhooks/{new_key}"

    raw_body = json.dumps({"email": "rotate_test@example.com"}).encode("utf-8")

    # 1. Calling old key returns 404
    old_headers = make_webhook_headers(secret, raw_body)
    res_old = await async_client.post(
        f"/api/v1/webhooks/{old_key}",
        content=raw_body,
        headers=old_headers,
    )
    assert res_old.status_code == 404

    # 2. Calling new key succeeds
    new_headers = make_webhook_headers(secret, raw_body)
    res_new = await async_client.post(
        f"/api/v1/webhooks/{new_key}",
        content=raw_body,
        headers=new_headers,
    )
    assert res_new.status_code == 200
    assert res_new.json()["status"] == "COMPLETED"


@pytest.mark.asyncio
async def test_webhook_key_rotation_audit_logging_and_zero_secret_in_audit(
    async_client: AsyncClient,
):
    """Key rotation creates an AuditLog record without leaking secret tokens."""
    org_id, headers = await create_org_and_owner(async_client, "wb_audit_rot")
    secret = "super_private_secret_999"
    wf_id, old_key, _ = await setup_webhook_workflow(
        async_client, org_id, headers, secret_token=secret
    )

    rot_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/webhook/rotate-key",
        headers=headers,
    )
    assert rot_res.status_code == 200

    # Query audit_logs table directly to verify audit entry
    engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

    async with session_factory() as session:
        stmt = (
            select(AuditLog)
            .where(
                AuditLog.organization_id == uuid.UUID(org_id),
                AuditLog.action == "WORKFLOW_WEBHOOK_KEY_ROTATED",
                AuditLog.resource_id == wf_id,
            )
            .order_by(AuditLog.created_at.desc())
        )
        audit_entry = (await session.execute(stmt)).scalar_one_or_none()
        assert audit_entry is not None
        assert audit_entry.resource_type == "workflow"
        assert audit_entry.resource_id == wf_id

        # Verify no secrets exist in details JSON
        details_str = json.dumps(audit_entry.details)
        assert secret not in details_str
        assert "secret_token" not in details_str
        assert "secret_preview" not in details_str

    await engine.dispose()


# ==============================================================================
# 4. Zero Secret Exposure Verification
# ==============================================================================

@pytest.mark.asyncio
async def test_zero_secret_exposure_policy(async_client: AsyncClient):
    """
    Strict Zero-Secret Exposure Policy Verification:
    - Webhook inspection returns solely has_secret_token: bool.
    - Neither secret_token nor secret_preview exists in any response.
    - Rotation response never returns secret_token or secret_preview.
    """
    org_id, headers = await create_org_and_owner(async_client, "wb_zero_secret")
    secret = "sk_live_super_sensitive_token_999888777"
    wf_id, webhook_key, _ = await setup_webhook_workflow(
        async_client, org_id, headers, secret_token=secret
    )

    # 1. Webhook inspection response
    insp_res = await async_client.get(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/webhook",
        headers=headers,
    )
    assert insp_res.status_code == 200
    insp_data = insp_res.json()

    assert insp_data["has_secret_token"] is True
    assert "secret_token" not in insp_data
    assert "secret_preview" not in insp_data
    assert secret not in insp_res.text

    # 2. Webhook key rotation response
    rot_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/webhook/rotate-key",
        headers=headers,
    )
    assert rot_res.status_code == 200
    rot_data = rot_res.json()

    assert "secret_token" not in rot_data
    assert "secret_preview" not in rot_data
    assert secret not in rot_res.text


# ==============================================================================
# 5. RBAC & Tenant Isolation
# ==============================================================================

@pytest.mark.asyncio
async def test_rbac_webhook_inspection_and_rotation_permissions(
    async_client: AsyncClient,
):
    """
    RBAC enforcement:
    - VIEWER cannot inspect (403) or rotate (403).
    - OPERATOR can inspect (200) but cannot rotate (403).
    - OWNER can inspect (200) and rotate (200).
    """
    org_id, owner_headers = await create_org_and_owner(async_client, "wb_rbac")
    secret = "secret_rbac_test"
    wf_id, _, _ = await setup_webhook_workflow(
        async_client, org_id, owner_headers, secret_token=secret
    )

    op_email, op_headers = await create_authenticated_user(async_client, "wb_op_user")
    view_email, view_headers = await create_authenticated_user(async_client, "wb_view_user")

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

    # 1. VIEWER cannot inspect (403)
    v_insp = await async_client.get(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/webhook",
        headers=view_headers,
    )
    assert v_insp.status_code == 403

    # 2. VIEWER cannot rotate (403)
    v_rot = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/webhook/rotate-key",
        headers=view_headers,
    )
    assert v_rot.status_code == 403

    # 3. OPERATOR can inspect (200)
    op_insp = await async_client.get(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/webhook",
        headers=op_headers,
    )
    assert op_insp.status_code == 200
    assert op_insp.json()["has_secret_token"] is True

    # 4. OPERATOR cannot rotate (403)
    op_rot = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/webhook/rotate-key",
        headers=op_headers,
    )
    assert op_rot.status_code == 403


@pytest.mark.asyncio
async def test_tenant_isolation_cross_tenant_access(async_client: AsyncClient):
    """Cross-tenant requests to webhook endpoints return HTTP 404."""
    org1_id, owner1_headers = await create_org_and_owner(async_client, "tenant1_wb")
    org2_id, owner2_headers = await create_org_and_owner(async_client, "tenant2_wb")

    wf1_id, _, _ = await setup_webhook_workflow(
        async_client, org1_id, owner1_headers, secret_token="tenant1_secret"
    )

    # Org 2 attempts to inspect Org 1's workflow -> 404
    cross_insp = await async_client.get(
        f"/api/v1/organizations/{org1_id}/workflows/{wf1_id}/webhook",
        headers=owner2_headers,
    )
    assert cross_insp.status_code == 404

    # Org 2 attempts to rotate Org 1's key -> 404
    cross_rot = await async_client.post(
        f"/api/v1/organizations/{org1_id}/workflows/{wf1_id}/webhook/rotate-key",
        headers=owner2_headers,
    )
    assert cross_rot.status_code == 404

    # Org 2 attempts to call Org 1's tenant-scoped webhook -> 404
    cross_call = await async_client.post(
        f"/api/v1/organizations/{org2_id}/workflows/{wf1_id}/webhook",
        headers=owner2_headers,
        json={"email": "cross@example.com"},
    )
    assert cross_call.status_code == 404


# ==============================================================================
# 6. Tenant-Scoped Webhook Route (Signed & Bearer Authenticated)
# ==============================================================================

@pytest.mark.asyncio
async def test_tenant_scoped_webhook_signed_success(async_client: AsyncClient):
    """Tenant-scoped webhook route succeeds when signed with valid HMAC signature."""
    org_id, headers = await create_org_and_owner(async_client, "wb_tenant_signed")
    secret = "secret_tenant_signed_123"
    wf_id, _, _ = await setup_webhook_workflow(
        async_client, org_id, headers, secret_token=secret
    )

    raw_body = json.dumps({"email": "tenant_signed@example.com"}).encode("utf-8")
    webhook_headers = make_webhook_headers(secret, raw_body)

    resp = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/webhook",
        content=raw_body,
        headers=webhook_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "COMPLETED"
    assert data["idempotent"] is False
    assert data["workflow_id"] == wf_id


@pytest.mark.asyncio
async def test_tenant_scoped_webhook_bearer_auth_success(async_client: AsyncClient):
    """Tenant-scoped webhook route succeeds with valid Organization Bearer auth."""
    org_id, headers = await create_org_and_owner(async_client, "wb_tenant_bearer")
    secret = "secret_tenant_bearer_123"
    wf_id, _, _ = await setup_webhook_workflow(
        async_client, org_id, headers, secret_token=secret
    )

    raw_body = json.dumps({"email": "tenant_bearer@example.com"}).encode("utf-8")

    # In-app invocation with Bearer auth and no HMAC signature
    bearer_headers = {
        "Content-Type": "application/json",
        **headers,
    }
    resp = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/webhook",
        content=raw_body,
        headers=bearer_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "COMPLETED"
    assert data["idempotent"] is False


@pytest.mark.asyncio
async def test_tenant_scoped_webhook_unsigned_unauthorized_401(async_client: AsyncClient):
    """Tenant-scoped webhook without signature or bearer auth returns HTTP 401."""
    org_id, headers = await create_org_and_owner(async_client, "wb_tenant_unauth")
    wf_id, _, _ = await setup_webhook_workflow(
        async_client, org_id, headers, secret_token="secret_unauth"
    )

    raw_body = json.dumps({"email": "unauth@example.com"}).encode("utf-8")
    resp = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/webhook",
        content=raw_body,
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 401
    assert "Missing webhook signature or authorization token" in resp.json()["detail"]
