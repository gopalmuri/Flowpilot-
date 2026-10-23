"""Unit tests for the AI builder core: catalog consistency, repair loop, offline fallback, unsupported-request detection."""

import json

import pytest

from app.engine.base import StepExecutionContext
from app.engine.executors import AIExtractDataExecutor
from app.engine.registry import STEP_EXECUTOR_REGISTRY
from app.schemas.workflow import StepType
from app.schemas.workflow_ai import AIWorkflowAssistRequest
from app.services.ai.base import AIProviderResponse
from app.services.ai.setup_check import detect_unsupported
from app.services.ai.templates import TEMPLATES, match_templates
from app.services.ai.workflow_generator import SYSTEM_PROMPT, AIWorkflowGeneratorService
from app.services.workflow_catalog import CATALOG_BY_TYPE, STEP_CATALOG
from app.services.workflow_validator import validate_step_config, validate_workflow_dag


# ----------------------------------------------------------------------------- catalog
def test_every_step_type_is_in_catalog_registry_and_prompt():
    for step_type in StepType:
        assert step_type.value in CATALOG_BY_TYPE, f"{step_type.value} missing from catalog"
        assert step_type.value in STEP_EXECUTOR_REGISTRY, f"{step_type.value} has no executor"
        assert f'"{step_type.value}"' in SYSTEM_PROMPT, f"{step_type.value} not described to the AI"


def test_catalog_has_no_unknown_types_and_one_family_of_triggers():
    assert {s.step_type for s in STEP_CATALOG} == {t.value for t in StepType}
    assert {s.step_type for s in STEP_CATALOG if s.is_trigger} == {"WEBHOOK_TRIGGER", "MANUAL_TRIGGER"}


def test_branching_steps_declare_their_edge_labels():
    assert CATALOG_BY_TYPE["CONDITION"].edge_labels == ["true", "false"]
    assert CATALOG_BY_TYPE["HUMAN_APPROVAL"].edge_labels == ["approved", "rejected"]


def test_prompt_forbids_inventing_capabilities_and_unapproved_sending():
    assert "Workflow Architect" in SYSTEM_PROMPT  # the mock provider keys off this phrase
    assert "Never send without approval" in SYSTEM_PROMPT
    assert "Never invent a step type" in SYSTEM_PROMPT


def test_ai_extract_data_requires_fields():
    assert validate_step_config("x", "AI_EXTRACT_DATA", {})
    assert validate_step_config("x", "AI_EXTRACT_DATA", {"fields": []})
    assert validate_step_config("x", "AI_EXTRACT_DATA", {"fields": ["  "]})
    assert validate_step_config("x", "AI_EXTRACT_DATA", {"fields": ["name"]}) == []


# ----------------------------------------------------------------------------- templates
def test_templates_only_use_labels_from_the_catalog_and_have_prompts():
    assert len(TEMPLATES) >= 6
    ids = [t.id for t in TEMPLATES]
    assert len(ids) == len(set(ids))
    assert "Enterprise" in TEMPLATES[0].title
    for t in TEMPLATES:
        assert t.prompt.strip() and t.description.strip() and t.category


def test_match_templates_ranks_by_relevance():
    top = match_templates("invoice over a limit needs approval", limit=1)[0]
    assert "Invoice" in top.title


# ----------------------------------------------------------------------------- unsupported requests
@pytest.mark.parametrize(
    "prompt,expected",
    [
        ("send a WhatsApp message to the lead", "WhatsApp"),
        ("wait 2 days then follow up", "Waiting"),
        ("every Monday morning email the team", "schedule"),
        ("text message the customer", "SMS"),
    ],
)
def test_detects_requests_the_product_cannot_do(prompt, expected):
    found = detect_unsupported(prompt)
    assert found and any(expected.lower() in f.lower() for f in found)


def test_does_not_flag_supported_requests():
    assert detect_unsupported("when a lead arrives ask my manager to approve and notify Slack") == []


