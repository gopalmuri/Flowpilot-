import json
import pytest
from app.engine.condition_evaluator import (
    compare_values,
    evaluate_condition_rule,
    resolve_path_value,
)
from app.engine.sanitizer import (
    is_sensitive_key,
    mask_sensitive_data,
    sanitize_error_message,
    sanitize_payload,
    truncate_payload,
)
from app.engine.executors import MockAIClassificationExecutor
from app.engine.base import StepExecutionContext
import uuid


# ==============================================================================
# 1. Condition Evaluator Unit Tests
# ==============================================================================

def test_resolve_path_value():
    context = {
        "trigger": {"amount": 1500, "customer": {"email": "test@example.com"}},
        "step_1": {"output": {"priority": "high", "tags": ["enterprise", "vip"]}},
        "items": [{"id": "item_1"}, {"id": "item_2"}],
    }

    assert resolve_path_value("trigger.amount", context) == 1500
    assert resolve_path_value("trigger.customer.email", context) == "test@example.com"
    assert resolve_path_value("step_1.output.priority", context) == "high"
    assert resolve_path_value("items.1.id", context) == "item_2"
    assert resolve_path_value("nonexistent.path", context) is None
    assert resolve_path_value("trigger.nonexistent", context) is None
    assert resolve_path_value("", context) is None


def test_safe_comparison_operators():
    # Equality
    assert compare_values(10, "equals", 10) is True
    assert compare_values("active", "==", "active") is True
    assert compare_values("draft", "not_equals", "active") is True
    assert compare_values("test", "!=", "other") is True

    # Relational
    assert compare_values(100, "greater_than", 50) is True
    assert compare_values(50, ">", 100) is False
    assert compare_values(50, "less_than", 100) is True
    assert compare_values(100, "<", 50) is False
    assert compare_values(100, ">=", 100) is True
    assert compare_values(100, "<=", 100) is True

    # Containment
    assert compare_values("hello world", "contains", "world") is True
    assert compare_values(["urgent", "high"], "contains", "urgent") is True
    assert compare_values("hello world", "not_contains", "urgent") is True
    assert compare_values("vip", "in", ["vip", "standard"]) is True
    assert compare_values("bronze", "not_in", ["vip", "standard"]) is True

    # Null / Empty
    assert compare_values(None, "is_null", None) is True
    assert compare_values("not null", "is_null", None) is False
    assert compare_values("data", "is_not_null", None) is True
    assert compare_values("", "is_empty", None) is True
    assert compare_values([], "is_empty", None) is True
    assert compare_values({}, "is_empty", None) is True
    assert compare_values("content", "is_not_empty", None) is True


def test_type_mismatch_fails_safely():
    # Comparing incompatible types (e.g. str and int) should return False, not raise
    assert compare_values("100", ">", 50) is False
    assert compare_values(100, "<", "50") is False
    assert compare_values(None, ">", 10) is False


def test_unsupported_operator_raises_value_error():
    with pytest.raises(ValueError, match="Unsupported condition operator"):
        compare_values(10, "arbitrary_eval_op", 10)


def test_evaluate_condition_rule_multi_clause():
    context = {
        "trigger": {"amount": 2500, "category": "enterprise"},
    }

    # AND logic (both true)
    cfg_and = {
        "logic": "AND",
        "conditions": [
            {"field": "trigger.amount", "operator": "greater_than", "value": 1000},
            {"field": "trigger.category", "operator": "equals", "value": "enterprise"},
        ],
    }
    res, branch = evaluate_condition_rule(cfg_and, context)
    assert res is True
    assert branch == "true"

    # AND logic (one false)
    cfg_and_fail = {
        "logic": "AND",
        "conditions": [
            {"field": "trigger.amount", "operator": "greater_than", "value": 5000},
            {"field": "trigger.category", "operator": "equals", "value": "enterprise"},
        ],
    }
    res, branch = evaluate_condition_rule(cfg_and_fail, context)
    assert res is False
    assert branch == "false"

    # OR logic (one true)
    cfg_or = {
        "logic": "OR",
        "conditions": [
            {"field": "trigger.amount", "operator": "greater_than", "value": 5000},
            {"field": "trigger.category", "operator": "equals", "value": "enterprise"},
        ],
    }
    res, branch = evaluate_condition_rule(cfg_or, context)
    assert res is True
    assert branch == "true"


# ==============================================================================
# 2. Sanitizer Unit Tests
# ==============================================================================

def test_is_sensitive_key():
    assert is_sensitive_key("password") is True
    assert is_sensitive_key("User_Password") is True
    assert is_sensitive_key("api_key") is True
    assert is_sensitive_key("X-Auth-Token") is True
    assert is_sensitive_key("refresh_token") is True
    assert is_sensitive_key("access_token") is True
    assert is_sensitive_key("credit_card_number") is True
    assert is_sensitive_key("username") is False
    assert is_sensitive_key("email") is False


