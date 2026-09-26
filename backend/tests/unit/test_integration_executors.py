import uuid
import pytest
from app.engine.base import StepExecutionContext
from app.engine.executors import (
    AIClassificationExecutor,
    MockCRMCreateExecutor,
    MockSlackNotificationExecutor,
)
from app.services.crm.mock_crm_service import MockCRMService
from app.services.slack.slack_service import SlackService


@pytest.mark.asyncio
async def test_mock_crm_create_executor_auto_extraction():
    crm_svc = MockCRMService(use_redis=False)
    executor = MockCRMCreateExecutor(crm_service=crm_svc)

    org_id = uuid.uuid4()
    ctx = StepExecutionContext(
        organization_id=org_id,
        workflow_run_id=uuid.uuid4(),
        step_id=uuid.uuid4(),
        step_key="crm_sync",
        step_type="MOCK_CRM_CREATE",
        config={},
        trigger_payload={
            "email": "sarah.connor@cyberdyne.com",
            "company": "Cyberdyne Systems",
            "deal_size": "$250,000",
            "lead_score": 98,
        },
        workflow_data={
            "ai_classify": {
                "category": "enterprise",
                "priority": "urgent",
                "confidence": 0.95,
            }
        },
    )

    result = await executor.execute(ctx)
    assert result.status == "COMPLETED"
    assert result.output_data["status"] == "created"
    assert result.output_data["crm_id"].startswith("crm_lead_")

    attrs = result.output_data["attributes"]
    assert attrs["email"] == "sarah.connor@cyberdyne.com"
    assert attrs["company"] == "Cyberdyne Systems"
    assert attrs["category"] == "enterprise"
    assert attrs["priority"] == "urgent"


@pytest.mark.asyncio
async def test_mock_slack_notification_executor_template_and_block_kit():
    slack_svc = SlackService()
    executor = MockSlackNotificationExecutor(slack_service=slack_svc)

    org_id = uuid.uuid4()
    ctx = StepExecutionContext(
        organization_id=org_id,
        workflow_run_id=uuid.uuid4(),
        step_id=uuid.uuid4(),
        step_key="slack_alert",
        step_type="SLACK_NOTIFICATION",
        config={
            "channel": "#leads-hot",
            "message": "🔥 High-Value Lead Alert: {{ lead.company }} ({{ ai.category }}) scored {{ lead.lead_score }}!",
            "include_lead_card": True,
            "mock_mode": True,
        },
        trigger_payload={"email": "contact@target.com"},
        workflow_data={
            "ai_classify": {
                "category": "ENTERPRISE",
                "priority": "HIGH",
                "confidence": 0.99,
            },
            "crm_create": {
                "crm_id": "crm_lead_12345",
                "attributes": {
                    "company": "Wayne Enterprises",
                    "email": "bruce@wayne.com",
                    "lead_score": 99,
                },
            },
        },
    )

    result = await executor.execute(ctx)
    assert result.status == "COMPLETED"
    assert result.output_data["delivery_status"] == "delivered"
    assert result.output_data["channel"] == "#leads-hot"
    assert "Wayne Enterprises" in result.output_data["rendered_message"]
    assert "ENTERPRISE" in result.output_data["rendered_message"]
    assert "99" in result.output_data["rendered_message"]
    assert result.output_data["mock_adapter"] is True