# ----------------------------------------------------------------------------- generator: repair + fallback
VALID = {
    "mode": "proposal",
    "message": "Done",
    "summary": "When a lead arrives, a manager approves, then it is added to the CRM.",
    "suggested_name": "Lead approval",
    "proposal": {
        "steps": [
            {"step_key": "t", "step_type": "WEBHOOK_TRIGGER", "name": "Lead arrives", "config": {}},
            {"step_key": "a", "step_type": "HUMAN_APPROVAL", "name": "Manager approves", "config": {"approver_role": "MANAGER"}},
            {"step_key": "c", "step_type": "MOCK_CRM_CREATE", "name": "Add to CRM", "config": {"entity_type": "lead"}},
        ],
        "connections": [
            {"source_step_key": "t", "target_step_key": "a"},
            {"source_step_key": "a", "target_step_key": "c", "condition_label": "approved"},
        ],
    },
}

INVALID_UNKNOWN_TYPE = {
    "mode": "proposal",
    "message": "Here",
    "proposal": {
        "steps": [
            {"step_key": "t", "step_type": "WEBHOOK_TRIGGER", "name": "Start", "config": {}},
            {"step_key": "w", "step_type": "SEND_WHATSAPP", "name": "WhatsApp", "config": {}},
        ],
        "connections": [{"source_step_key": "t", "target_step_key": "w"}],
    },
}


class ScriptedProvider:
    PROVIDER_NAME = "scripted"
    _model = "scripted-model"

    def __init__(self, outputs):
        self.outputs = list(outputs)
        self.calls = []

    async def generate_json(self, system_prompt, user_prompt, config):
        self.calls.append(user_prompt)
        out = self.outputs.pop(0)
        if isinstance(out, Exception):
            raise out
        return AIProviderResponse(raw_output=json.dumps(out), total_tokens=100, provider="scripted", model="scripted-model")


def _service(provider):
    class Factory:
        @classmethod
        def get_provider(cls, provider_name=None, api_key=None):
            return provider

    return AIWorkflowGeneratorService(provider_factory=Factory)


def _req(prompt="build it"):
    return AIWorkflowAssistRequest(prompt=prompt)


@pytest.mark.asyncio
async def test_invalid_proposal_is_repaired_before_the_user_sees_it():
    provider = ScriptedProvider([INVALID_UNKNOWN_TYPE, VALID])
    resp = await _service(provider).assist(_req(), provider_name="scripted")

    assert resp.mode == "proposal"
    assert resp.proposal.valid is True
    assert resp.repair_attempts == 1
    assert resp.tokens_used == 200  # both calls are counted
    assert resp.summary and resp.suggested_name == "Lead approval"
    # the model was told exactly what was wrong
    assert "SEND_WHATSAPP" in provider.calls[1] and "validation_errors" in provider.calls[1]


@pytest.mark.asyncio
async def test_repair_gives_up_after_two_attempts_and_reports_errors():
    provider = ScriptedProvider([INVALID_UNKNOWN_TYPE] * 3)
    resp = await _service(provider).assist(_req(), provider_name="scripted")

    assert resp.repair_attempts == 2
    assert resp.proposal.valid is False
    assert resp.proposal.errors
    assert "couldn't fully fix" in resp.message
    assert len(provider.calls) == 3


@pytest.mark.asyncio
async def test_unknown_step_type_is_an_error_not_silently_dropped():
    provider = ScriptedProvider([INVALID_UNKNOWN_TYPE] * 3)
    resp = await _service(provider).assist(_req(), provider_name="scripted")
    assert any("SEND_WHATSAPP" in e for e in resp.proposal.errors)


@pytest.mark.asyncio
async def test_provider_failure_falls_back_to_templates_without_crashing():
    provider = ScriptedProvider([RuntimeError("boom with secret-key-123")])
    resp = await _service(provider).assist(_req("approve invoices over a limit"), provider_name="scripted")

    assert resp.mode == "suggestion"
    assert resp.proposal is None
    assert resp.template_suggestions and "Invoice" in resp.template_suggestions[0].title
    assert "couldn't be reached" in resp.message
    assert "secret-key-123" not in resp.message  # provider error detail never reaches the user


