import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from sqlalchemy import select
from app.core.database import async_session_maker
from app.core.security import get_password_hash
from app.models.user import User
from app.models.organization import Organization
from app.models.membership import OrganizationMember, OrganizationRole
from app.models.workflow import Workflow, WorkflowVersion
from app.models.workflow_step import WorkflowStep
from app.models.workflow_run import WorkflowRun, WorkflowStepRun
from app.models.integration import Integration
from app.models.audit_log import AuditLog

async def seed():
    print("[*] Starting FlowPilot dummy data seeding...")
    async with async_session_maker() as db:
        now = datetime.now(timezone.utc)
        password_hash = get_password_hash("Password123!")

        # 1. Ensure Organization exists
        org_slug = "flowpilot-tech"
        res = await db.execute(select(Organization).where(Organization.slug == org_slug))
        org = res.scalar_one_or_none()
        if not org:
            org = Organization(
                name="FlowPilot Innovations",
                slug=org_slug,
            )
            db.add(org)
            await db.flush()
            print(f"[+] Created Organization: {org.name} ({org.id})")
        else:
            print(f"[*] Found existing Organization: {org.name} ({org.id})")

        # 2. Ensure Users exist with Password123!
        emails = ["gopalmuri1919@gmail.com", "gopalmuri2004@gmail.com", "admin@flowpilot.internal"]
        user_objs = {}
        for email in emails:
            res = await db.execute(select(User).where(User.email == email))
            u = res.scalar_one_or_none()
            if not u:
                u = User(
                    email=email,
                    password_hash=password_hash,
                    full_name="Gopal Muri" if "gopal" in email else "FlowPilot Admin",
                    is_active=True,
                    is_superuser=True,
                )
                db.add(u)
                await db.flush()
                print(f"[+] Created User: {email} with password 'Password123!'")
            else:
                u.password_hash = password_hash
                u.is_active = True
                await db.flush()
                print(f"[+] Updated password for existing User: {email} to 'Password123!'")

            user_objs[email] = u

            # Add membership
            mem_res = await db.execute(
                select(OrganizationMember).where(
                    OrganizationMember.organization_id == org.id,
                    OrganizationMember.user_id == u.id,
                )
            )
            if not mem_res.scalar_one_or_none():
                mem = OrganizationMember(
                    organization_id=org.id,
                    user_id=u.id,
                    role=OrganizationRole.OWNER.value,
                )
                db.add(mem)
                await db.flush()

        main_user = user_objs["gopalmuri1919@gmail.com"]

        # 3. Integrations
        integrations_data = [
            ("SLACK", "Slack Alerts & Operations", "CONNECTED", {"channel": "#workflow-alerts"}),
            ("GITHUB", "GitHub Repositories", "CONNECTED", {"repository": "gopalmuri/flowpilot"}),
            ("SENDGRID", "SendGrid Email Dispatch", "CONNECTED", {"sender": "noreply@flowpilot.internal"}),
            ("WEBHOOK", "Stripe Live Events Webhook", "CONNECTED", {"url": "https://api.stripe.com/events"}),
        ]
        for itype, iname, istatus, iconfig in integrations_data:
            res = await db.execute(
                select(Integration).where(
                    Integration.organization_id == org.id,
                    Integration.name == iname
                )
            )
            if not res.scalar_one_or_none():
                integ = Integration(
                    organization_id=org.id,
                    type=itype,
                    name=iname,
                    status=istatus,
                    config=iconfig,
                )
                db.add(integ)
                print(f"[+] Added Integration: {iname}")

        # 4. Workflows & Versions & Steps
        workflows_data = [
            (
                "Customer Onboarding Pipeline",
                "Automatically triggers welcome emails, generates API keys, and notifies the team via Slack.",
                "ACTIVE",
            ),
            (
                "Stripe Payment & Automatic Invoicing",
                "Listens for Stripe invoice.paid webhooks and generates PDF invoices in Google Drive.",
                "ACTIVE",
            ),
            (
                "Daily DevOps Health Check & Alerting",
                "Runs every morning at 08:00 UTC to ping infrastructure and notify on latency spikes.",
                "ACTIVE",
            ),
            (
                "AI Document Summarizer & Extraction",
                "Processes uploaded PDFs using LLM extraction and posts results to CRM.",
                "DRAFT",
            ),
        ]

        created_workflows = []
        for w_name, w_desc, w_status in workflows_data:
            res = await db.execute(
                select(Workflow).where(
                    Workflow.organization_id == org.id,
                    Workflow.name == w_name,
                )
            )
            wf = res.scalar_one_or_none()
            if not wf:
                wf = Workflow(
                    organization_id=org.id,
                    name=w_name,
                    description=w_desc,
                    status=w_status,
                    created_by=main_user.id,
                )
                db.add(wf)
                await db.flush()

                # Add version 1
                v = WorkflowVersion(
                    workflow_id=wf.id,
                    version_number=1,
                    status="PUBLISHED" if w_status == "ACTIVE" else "DRAFT",
                    definition={
                        "nodes": [
                            {"id": "1", "type": "trigger", "data": {"label": "Webhook Trigger"}},
                            {"id": "2", "type": "action", "data": {"label": "Process Payload"}},
                            {"id": "3", "type": "action", "data": {"label": "Slack Notification"}},
                        ],
                        "edges": [
                            {"id": "e1-2", "source": "1", "target": "2"},
                            {"id": "e2-3", "source": "2", "target": "3"},
                        ]
                    },
                    created_by=main_user.id,
                )
                db.add(v)
                await db.flush()

                wf.active_version_id = v.id

                # Steps
                step1 = WorkflowStep(
                    workflow_version_id=v.id,
                    step_key="trigger_webhook",
                    step_type="TRIGGER_WEBHOOK",
                    name="Receive Webhook",
                    config={"path": "/hooks/default"},
                    ui_position={"x": 100, "y": 150},
                )
                step2 = WorkflowStep(
                    workflow_version_id=v.id,
                    step_key="process_data",
                    step_type="TRANSFORM",
                    name="Transform Data",
                    config={"format": "json"},
                    ui_position={"x": 350, "y": 150},
                )
                step3 = WorkflowStep(
                    workflow_version_id=v.id,
                    step_key="notify_slack",
                    step_type="SLACK_MESSAGE",
                    name="Notify Slack Channel",
                    config={"channel": "#alerts"},
                    ui_position={"x": 600, "y": 150},
                )
                db.add_all([step1, step2, step3])
                await db.flush()
                print(f"[+] Created Workflow: {w_name}")
            created_workflows.append(wf)

        # 5. Workflow Runs across past 7 days (dates)
        runs_count_res = await db.execute(
            select(WorkflowRun).where(WorkflowRun.organization_id == org.id)
        )
        existing_runs = runs_count_res.scalars().all()
        if len(existing_runs) < 5:
            print("[+] Inserting realistic workflow runs with dates...")
            run_templates = [
                (6, "COMPLETED", "WEBHOOK", 1200),
                (5, "COMPLETED", "SCHEDULE", 850),
                (4, "FAILED", "WEBHOOK", 340),
                (3, "COMPLETED", "MANUAL", 940),
                (2, "COMPLETED", "SCHEDULE", 610),
                (1, "COMPLETED", "WEBHOOK", 720),
                (0, "COMPLETED", "WEBHOOK", 450),
                (0, "RUNNING", "MANUAL", 0),
            ]

            target_wf = created_workflows[0]
            for days_ago, r_status, r_trigger, duration_ms in run_templates:
                run_start = now - timedelta(days=days_ago, hours=days_ago*2 + 1, minutes=15)
                run_end = (run_start + timedelta(milliseconds=duration_ms)) if r_status != "RUNNING" else None

                w_run = WorkflowRun(
                    organization_id=org.id,
                    workflow_id=target_wf.id,
                    workflow_version_id=target_wf.active_version_id,
                    status=r_status,
                    trigger_type=r_trigger,
                    trigger_payload={"event": "customer.signup", "id": str(uuid.uuid4())[:8]},
                    correlation_id=f"corr-{uuid.uuid4().hex[:12]}",
                    error_message="Gateway timeout from external API (HTTP 504)" if r_status == "FAILED" else None,
                    started_at=run_start,
                    completed_at=run_end,
                )
                db.add(w_run)

        # 6. Audit Logs across past dates
        audit_res = await db.execute(
            select(AuditLog).where(AuditLog.organization_id == org.id)
        )
        if len(audit_res.scalars().all()) < 5:
            print("[+] Inserting audit logs with dates...")
            audit_events = [
                (6, "USER_LOGIN", "User", str(main_user.id), {"ip": "192.168.1.10", "agent": "Chrome/128"}),
                (5, "WORKFLOW_CREATED", "Workflow", str(created_workflows[0].id), {"name": "Customer Onboarding"}),
                (4, "INTEGRATION_CONNECTED", "Integration", "slack", {"service": "Slack"}),
                (3, "WORKFLOW_PUBLISHED", "Workflow", str(created_workflows[0].id), {"version": 1}),
                (1, "INTEGRATION_CONNECTED", "Integration", "github", {"service": "GitHub"}),
                (0, "USER_LOGIN", "User", str(main_user.id), {"ip": "127.0.0.1", "agent": "Chrome/128"}),
            ]
            for days_ago, act, rtype, rid, details in audit_events:
                created_dt = now - timedelta(days=days_ago, hours=4, minutes=20)
                entry = AuditLog(
                    organization_id=org.id,
                    user_id=main_user.id,
                    action=act,
                    resource_type=rtype,
                    resource_id=rid,
                    details=details,
                    ip_address="127.0.0.1",
                    created_at=created_dt,
                )
                db.add(entry)

        await db.commit()
        print("[*] All dummy data and dates inserted successfully!")

if __name__ == "__main__":
    asyncio.run(seed())