def test_mask_sensitive_data_nested():
    raw_payload = {
        "name": "Jane Doe",
        "email": "jane@example.com",
        "password": "SuperSecretPassword123!",
        "auth": {
            "token": "raw_secret_token_abc",
            "api_key": "sk-1234567890",
        },
        "records": [
            {"id": 1, "note": "Public note"},
            {"id": 2, "secret": "internal_secret_data"},
        ],
    }

    sanitized = mask_sensitive_data(raw_payload)
    assert sanitized["password"] == "[REDACTED]"
    assert sanitized["auth"]["token"] == "[REDACTED]"
    assert sanitized["auth"]["api_key"] == "[REDACTED]"
    assert sanitized["records"][1]["secret"] == "[REDACTED]"
    assert sanitized["name"] == "Jane Doe"
    assert sanitized["email"] == "jane@example.com"
    assert sanitized["records"][0]["note"] == "Public note"


def test_truncate_oversized_payload():
    # Create payload exceeding 64 KB
    large_payload = {
        "description": "A" * 70000,
        "items": list(range(500)),
    }

    truncated = truncate_payload(large_payload, max_bytes=65536)
    assert isinstance(truncated, dict)
    assert truncated["_truncated"] is True
    assert truncated["_original_size"] > 65536
    # Must produce valid JSON that is <= 65536 bytes
    dumped = json.dumps(truncated)
    assert len(dumped.encode("utf-8")) <= 65536


def test_sanitize_error_message():
    assert sanitize_error_message(None) is None
    msg_with_token = "Failed to connect with Bearer abcdef123456"
    cleaned = sanitize_error_message(msg_with_token)
    assert "[REDACTED]" in cleaned
    assert "abcdef123456" not in cleaned


# ==============================================================================
# 3. Deterministic Mock AI Classification Unit Tests
# ==============================================================================

@pytest.mark.asyncio
async def test_mock_ai_classifier_exact_and_keyword_matching():
    executor = MockAIClassificationExecutor()

    # Exact category match
    ctx_exact = StepExecutionContext(
        organization_id=uuid.uuid4(),
        workflow_run_id=uuid.uuid4(),
        step_id=uuid.uuid4(),
        step_key="ai_step",
        step_type="AI_CLASSIFICATION",
        config={"categories": ["urgent", "billing", "technical"]},
        workflow_data={},
        trigger_payload={"message": "This is an urgent matter regarding our account"},
    )
    res_exact = await executor.execute(ctx_exact)
    assert res_exact.status == "COMPLETED"
    assert res_exact.output_data["category"] == "urgent"
    assert res_exact.output_data["confidence"] == 0.95

    # Keyword match
    ctx_kw = StepExecutionContext(
        organization_id=uuid.uuid4(),
        workflow_run_id=uuid.uuid4(),
        step_id=uuid.uuid4(),
        step_key="ai_step",
        step_type="AI_CLASSIFICATION",
        config={"categories": ["urgent", "billing", "technical"]},
        workflow_data={},
        trigger_payload={"message": "We found a critical bug and need an invoice refund"},
    )
    res_kw = await executor.execute(ctx_kw)
    assert res_kw.status == "COMPLETED"
    # Both 'urgent' (critical) and 'technical' (bug) and 'billing' (invoice, refund) match
    assert res_kw.output_data["category"] in ["urgent", "billing", "technical"]


@pytest.mark.asyncio
async def test_mock_ai_classifier_tie_breaking_alphabetical():
    executor = MockAIClassificationExecutor()

    # Text contains keywords with equal scores for 'billing' (invoice) and 'technical' (bug)
    ctx_tie = StepExecutionContext(
        organization_id=uuid.uuid4(),
        workflow_run_id=uuid.uuid4(),
        step_id=uuid.uuid4(),
        step_key="ai_step",
        step_type="AI_CLASSIFICATION",
        config={"categories": ["technical", "billing"]},
        workflow_data={},
        trigger_payload={"message": "Please review this invoice and bug report"},
    )
    res_tie = await executor.execute(ctx_tie)
    assert res_tie.status == "COMPLETED"
    # 'billing' precedes 'technical' alphabetically
    assert res_tie.output_data["category"] == "billing"
    assert res_tie.output_data["confidence"] == 0.70


@pytest.mark.asyncio
async def test_mock_ai_classifier_fallback_default():
    executor = MockAIClassificationExecutor()

    ctx_fallback = StepExecutionContext(
        organization_id=uuid.uuid4(),
        workflow_run_id=uuid.uuid4(),
        step_id=uuid.uuid4(),
        step_key="ai_step",
        step_type="AI_CLASSIFICATION",
        config={"categories": ["inquiry", "support", "billing"]},
        workflow_data={},
        trigger_payload={"message": "Lorem ipsum dolor sit amet nonummy"},
    )
    res_fallback = await executor.execute(ctx_fallback)
    assert res_fallback.status == "COMPLETED"
    # Falls back to first category
    assert res_fallback.output_data["category"] == "inquiry"
    assert res_fallback.output_data["confidence"] == 0.50
