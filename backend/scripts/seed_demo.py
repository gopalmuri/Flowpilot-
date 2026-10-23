"""Seed the "Enterprise Lead Intake Pipeline" demo workflow through the public API.

Safe to run repeatedly: if the workflow already exists nothing is changed.

    python -m scripts.seed_demo
"""

import argparse

from scripts._client import (
    DEFAULT_BASE_URL,
    DEFAULT_EMAIL,
    DEFAULT_PASSWORD,
    WEBHOOK_SECRET,
    WORKFLOW_NAME,
    DemoError,
    find_workflow,
    open_session,
)

STEPS = [
    {
        "step_key": "webhook_inbound",
        "step_type": "WEBHOOK_TRIGGER",
        "name": "Inbound Webhook",
        "config": {"allowed_methods": ["POST"], "secret_token": WEBHOOK_SECRET},
        "ui_position": {"x": 400, "y": 0},
    },
    {
        "step_key": "ai_classify",
        "step_type": "AI_CLASSIFICATION",
        "name": "AI Lead Classifier",
        "config": {"categories": ["enterprise", "smb"]},
        "ui_position": {"x": 400, "y": 190},
    },
    {
        "step_key": "eval_enterprise",
        "step_type": "CONDITION",
        "name": "Is Enterprise Lead?",
        "config": {
            "logic": "AND",
            "conditions": [{"field": "ai_classify.category", "operator": "equals", "value": "enterprise"}],
        },
        "ui_position": {"x": 400, "y": 380},
    },
    {
        "step_key": "manager_approval",
        "step_type": "HUMAN_APPROVAL",
        "name": "VP Approval Gate",
        "config": {"approver_role": "OWNER", "timeout_hours": 24},
        "ui_position": {"x": 400, "y": 570},
    },
    {
        "step_key": "crm_lead",
        "step_type": "MOCK_CRM_CREATE",
        "name": "Create CRM Lead",
        "config": {"entity_type": "lead"},
        "ui_position": {"x": 220, "y": 780},
    },
    {
        "step_key": "slack_announcement",
        "step_type": "SLACK_NOTIFICATION",
        "name": "Notify #enterprise-leads",
        "config": {"channel": "#enterprise-leads"},
        "ui_position": {"x": 220, "y": 980},
    },
    {
        "step_key": "slack_rejected",
        "step_type": "SLACK_NOTIFICATION",
        "name": "Notify Rejection",
        "config": {"channel": "#enterprise-leads", "message": "Lead rejected by approver; no CRM record created."},
        "ui_position": {"x": 580, "y": 780},
    },
]

CONNECTIONS = [
    {"source_step_key": "webhook_inbound", "target_step_key": "ai_classify"},
    {"source_step_key": "ai_classify", "target_step_key": "eval_enterprise"},
    {"source_step_key": "eval_enterprise", "target_step_key": "manager_approval", "condition_label": "true"},
    {"source_step_key": "manager_approval", "target_step_key": "crm_lead", "condition_label": "approved"},
    {"source_step_key": "manager_approval", "target_step_key": "slack_rejected", "condition_label": "rejected"},
    {"source_step_key": "crm_lead", "target_step_key": "slack_announcement"},
]


def seed(base_url: str, email: str, password: str) -> None:
    session = open_session(base_url, email, password)
    existing = find_workflow(session)
    if existing:
        print(f"[=] '{WORKFLOW_NAME}' already exists ({existing['id']}, {existing['status']}); nothing to do.")
        return

    base = f"/organizations/{session.org_id}/workflows"
    wf = session.request(
        "POST",
        base,
        expected=201,
        json={
            "name": WORKFLOW_NAME,
            "description": "Inbound lead -> AI classification -> rule check -> human approval -> CRM -> Slack.",
        },
    )
    version_id = session.request("GET", f"{base}/{wf['id']}/versions")[0]["id"]
    session.request(
        "PUT", f"{base}/{wf['id']}/versions/{version_id}", json={"steps": STEPS, "connections": CONNECTIONS}
    )
    session.request(
        "PUT",
        f"{base}/{wf['id']}/versions/{version_id}/sla",
        json={"target_seconds": 60.0, "warning_threshold_seconds": 45.0, "enabled": True},
    )
    session.request("POST", f"{base}/{wf['id']}/versions/{version_id}/publish")
    print(f"[+] Created and published '{WORKFLOW_NAME}' ({wf['id']}) in organization {session.org_id}")
    print(f"    webhook key: {wf['webhook_key']}")
    print("    next: python -m scripts.run_demo")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--email", default=DEFAULT_EMAIL)
    parser.add_argument("--password", default=DEFAULT_PASSWORD)
    args = parser.parse_args()
    try:
        seed(args.base_url, args.email, args.password)
    except DemoError as exc:
        raise SystemExit(f"[x] {exc}") from exc
