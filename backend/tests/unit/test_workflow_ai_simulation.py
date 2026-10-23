import pytest

from app.schemas.workflow import WorkflowConnectionSchema, WorkflowStepSchema
from app.schemas.workflow_ai import (
    AISimulateExecutionRequest,
    AISimulatePayloadRequest,
)
from app.services.ai.workflow_generator import AIWorkflowGeneratorService


@pytest.mark.asyncio
async def test_generate_test_payload_happy_path():
    service = AIWorkflowGeneratorService()
    steps = [
        WorkflowStepSchema(step_key="webhook_1", step_type="WEBHOOK_TRIGGER", name="Inbound Lead Webhook", config={}),
        WorkflowStepSchema(
            step_key="cond_1",
            step_type="CONDITION",
            name="Score Threshold",
            config={"field": "lead_score", "operator": ">=", "value": 75},
        ),
    ]
    conns = [WorkflowConnectionSchema(source_step_key="webhook_1", target_step_key="cond_1")]

    req = AISimulatePayloadRequest(
        steps=steps,
        connections=conns,
        scenario="happy_path",
    )
    resp = await service.generate_test_payload(req, provider_name="mock")
    assert resp.scenario == "happy_path"
    assert "lead_score" in resp.payload
    assert resp.payload["lead_score"] >= 75
    assert resp.target_trigger == "webhook_1"


@pytest.mark.asyncio
async def test_generate_test_payload_failure_scenario():
    service = AIWorkflowGeneratorService()
    steps = [
        WorkflowStepSchema(step_key="webhook_1", step_type="WEBHOOK_TRIGGER", name="Inbound Lead Webhook", config={}),
    ]
    req = AISimulatePayloadRequest(
        steps=steps,
        connections=[],
        scenario="failure",
    )
    resp = await service.generate_test_payload(req, provider_name="mock")
    assert resp.scenario == "failure"
    assert resp.payload["lead_score"] < 50


@pytest.mark.asyncio
async def test_simulate_workflow_execution_condition_true_branch():
    service = AIWorkflowGeneratorService()
    steps = [
        WorkflowStepSchema(step_key="webhook_1", step_type="WEBHOOK_TRIGGER", name="Inbound Webhook", config={}),
        WorkflowStepSchema(
            step_key="cond_1",
            step_type="CONDITION",
            name="Score Check",
            config={"field": "lead_score", "operator": ">", "value": 50},
        ),
        WorkflowStepSchema(
            step_key="crm_high",
            step_type="MOCK_CRM_CREATE",
            name="Enterprise Sync",
            config={"entity_type": "lead"},
        ),
        WorkflowStepSchema(
            step_key="slack_low",
            step_type="SLACK_NOTIFICATION",
            name="Low Priority Alert",
            config={"channel": "#triage"},
        ),
    ]
    conns = [
        WorkflowConnectionSchema(source_step_key="webhook_1", target_step_key="cond_1"),
        WorkflowConnectionSchema(source_step_key="cond_1", target_step_key="crm_high", condition_label="true"),
        WorkflowConnectionSchema(source_step_key="cond_1", target_step_key="slack_low", condition_label="false"),
    ]

    # Test True path (lead_score = 90 > 50)
    req = AISimulateExecutionRequest(
        steps=steps,
        connections=conns,
        payload={"lead_score": 90, "company": "Acme Corp"},
    )
    resp = await service.simulate_workflow_execution(req)

    assert resp.overall_outcome == "COMPLETED"
    assert "webhook_1" in resp.active_step_ids
    assert "cond_1" in resp.active_step_ids
    assert "crm_high" in resp.active_step_ids
    assert "slack_low" not in resp.active_step_ids

    # Find condition step result
    cond_step = next(s for s in resp.steps if s.step_id == "cond_1")
    assert cond_step.branch_taken == "true"
    assert cond_step.status == "SUCCESS"

    # Find skipped step
    slack_step = next(s for s in resp.steps if s.step_id == "slack_low")
    assert slack_step.status == "SKIPPED"


@pytest.mark.asyncio
async def test_simulate_workflow_execution_condition_false_branch():
    service = AIWorkflowGeneratorService()
    steps = [
        WorkflowStepSchema(step_key="webhook_1", step_type="WEBHOOK_TRIGGER", name="Inbound Webhook", config={}),
        WorkflowStepSchema(
            step_key="cond_1",
            step_type="CONDITION",
            name="Score Check",
            config={"field": "lead_score", "operator": ">", "value": 50},
        ),
        WorkflowStepSchema(
            step_key="crm_high",
            step_type="MOCK_CRM_CREATE",
            name="Enterprise Sync",
            config={"entity_type": "lead"},
        ),
        WorkflowStepSchema(
            step_key="slack_low",
            step_type="SLACK_NOTIFICATION",
            name="Low Priority Alert",
            config={"channel": "#triage"},
        ),
    ]
    conns = [
        WorkflowConnectionSchema(source_step_key="webhook_1", target_step_key="cond_1"),
        WorkflowConnectionSchema(source_step_key="cond_1", target_step_key="crm_high", condition_label="true"),
        WorkflowConnectionSchema(source_step_key="cond_1", target_step_key="slack_low", condition_label="false"),
    ]

    # Test False path (lead_score = 20 < 50)
    req = AISimulateExecutionRequest(
        steps=steps,
        connections=conns,
        payload={"lead_score": 20, "company": "Tiny Corp"},
    )
    resp = await service.simulate_workflow_execution(req)

    assert resp.overall_outcome == "COMPLETED"
    assert "webhook_1" in resp.active_step_ids
    assert "cond_1" in resp.active_step_ids
    assert "slack_low" in resp.active_step_ids
    assert "crm_high" not in resp.active_step_ids

    cond_step = next(s for s in resp.steps if s.step_id == "cond_1")
    assert cond_step.branch_taken == "false"


@pytest.mark.asyncio
async def test_simulate_workflow_execution_human_approval_pause():
    service = AIWorkflowGeneratorService()
    steps = [
        WorkflowStepSchema(step_key="webhook_1", step_type="WEBHOOK_TRIGGER", name="Inbound Webhook", config={}),
        WorkflowStepSchema(
            step_key="approval_1",
            step_type="HUMAN_APPROVAL",
            name="Executive Signoff",
            config={"approver_role": "ADMIN", "timeout_hours": 12},
        ),
    ]
    conns = [
        WorkflowConnectionSchema(source_step_key="webhook_1", target_step_key="approval_1"),
    ]

    req = AISimulateExecutionRequest(
        steps=steps,
        connections=conns,
        payload={"amount": 50000},
    )
    resp = await service.simulate_workflow_execution(req)
    assert resp.overall_outcome == "PENDING_APPROVAL"
    appr_step = next(s for s in resp.steps if s.step_id == "approval_1")
    assert appr_step.status == "WAITING_APPROVAL"
    assert appr_step.simulated_output["required_role"] == "ADMIN"
