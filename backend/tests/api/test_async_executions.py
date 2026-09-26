import json
import uuid
from datetime import datetime, timezone
from typing import Dict, Any, Tuple
from unittest.mock import patch, MagicMock
import pytest
from httpx import AsyncClient

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
    return email, password, headers


async def create_org_and_owner(async_client: AsyncClient, name: str) -> Tuple[str, Dict[str, str]]:
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


async def setup_test_workflow(async_client: AsyncClient, org_id: str, headers: Dict[str, str]) -> Dict[str, Any]:
    """Creates an active workflow with a published version and manual trigger."""
    wf_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows",
        headers=headers,
        json={"name": f"Async Test WF {uuid.uuid4().hex[:6]}"},
    )
    assert wf_res.status_code == 201
    wf = wf_res.json()
    wf_id = wf["id"]

    v_res = await async_client.get(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions",
        headers=headers,
    )
    v1_id = v_res.json()[0]["id"]

    put_res = await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}",
        headers=headers,
        json={
            "steps": [
                {
                    "step_key": "start",
                    "step_type": "MANUAL_TRIGGER",
                    "name": "Start",
                    "config": {},
                }
            ],
            "connections": [],
        },
    )
    assert put_res.status_code == 200

    pub_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/publish",
        headers=headers,
    )
    assert pub_res.status_code == 200
    return wf


async def setup_webhook_workflow(
    async_client: AsyncClient,
    org_id: str,
    headers: Dict[str, str],
    secret_token: str = "webhook_secret_key_123",
) -> Tuple[str, str]:
    """Creates an active workflow with a WEBHOOK_TRIGGER step."""
    wf_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows",
        headers=headers,
        json={"name": "Async Webhook Pipeline"},
    )
    assert wf_res.status_code == 201
    wf = wf_res.json()
    wf_id = wf["id"]
    webhook_key = wf["webhook_key"]

    v_res = await async_client.get(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions",
        headers=headers,
    )
    v1_id = v_res.json()[0]["id"]

    await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}",
        headers=headers,
        json={
            "steps": [
                {
                    "step_key": "inbound_hook",
                    "step_type": "WEBHOOK_TRIGGER",
                    "name": "Webhook Trigger",
                    "config": {"allowed_methods": ["POST"], "secret_token": secret_token},
                }
            ],
            "connections": [],
        },
    )

    pub_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/publish",
        headers=headers,
    )
    assert pub_res.status_code == 200
    return wf_id, webhook_key


# ==============================================================================
# Async Execution API Tests
# ==============================================================================

@pytest.mark.asyncio
async def test_trigger_workflow_run_async_dispatch_query(async_client: AsyncClient):
    """Verify ?async_dispatch=true creates PENDING run and enqueues Celery task."""
    org_id, headers = await create_org_and_owner(async_client, "async_query")
    wf = await setup_test_workflow(async_client, org_id, headers)
    wf_id = wf["id"]

    with patch("app.routers.executions.execute_workflow_run.delay") as mock_delay:
        mock_delay.return_value = MagicMock(id="fake-celery-task-id")

        response = await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/runs?async_dispatch=true",
            headers=headers,
            json={
                "trigger_payload": {"message": "hello background worker"},
                "correlation_id": "test-corr-123",
            },
        )

        assert response.status_code == 201
        data = response.json()
        assert data["status"] in ["PENDING", "RUNNING"]
        assert data["workflow_id"] == wf_id
        assert data["correlation_id"] == "test-corr-123"

        mock_delay.assert_called_once()
        args = mock_delay.call_args[0]
        assert args[0] == str(org_id)
        assert args[1] == str(data["id"])
        assert args[3] == {"message": "hello background worker"}
        assert args[4] == "test-corr-123"


@pytest.mark.asyncio
async def test_trigger_workflow_run_async_dispatch_header(async_client: AsyncClient):
    """Verify X-Async-Dispatch: true header triggers async background execution."""
    org_id, headers = await create_org_and_owner(async_client, "async_hdr")
    wf = await setup_test_workflow(async_client, org_id, headers)
    wf_id = wf["id"]

    req_headers = {**headers, "X-Async-Dispatch": "true"}

    with patch("app.routers.executions.execute_workflow_run.delay") as mock_delay:
        mock_delay.return_value = MagicMock(id="fake-celery-task-id-2")

        response = await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/runs",
            headers=req_headers,
            json={"trigger_payload": {"batch": 42}},
        )

        assert response.status_code == 201
        data = response.json()
        assert data["status"] in ["PENDING", "RUNNING"]
        mock_delay.assert_called_once()