@pytest.mark.asyncio
async def test_unparseable_model_output_falls_back():
    class Garbage(ScriptedProvider):
        async def generate_json(self, system_prompt, user_prompt, config):
            return AIProviderResponse(raw_output="not json at all", provider="scripted", model="m")

    resp = await _service(Garbage([])).assist(_req(), provider_name="scripted")
    assert resp.mode == "suggestion" and resp.template_suggestions


@pytest.mark.asyncio
async def test_clarification_questions_are_capped_at_three():
    many = {
        "mode": "clarification",
        "message": "A few questions",
        "clarification_questions": [{"id": f"q{i}", "question": f"Question {i}?", "options": ["a", "b"]} for i in range(6)],
    }
    resp = await _service(ScriptedProvider([many])).assist(_req(), provider_name="scripted")
    assert resp.mode == "clarification"
    assert len(resp.clarification_questions) == 3


@pytest.mark.asyncio
async def test_clarification_with_no_questions_is_not_shown_as_an_empty_card():
    resp = await _service(ScriptedProvider([{"mode": "clarification", "message": "Hmm"}])).assist(_req(), provider_name="scripted")
    assert resp.mode != "clarification"


@pytest.mark.asyncio
async def test_valid_first_try_makes_exactly_one_call():
    provider = ScriptedProvider([VALID])
    resp = await _service(provider).assist(_req(), provider_name="scripted")
    assert resp.repair_attempts == 0 and len(provider.calls) == 1
    assert validate_workflow_dag(resp.proposal.steps, resp.proposal.connections).valid


# ----------------------------------------------------------------------------- AI_EXTRACT_DATA executor
def _ctx(config, trigger_payload=None, workflow_data=None):
    import uuid

    return StepExecutionContext(
        organization_id=uuid.uuid4(),
        workflow_run_id=uuid.uuid4(),
        step_id=uuid.uuid4(),
        step_key="extract",
        step_type="AI_EXTRACT_DATA",
        config=config,
        trigger_payload=trigger_payload or {},
        workflow_data=workflow_data or {},
    )


@pytest.mark.asyncio
async def test_extract_copies_fields_already_in_the_payload_without_a_model_call(monkeypatch):
    monkeypatch.setattr("app.engine.executors.settings.AI_PROVIDER", "groq")  # would fail if it tried to call a model
    res = await AIExtractDataExecutor().execute(_ctx({"fields": ["name", "company"]}, {"name": "Asha", "company": "Acme"}))
    assert res.status == "COMPLETED"
    assert res.output_data["extracted"] == {"name": "Asha", "company": "Acme"}
    assert res.output_data["method"] == "payload"
    assert res.output_data["name"] == "Asha"  # also flattened for downstream conditions


@pytest.mark.asyncio
async def test_extract_fails_clearly_when_there_is_no_text(monkeypatch):
    res = await AIExtractDataExecutor().execute(_ctx({"fields": ["name"]}, {"unrelated": 1}))
    assert res.status == "FAILED" and "no text" in res.error_message.lower()


@pytest.mark.asyncio
async def test_extract_without_a_model_returns_nulls_never_invented_values(monkeypatch):
    monkeypatch.setattr("app.engine.executors.settings.AI_PROVIDER", "mock")
    res = await AIExtractDataExecutor().execute(_ctx({"fields": ["name", "amount"]}, {"message": "Hi, I'm Asha, want a quote"}))
    assert res.status == "COMPLETED"
    assert res.output_data["extracted"] == {"name": None, "amount": None}
    assert res.output_data["method"] == "unavailable"


@pytest.mark.asyncio
async def test_extract_requires_fields():
    res = await AIExtractDataExecutor().execute(_ctx({"fields": []}, {"message": "x"}))
    assert res.status == "FAILED"


# ----------------------------------------------------------------------------- flows that would fail at runtime
from app.services.workflow_catalog import flow_semantic_errors  # noqa: E402


