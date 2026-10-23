import pytest

from app.schemas.workflow import WorkflowConnectionSchema, WorkflowStepSchema
from app.schemas.workflow_ai import (
    AIChatMessage,
    AIMessageRole,
    AIWorkflowAssistRequest,
)
from app.services.ai.workflow_generator import (
    AIWorkflowGeneratorService,
    calculate_diff_summary,
    compute_auto_layout,
)


@pytest.mark.asyncio
async def test_ai_workflow_generate_proposal():
    service = AIWorkflowGeneratorService()
    req = AIWorkflowAssistRequest(
        prompt="Create an enterprise lead routing workflow with human approval",
        conversation_history=[],
        current_steps=[],
        current_connections=[],
    )

    resp = await service.assist(req, provider_name="mock")
    assert resp.mode == "proposal"
    assert resp.proposal is not None
    assert resp.proposal.valid is True
    assert len(resp.proposal.steps) >= 3
    assert len(resp.proposal.connections) >= 2

    # Check that diff summary registered additions
    assert len(resp.proposal.diff_summary.added_steps) >= 3
    # Check that steps received non-zero layout positions
    for s in resp.proposal.steps:
        assert s.ui_position["x"] > 0
        assert s.ui_position["y"] > 0


@pytest.mark.asyncio
async def test_ai_workflow_clarification_response():
    service = AIWorkflowGeneratorService()
    req = AIWorkflowAssistRequest(
        prompt="Send notifications when something happens (missing details, clarify needed)",
        conversation_history=[],
        current_steps=[],
        current_connections=[],
    )

    resp = await service.assist(req, provider_name="mock")
    assert resp.mode == "clarification"
    assert len(resp.clarification_questions) >= 1
    assert len(resp.clarification_questions[0].options) >= 2


@pytest.mark.asyncio
async def test_ai_workflow_explanation_response():
    service = AIWorkflowGeneratorService()
    req = AIWorkflowAssistRequest(
        prompt="Explain this workflow and audit its execution path",
        conversation_history=[],
        current_steps=[
            WorkflowStepSchema(
                step_key="webhook_1",
                step_type="WEBHOOK_TRIGGER",
                name="Inbound Hook",
                config={},
            )
        ],
        current_connections=[],
    )

    resp = await service.assist(req, provider_name="mock")
    assert resp.mode == "explanation"
    assert len(resp.message) > 20


@pytest.mark.asyncio
async def test_ai_workflow_template_suggestions():
    service = AIWorkflowGeneratorService()
    req = AIWorkflowAssistRequest(
        prompt="Show me workflow templates and examples",
        conversation_history=[],
        current_steps=[],
        current_connections=[],
    )

    resp = await service.assist(req, provider_name="mock")
    assert resp.mode == "suggestion"
    assert len(resp.template_suggestions) >= 1
    assert "Enterprise" in resp.template_suggestions[0].title


def test_calculate_diff_summary():
    curr_steps = [
        WorkflowStepSchema(step_key="trigger", step_type="WEBHOOK_TRIGGER", name="Start", config={}),
        WorkflowStepSchema(step_key="old_slack", step_type="SLACK_NOTIFICATION", name="Alert", config={"channel": "#old"}),
    ]
    curr_conns = [
        WorkflowConnectionSchema(source_step_key="trigger", target_step_key="old_slack")
    ]

    prop_steps = [
        WorkflowStepSchema(step_key="trigger", step_type="WEBHOOK_TRIGGER", name="Start", config={}),
        WorkflowStepSchema(step_key="approval", step_type="HUMAN_APPROVAL", name="Gate", config={"approver_role": "MANAGER"}),
        WorkflowStepSchema(step_key="old_slack", step_type="SLACK_NOTIFICATION", name="Alert", config={"channel": "#new"}),
    ]
    prop_conns = [
        WorkflowConnectionSchema(source_step_key="trigger", target_step_key="approval"),
        WorkflowConnectionSchema(source_step_key="approval", target_step_key="old_slack", condition_label="approved"),
    ]

    diff = calculate_diff_summary(curr_steps, curr_conns, prop_steps, prop_conns)
    assert len(diff.added_steps) == 1
    assert "approval" in diff.added_steps[0]
    assert len(diff.modified_steps) == 1
    assert "old_slack" in diff.modified_steps[0]
    assert len(diff.removed_steps) == 0
    assert len(diff.reconnected_edges) == 2


def test_compute_auto_layout():
    steps = [
        WorkflowStepSchema(step_key="t", step_type="WEBHOOK_TRIGGER", name="Trigger", config={}),
        WorkflowStepSchema(step_key="a", step_type="AI_CLASSIFICATION", name="AI", config={"prompt": "p"}),
        WorkflowStepSchema(step_key="b", step_type="SLACK_NOTIFICATION", name="Slack", config={"channel": "#c"}),
    ]
    conns = [
        WorkflowConnectionSchema(source_step_key="t", target_step_key="a"),
        WorkflowConnectionSchema(source_step_key="a", target_step_key="b"),
    ]

    positioned = compute_auto_layout(steps, conns)
    pos_map = {s.step_key: s.ui_position for s in positioned}
    # Topological Y increases from trigger down to Slack
    assert pos_map["t"]["y"] < pos_map["a"]["y"] < pos_map["b"]["y"]