@pytest.mark.asyncio
async def test_fast_ack_public_webhook_async(async_client: AsyncClient):
    """Verify fast-ACK on public webhook endpoint returning 202 Accepted."""
    org_id, headers = await create_org_and_owner(async_client, "fast_pub")
    secret = "secret_fast_pub_123"
    wf_id, webhook_key = await setup_webhook_workflow(async_client, org_id, headers, secret_token=secret)

    raw_body = json.dumps({"lead_id": "LD-999", "action": "created"}).encode("utf-8")
    ts = str(int(datetime.now(timezone.utc).timestamp()))
    sig = calculate_hmac_signature(secret, ts, raw_body)

    webhook_headers = {
        "Content-Type": "application/json",
        "X-Webhook-Signature": sig,
        "X-Webhook-Timestamp": ts,
        "X-Correlation-ID": "webhook-corr-456",
    }

    with patch("app.routers.webhooks.execute_workflow_run.delay") as mock_delay:
        mock_delay.return_value = MagicMock(id="fake-webhook-task-id")

        response = await async_client.post(
            f"/api/v1/webhooks/{webhook_key}?async_dispatch=true",
            content=raw_body,
            headers=webhook_headers,
        )

        assert response.status_code == 202
        data = response.json()
        assert data["status"] in ["PENDING", "RUNNING"]
        assert data["workflow_id"] == wf_id
        assert data["correlation_id"] == "webhook-corr-456"

        mock_delay.assert_called_once()


@pytest.mark.asyncio
async def test_fast_ack_tenant_webhook_async_header(async_client: AsyncClient):
    """Verify fast-ACK on tenant webhook endpoint using X-Async-Dispatch header."""
    org_id, headers = await create_org_and_owner(async_client, "fast_ten")
    secret = "secret_fast_ten_123"
    wf_id, _ = await setup_webhook_workflow(async_client, org_id, headers, secret_token=secret)

    raw_body = json.dumps({"event": "invoice.paid", "amount": 500}).encode("utf-8")
    ts = str(int(datetime.now(timezone.utc).timestamp()))
    sig = calculate_hmac_signature(secret, ts, raw_body)

    webhook_headers = {
        **headers,
        "Content-Type": "application/json",
        "X-Webhook-Signature": sig,
        "X-Webhook-Timestamp": ts,
        "X-Async-Dispatch": "true",
    }

    with patch("app.routers.webhooks.execute_workflow_run.delay") as mock_delay:
        mock_delay.return_value = MagicMock(id="fake-webhook-task-id-2")

        response = await async_client.post(
            f"/api/v1/organizations/{org_id}/workflows/{wf_id}/webhook",
            content=raw_body,
            headers=webhook_headers,
        )

        assert response.status_code == 202
        data = response.json()
        assert data["status"] in ["PENDING", "RUNNING"]
        assert data["workflow_id"] == wf_id
        mock_delay.assert_called_once()


@pytest.mark.asyncio
async def test_resume_run_async_dispatch(async_client: AsyncClient):
    """Verify resuming a non-PAUSED run with async_dispatch=true fails with 400."""
    org_id, headers = await create_org_and_owner(async_client, "resume_as")
    wf = await setup_test_workflow(async_client, org_id, headers)
    wf_id = wf["id"]

    # First, create a synchronous run that completes
    sync_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/runs",
        headers=headers,
        json={"trigger_payload": {}},
    )
    assert sync_res.status_code == 201
    run_id = sync_res.json()["id"]

    # Resuming a COMPLETED run must fail with 400
    bad_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/runs/{run_id}/resume?async_dispatch=true",
        headers=headers,
        json={"approved": True, "comment": "Premature resume"},
    )
    assert bad_res.status_code == 400
    assert "cannot resume" in bad_res.json()["detail"].lower()
