"""Deleting a workflow must cascade through everything that references it."""

import json
import time
import uuid

import pytest
from httpx import AsyncClient

from app.services.webhook_service import calculate_hmac_signature

SECRET = "deletion_test_secret"


async def _setup_org(client: AsyncClient):
    unique = uuid.uuid4().hex[:8]
    email, password = f"del_{unique}@flowpilot.internal", f"SecurePass_{unique}!123"
    await client.post("/api/v1/auth/register", json={"email": email, "password": password, "full_name": "Del User"})
    token = (await client.post("/api/v1/auth/login", json={"email": email, "password": password})).json()["access_token"]
    org_id = (
        await client.post(
            "/api/v1/organizations",
            headers={"Authorization": f"Bearer {token}"},
            json={"name": f"Del Org {unique}"},
        )
    ).json()["id"]
    active = (
        await client.post(
            "/api/v1/auth/login", json={"email": email, "password": password, "organization_id": org_id}
        )
    ).json()["access_token"]
    return org_id, {"Authorization": f"Bearer {active}"}


async def _published_approval_workflow(client: AsyncClient, org_id: str, headers: dict):
    base = f"/api/v1/organizations/{org_id}/workflows"
    wf = (await client.post(base, headers=headers, json={"name": "Deletable Workflow"})).json()
    version_id = (await client.get(f"{base}/{wf['id']}/versions", headers=headers)).json()[0]["id"]
    steps = [
        {"step_key": "hook", "step_type": "WEBHOOK_TRIGGER", "name": "Hook",
         "config": {"allowed_methods": ["POST"], "secret_token": SECRET}},
        {"step_key": "gate", "step_type": "HUMAN_APPROVAL", "name": "Gate",
         "config": {"approver_role": "OWNER", "timeout_hours": 24}},
    ]
    connections = [{"source_step_key": "hook", "target_step_key": "gate"}]
    put = await client.put(f"{base}/{wf['id']}/versions/{version_id}", headers=headers,
                           json={"steps": steps, "connections": connections})
    assert put.status_code == 200
    pub = await client.post(f"{base}/{wf['id']}/versions/{version_id}/publish", headers=headers)
    assert pub.status_code == 200
    return base, wf


async def _fire_webhook(client: AsyncClient, webhook_key: str):
    body = json.dumps({"n": uuid.uuid4().hex}).encode()
    ts = str(int(time.time()))
    resp = await client.post(
        f"/api/v1/webhooks/{webhook_key}",
        content=body,
        headers={
            "Content-Type": "application/json",
            "X-Webhook-Timestamp": ts,
            "X-Webhook-Signature": calculate_hmac_signature(SECRET, ts, body),
            "Idempotency-Key": uuid.uuid4().hex,
        },
    )
    assert resp.status_code == 200
    return resp.json()["workflow_run_id"]


@pytest.mark.asyncio
async def test_delete_workflow_with_runs_and_pending_approval(async_client: AsyncClient):
    org_id, headers = await _setup_org(async_client)
    base, wf = await _published_approval_workflow(async_client, org_id, headers)
    run_id = await _fire_webhook(async_client, wf["webhook_key"])

    resp = await async_client.delete(f"{base}/{wf['id']}", headers=headers)
    assert resp.status_code == 204

    assert (await async_client.get(f"{base}/{wf['id']}", headers=headers)).status_code == 404
    run = await async_client.get(f"/api/v1/organizations/{org_id}/runs/{run_id}", headers=headers)
    assert run.status_code == 404
