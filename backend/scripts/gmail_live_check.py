"""
Helpers for the LIVE Gmail verification (docs/GMAIL_INTEGRATION.md, "First live verification checklist").

Safe by construction:
- `setup` only talks to the running FlowPilot API and creates a dedicated test user, organization and workflow
  (trigger -> AI analysis -> human approval). It never creates a send step, so nothing can be sent.
- `status` and `leak-scan` are read-only. They print identifiers, states and counts, never tokens, secrets or bodies.

Usage (from backend/, with the venv active and the stack running):
    python scripts/gmail_live_check.py setup
    python scripts/gmail_live_check.py status
    python scripts/gmail_live_check.py leak-scan
"""

import asyncio
import os
import re
import subprocess
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

API = os.getenv("FLOWPILOT_API_URL", "http://localhost:8000/api/v1")
TEST_EMAIL = os.getenv("GMAIL_LIVE_TEST_USER", "gmail.live.test@flowpilot.internal")
TEST_PASSWORD = os.getenv("GMAIL_LIVE_TEST_PASSWORD", "LiveTest-Local-1!")  # a local throwaway app login, not a Google credential
TEST_ORG = "Gmail Live Test (dev only)"
WORKFLOW = "Gmail inbound triage (live test)"

# Shapes of real Google credentials. Used only to scan logs and the audit trail for leaks.
SECRET_PATTERNS = {
    "google_access_token": re.compile(r"ya29\.[0-9A-Za-z_\-]{20,}"),
    "google_refresh_token": re.compile(r"1//[0-9A-Za-z_\-]{20,}"),
    "google_client_secret": re.compile(r"GOCSPX-[0-9A-Za-z_\-]{10,}"),
    "oauth_code": re.compile(r"4/0[0-9A-Za-z_\-]{20,}"),
    "bearer_jwt": re.compile(r"eyJ[0-9A-Za-z_\-]{10,}\.[0-9A-Za-z_\-]{10,}\.[0-9A-Za-z_\-]{10,}"),
}