def _flow(steps, edges):
    return (
        [{"step_key": k, "step_type": t, "config": cfg} for k, t, cfg in steps],
        [{"source_step_key": a, "target_step_key": b, "condition_label": lbl} for a, b, lbl in edges],
    )


def test_analyze_message_after_manual_start_is_rejected():
    steps, edges = _flow(
        [("m", "MANUAL_TRIGGER", {}), ("an", "AI_ANALYZE_MESSAGE", {})],
        [("m", "an", None)],
    )
    errors = flow_semantic_errors(steps, edges)
    assert errors and "WEBHOOK_TRIGGER" in errors[0]


def test_analyze_message_after_webhook_is_fine():
    steps, edges = _flow([("w", "WEBHOOK_TRIGGER", {}), ("an", "AI_ANALYZE_MESSAGE", {})], [("w", "an", None)])
    assert flow_semantic_errors(steps, edges) == []


def test_send_reply_needs_a_draft_and_an_approval_upstream():
    only_trigger = _flow([("w", "WEBHOOK_TRIGGER", {}), ("s", "SEND_REPLY", {})], [("w", "s", None)])
    errors = flow_semantic_errors(*only_trigger)
    assert any("AI_ANALYZE_MESSAGE" in e for e in errors) and any("HUMAN_APPROVAL" in e for e in errors)

    no_approval = _flow(
        [("w", "WEBHOOK_TRIGGER", {}), ("an", "AI_ANALYZE_MESSAGE", {}), ("s", "SEND_REPLY", {})],
        [("w", "an", None), ("an", "s", None)],
    )
    errors = flow_semantic_errors(*no_approval)
    assert len(errors) == 1 and "HUMAN_APPROVAL" in errors[0]


def test_complete_reply_flow_passes():
    steps, edges = _flow(
        [("w", "WEBHOOK_TRIGGER", {}), ("an", "AI_ANALYZE_MESSAGE", {}), ("ap", "HUMAN_APPROVAL", {"approver_role": "MANAGER"}), ("s", "SEND_REPLY", {})],
        [("w", "an", None), ("an", "ap", None), ("ap", "s", "approved")],
    )
    assert flow_semantic_errors(steps, edges) == []


def test_slack_placeholders_must_use_supported_namespaces():
    bad = _flow([("w", "WEBHOOK_TRIGGER", {}), ("sl", "SLACK_NOTIFICATION", {"message": "New lead {{email}}"})], [("w", "sl", None)])
    assert any("placeholder" in e for e in flow_semantic_errors(*bad))
    good = _flow([("w", "WEBHOOK_TRIGGER", {}), ("sl", "SLACK_NOTIFICATION", {"message": "New lead {{ trigger.email }} {{ steps.x.name }}"})], [("w", "sl", None)])
    assert flow_semantic_errors(*good) == []


MANUAL_ANALYZE = {
    "mode": "proposal",
    "message": "Here",
    "proposal": {
        "steps": [
            {"step_key": "m", "step_type": "MANUAL_TRIGGER", "name": "Start", "config": {}},
            {"step_key": "an", "step_type": "AI_ANALYZE_MESSAGE", "name": "Read", "config": {}},
        ],
        "connections": [{"source_step_key": "m", "target_step_key": "an"}],
    },
}


@pytest.mark.asyncio
async def test_builder_repairs_a_flow_that_would_fail_at_runtime():
    fixed = {
        "mode": "proposal",
        "message": "Fixed",
        "proposal": {
            "steps": [
                {"step_key": "w", "step_type": "WEBHOOK_TRIGGER", "name": "Message arrives", "config": {}},
                {"step_key": "an", "step_type": "AI_ANALYZE_MESSAGE", "name": "Read", "config": {}},
            ],
            "connections": [{"source_step_key": "w", "target_step_key": "an"}],
        },
    }
    provider = ScriptedProvider([MANUAL_ANALYZE, fixed])
    resp = await _service(provider).assist(_req(), provider_name="scripted")
    assert resp.proposal.valid is True and resp.repair_attempts == 1
    assert "WEBHOOK_TRIGGER" in provider.calls[1]  # the model was told why
