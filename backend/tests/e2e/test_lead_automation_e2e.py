"""
Full End-to-End Lead Automation Pipeline Test for FlowPilot (Phase 16).
Flow:
Inbound Webhook
    ↓
AI Classification
    ↓
Condition Evaluation
    ↓
Human Approval
    ↓
Mock CRM Create
    ↓
Slack Notification
    ↓
Audit Log Verification
    ↓
Analytics Aggregation Verification
"""

import time
import uuid
import pytest
from httpx import AsyncClient

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

    # Re-login with org_id for active membership context
    relogin = await async_client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password, "organization_id": org_id},
    )
    active_token = relogin.json()["access_token"]
    return org_id, {"Authorization": f"Bearer {active_token}"}


@pytest.mark.asyncio
async def test_full_lead_automation_e2e_pipeline(async_client: AsyncClient):
    """
    Executes the entire end-to-end lead automation workflow.
    Validates state transitions, pauses, approval resolution, notifications, and analytics.
    """
    org_id, headers = await create_user_and_org(async_client, "e2e_lead")

    # 1. Create Workflow
    wf_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows",
        headers=headers,
        json={"name": "Enterprise Lead Intake Pipeline", "description": "Automated inbound lead workflow"},
    )
    assert wf_res.status_code == 201
    wf_data = wf_res.json()
    wf_id = wf_data["id"]
    webhook_key = wf_data["webhook_key"]

    # 2. Get Draft Version 1
    versions_res = await async_client.get(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions",
        headers=headers,
    )
    assert versions_res.status_code == 200
    v1_id = versions_res.json()[0]["id"]

    secret_token = "e2e_webhook_secret_key_456"

    # 3. Configure DAG Steps & Connections
    steps = [
        {
            "step_key": "webhook_inbound",
            "step_type": "WEBHOOK_TRIGGER",
            "name": "Inbound Webhook",
            "config": {"allowed_methods": ["POST"], "secret_token": secret_token},
        },
        {
            "step_key": "ai_classify",
            "step_type": "AI_CLASSIFICATION",
            "name": "AI Lead Classifier",
            "config": {"categories": ["enterprise", "smb"]},
        },
        {
            "step_key": "eval_enterprise",
            "step_type": "CONDITION",
            "name": "Check Enterprise Lead",
            "config": {
                "logic": "AND",
                "conditions": [
                    {"field": "ai_classify.category", "operator": "equals", "value": "enterprise"},
                ],
            },
        },
        {
            "step_key": "manager_approval",
            "step_type": "HUMAN_APPROVAL",
            "name": "VP Approval Gate",
            "config": {"approver_role": "OWNER", "timeout_hours": 24},
        },
        {
            "step_key": "crm_lead",
            "step_type": "MOCK_CRM_CREATE",
            "name": "Create Enterprise CRM Lead",
            "config": {"entity_type": "lead"},
        },
        {
            "step_key": "slack_announcement",
            "step_type": "SLACK_NOTIFICATION",
            "name": "Notify #enterprise-leads",
            "config": {"channel": "#enterprise-leads"},
        },
    ]

    connections = [
        {"source_step_key": "webhook_inbound", "target_step_key": "ai_classify"},
        {"source_step_key": "ai_classify", "target_step_key": "eval_enterprise"},
        {"source_step_key": "eval_enterprise", "target_step_key": "manager_approval", "condition_label": "true"},
        {"source_step_key": "manager_approval", "target_step_key": "crm_lead", "condition_label": "approved"},
        {"source_step_key": "crm_lead", "target_step_key": "slack_announcement"},
    ]

    put_res = await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}",
        headers=headers,
        json={"steps": steps, "connections": connections},
    )
    assert put_res.status_code == 200

    # 4. Set SLA Configuration on Draft
    sla_res = await async_client.put(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/sla",
        headers=headers,
        json={"target_seconds": 60.0, "warning_threshold_seconds": 45.0, "enabled": True},
    )
    assert sla_res.status_code == 200

    # 5. Publish Workflow Version
    pub_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/workflows/{wf_id}/versions/{v1_id}/publish",
        headers=headers,
    )
    assert pub_res.status_code == 200

    # 6. Post Inbound Webhook with HMAC Signature
    raw_body = b'{"company": "Globex Corp", "employees": 1000, "message": "This is an urgent enterprise partnership opportunity"}'
    ts = str(int(time.time()))
    sig = calculate_hmac_signature(secret_token, ts, raw_body)

    webhook_headers = {
        "Content-Type": "application/json",
        "X-Webhook-Timestamp": ts,
        "X-Webhook-Signature": sig,
    }

    post_hook = await async_client.post(
        f"/api/v1/webhooks/{webhook_key}",
        headers=webhook_headers,
        content=raw_body,
    )
    assert post_hook.status_code == 200
    hook_data = post_hook.json()
    run_id = hook_data["workflow_run_id"]
    assert run_id is not None

    # 7. Check WorkflowRun is Paused waiting for approval
    run_res = await async_client.get(
        f"/api/v1/organizations/{org_id}/runs/{run_id}",
        headers=headers,
    )
    assert run_res.status_code == 200
    assert run_res.json()["status"] in ["PAUSED", "WAITING_APPROVAL"]

    # 8. Query Pending Approvals
    pending_res = await async_client.get(
        f"/api/v1/organizations/{org_id}/approvals?status=PENDING",
        headers=headers,
    )
    assert pending_res.status_code == 200
    pending_items = pending_res.json().get("items", [])
    assert len(pending_items) >= 1
    target_approval = next((a for a in pending_items if str(a["workflow_run_id"]) == str(run_id)), None)
    assert target_approval is not None
    approval_id = target_approval["id"]

    # 9. Approve the Lead Request
    action_res = await async_client.post(
        f"/api/v1/organizations/{org_id}/approvals/{approval_id}/approve",
        headers=headers,
        json={"comment": "Qualified enterprise lead approved for CRM entry"},
    )
    assert action_res.status_code == 200
    assert action_res.json()["status"] == "APPROVED"

    # 10. Verify Workflow Execution Resumed and Succeeded
    completed_run = await async_client.get(
        f"/api/v1/organizations/{org_id}/runs/{run_id}",
        headers=headers,
    )
    assert completed_run.status_code == 200
    run_details = completed_run.json()
    assert run_details["status"] in ["COMPLETED", "SUCCESS"]
    assert run_details["completed_at"] is not None

    # 11. Verify Audit Logs Recorded Chain
    audit_res = await async_client.get(
        f"/api/v1/organizations/{org_id}/audit-logs",
        headers=headers,
    )
    assert audit_res.status_code == 200
    logs = audit_res.json().get("items", [])
    actions = [l["action"] for l in logs]
    assert any("approval" in act for act in actions)

    # 12. Verify Analytics Overview Shows Terminal Success & Volume
    analytics_res = await async_client.get(
        f"/api/v1/organizations/{org_id}/analytics/overview?range=24h",
        headers=headers,
    )
    assert analytics_res.status_code == 200
    overview = analytics_res.json()
    assert overview["volume"]["total"] >= 1
    assert overview["volume"]["success_count"] >= 1
    assert overview["volume"]["success_rate"] == 100.0