def _login(http: httpx.Client) -> str:
    login = http.post("/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    if login.status_code in (401, 404):
        reg = http.post("/auth/register", json={"email": TEST_EMAIL, "password": TEST_PASSWORD, "full_name": "Gmail Live Test"})
        if reg.status_code not in (200, 201):
            raise SystemExit(f"could not register the test user: {reg.status_code}")
        login = http.post("/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    login.raise_for_status()
    return login.json()["access_token"]


def setup() -> None:
    http = httpx.Client(base_url=API, timeout=30)
    token = _login(http)
    headers = {"Authorization": f"Bearer {token}"}
    orgs = http.get("/organizations", headers=headers).json()
    items = orgs.get("items", orgs) if isinstance(orgs, dict) else orgs
    org = next((o for o in items if o["name"] == TEST_ORG), None)
    if org is None:
        created = http.post("/organizations", headers=headers, json={"name": TEST_ORG})
        created.raise_for_status()
        org = created.json()
    org_id = org["id"]
    scoped = http.post("/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD, "organization_id": org_id})
    scoped.raise_for_status()
    headers = {"Authorization": f"Bearer {scoped.json()['access_token']}"}

    existing = http.get(f"/organizations/{org_id}/workflows", headers=headers, params={"page_size": 100}).json()
    workflow = next((w for w in existing.get("items", []) if w["name"] == WORKFLOW), None)
    if workflow is None:
        workflow = http.post(f"/organizations/{org_id}/workflows", headers=headers, json={"name": WORKFLOW}).json()
        version = http.get(f"/organizations/{org_id}/workflows/{workflow['id']}/versions", headers=headers).json()[0]["id"]
        steps = [
            {"step_key": "trigger", "step_type": "MANUAL_TRIGGER", "name": "Inbound mail", "config": {}},
            {
                "step_key": "analyze",
                "step_type": "AI_ANALYZE_MESSAGE",
                "name": "Analyze message",
                "config": {"business_profile": "Test business. No capabilities are stated; ask clarifying questions."},
            },
            {
                "step_key": "approve",
                "step_type": "HUMAN_APPROVAL",
                "name": "Manager approval",
                "config": {"approver_role": "MANAGER", "title": "Approve reply (live test)", "timeout_hours": 48},
            },
        ]
        connections = [
            {"source_step_key": "trigger", "target_step_key": "analyze"},
            {"source_step_key": "analyze", "target_step_key": "approve"},
        ]
        put = http.put(
            f"/organizations/{org_id}/workflows/{workflow['id']}/versions/{version}",
            headers=headers,
            json={"steps": steps, "connections": connections},
        )
        put.raise_for_status()
        http.post(f"/organizations/{org_id}/workflows/{workflow['id']}/versions/{version}/publish", headers=headers).raise_for_status()
    print("Dedicated test organization ready (no send step exists in its workflow).")
    print(f"  organization : {TEST_ORG}  ({org_id})")
    print(f"  workflow     : {WORKFLOW}  ({workflow['id']})")
    print(f"  FlowPilot login for the UI: {TEST_EMAIL}  (local dev account; password is in this script)")


async def _status() -> None:
    from sqlalchemy import func, select

    from app.core.database import async_session_maker
    from app.models.audit_log import AuditLog
    from app.models.conversation import Conversation, InboundMessage, ReplyDraft
    from app.models.gmail import GmailAccount
    from app.models.integration import Integration
    from app.models.organization import Organization
    from app.models.outbound import OutboundDelivery
    from app.models.workflow_run import WorkflowRun

    async with async_session_maker() as s:
        org = (await s.execute(select(Organization).where(Organization.name == TEST_ORG))).scalar_one_or_none()
        if org is None:
            print("No test organization yet. Run: python scripts/gmail_live_check.py setup")
            return
        print(f"organization: {org.name} ({org.id})")
        for acct in (await s.execute(select(GmailAccount).where(GmailAccount.organization_id == org.id))).scalars():
            integ = await s.get(Integration, acct.integration_id)
            print(
                f"mailbox {acct.email_address}: integration={integ.status if integ else '?'} sync={acct.sync_state} "
                f"watch={acct.watch_status} watch_expires={acct.watch_expiration} last_sync={acct.last_sync_at} "
                f"last_error={acct.last_sync_error} failures={acct.consecutive_failures} history_id={acct.history_id} "
                f"scopes={acct.granted_scopes} disconnected={acct.disconnected_at}"
            )
            print(f"  credentials stored encrypted: {bool(integ and integ.credentials_encrypted)} (never printed)")
        msgs = (
            await s.execute(
                select(InboundMessage).where(InboundMessage.organization_id == org.id, InboundMessage.channel == "GMAIL").order_by(InboundMessage.created_at)
            )
        ).scalars().all()
        print(f"gmail inbound messages: {len(msgs)}")
        for m in msgs:
            meta = m.provider_metadata or {}
            atts = [(a["filename"], a["content_type"], a["size"]) for a in meta.get("attachments", [])]
            print(
                f"  {m.external_message_id} thread={meta.get('gmail_thread_id')} from={m.sender_address} subject={m.subject!r} "
                f"status={m.processing_status} run={'yes' if m.workflow_run_id else 'no'} body_chars={len(m.text_content)} "
                f"labels={meta.get('labels')} in_reply_to={meta.get('in_reply_to')} refs={len(meta.get('references', []))} "
                f"to={meta.get('to')} reply_to={meta.get('reply_to')} attachments={atts}"
            )
        dupes = (
            await s.execute(
                select(InboundMessage.external_message_id, func.count())
                .where(InboundMessage.organization_id == org.id, InboundMessage.channel == "GMAIL")
                .group_by(InboundMessage.external_message_id)
                .having(func.count() > 1)
            )
        ).all()
        runs = (await s.execute(select(WorkflowRun.status, func.count()).where(WorkflowRun.organization_id == org.id).group_by(WorkflowRun.status))).all()
        convs = (await s.execute(select(func.count()).select_from(Conversation).where(Conversation.organization_id == org.id, Conversation.channel == "GMAIL"))).scalar_one()
        drafts = (await s.execute(select(ReplyDraft.status, func.count()).where(ReplyDraft.organization_id == org.id).group_by(ReplyDraft.status))).all()
        deliveries = (await s.execute(select(func.count()).select_from(OutboundDelivery).where(OutboundDelivery.organization_id == org.id))).scalar_one()
        print(f"duplicate message ids: {len(dupes)}   conversations: {convs}   workflow runs: {dict(runs)}   drafts: {dict(drafts)}")
        print(f"outbound deliveries created: {deliveries}  (must stay 0 in this phase: no send step exists)")
        actions = (
            await s.execute(select(AuditLog.action, func.count()).where(AuditLog.organization_id == org.id, AuditLog.action.like("gmail.%")).group_by(AuditLog.action))
        ).all()
        print(f"gmail audit events: {dict(actions)}")


def status() -> None:
    asyncio.run(_status())


def leak_scan() -> None:
    """Scans container logs and the audit trail for the SHAPE of Google credentials. Prints counts only."""
    findings = {name: 0 for name in SECRET_PATTERNS}
    for container in ("flowpilot-backend", "flowpilot-celery-worker", "flowpilot-celery-beat"):
        out = subprocess.run(["docker", "logs", container], capture_output=True, text=True, errors="replace")
        text = (out.stdout or "") + (out.stderr or "")
        for name, pattern in SECRET_PATTERNS.items():
            hits = len(pattern.findall(text))
            findings[name] += hits
            if hits:
                print(f"  LEAK SUSPECTED in {container}: {name} x{hits}")

    async def audit_scan() -> None:
        from sqlalchemy import select

        from app.core.database import async_session_maker
        from app.models.audit_log import AuditLog

        async with async_session_maker() as s:
            for (details,) in (await s.execute(select(AuditLog.details).where(AuditLog.action.like("gmail.%")))).all():
                blob = str(details)
                for name, pattern in SECRET_PATTERNS.items():
                    if pattern.search(blob):
                        findings[name] += 1
                        print(f"  LEAK SUSPECTED in audit details: {name}")

    asyncio.run(audit_scan())
    print("credential-shaped strings found:", {k: v for k, v in findings.items()} if any(findings.values()) else "none")
    sys.exit(1 if any(findings.values()) else 0)


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    {"setup": setup, "status": status, "leak-scan": leak_scan}.get(command, lambda: print(__doc__))()
