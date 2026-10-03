import asyncio
import uuid
from sqlalchemy import select, delete
from app.core.database import async_session_maker
from app.models.workflow import Workflow, WorkflowVersion
from app.models.workflow_step import WorkflowStep, WorkflowConnection

async def main():
    wf_id = uuid.UUID("368c063e-408c-4138-82c6-35ddc5105506")
    async with async_session_maker() as db:
        wf_res = await db.execute(select(Workflow).where(Workflow.id == wf_id))
        wf = wf_res.scalar_one()

        v_res = await db.execute(select(WorkflowVersion).where(WorkflowVersion.workflow_id == wf_id))
        version = v_res.scalar_one()

        # Delete existing steps and connections
        await db.execute(delete(WorkflowConnection).where(WorkflowConnection.workflow_version_id == version.id))
        await db.execute(delete(WorkflowStep).where(WorkflowStep.workflow_version_id == version.id))
        await db.flush()

        steps_data = [
            ("webhook_trigger", "WEBHOOK_TRIGGER", "Inbound Customer Webhook", {"path": "/webhooks/customer-signup"}, {"x": 60, "y": 180}),
            ("validate_data", "VALIDATE_DATA", "Validate Account Payload", {"required_fields": ["company_name", "credit_limit_requested", "contact_email"]}, {"x": 360, "y": 180}),
            ("ai_classification", "AI_CLASSIFICATION", "AI Credit Risk Assessment", {"prompt": "Assess commercial credit risk based on requested limit and financials", "categories": ["LOW_RISK", "MEDIUM_RISK", "HIGH_RISK"]}, {"x": 660, "y": 180}),
            ("human_approval", "HUMAN_APPROVAL", "Credit Officer Sign-off", {"approver_role": "OWNER", "title": "Review credit limit approval", "timeout_hours": 24}, {"x": 960, "y": 180}),
            ("slack_notify", "SLACK_NOTIFICATION", "Notify Sales Channel", {"channel": "#sales-ops", "message": "Enterprise customer onboarded successfully!"}, {"x": 1260, "y": 180}),
        ]

        step_map = {}
        steps_list_json = []
        for skey, stype, sname, scfg, spos in steps_data:
            s = WorkflowStep(
                workflow_version_id=version.id,
                step_key=skey,
                step_type=stype,
                name=sname,
                config=scfg,
                ui_position=spos,
            )
            db.add(s)
            await db.flush()
            step_map[skey] = s
            steps_list_json.append({
                "id": str(s.id),
                "step_key": skey,
                "step_type": stype,
                "name": sname,
                "config": scfg,
                "ui_position": spos,
            })

        connections_data = [
            ("webhook_trigger", "validate_data"),
            ("validate_data", "ai_classification"),
            ("ai_classification", "human_approval"),
            ("human_approval", "slack_notify"),
        ]

        conns_list_json = []
        for src_key, tgt_key in connections_data:
            c = WorkflowConnection(
                workflow_version_id=version.id,
                source_step_id=step_map[src_key].id,
                target_step_id=step_map[tgt_key].id,
                condition_label=None,
            )
            db.add(c)
            await db.flush()
            conns_list_json.append({
                "id": str(c.id),
                "source_step_id": str(step_map[src_key].id),
                "target_step_id": str(step_map[tgt_key].id),
                "source_step_key": src_key,
                "target_step_key": tgt_key,
            })

        # Set version status to PUBLISHED and workflow to ACTIVE
        version.status = "PUBLISHED"
        version.definition = {
            "steps": steps_list_json,
            "connections": conns_list_json,
        }
        wf.status = "ACTIVE"
        wf.active_version_id = version.id

        await db.commit()
        print("[+] Pipeline fully populated, validated, and published as ACTIVE!")

if __name__ == "__main__":
    asyncio.run(main())
