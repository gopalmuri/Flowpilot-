import ast
import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock, patch
import httpx
import pytest
from pydantic import ValidationError

from app.schemas.ai import (
    ALLOWED_LEAD_CATEGORIES,
    AIProviderConfig,
    LeadClassificationInput,
    LeadClassificationResult,
)
from app.services.ai.anthropic_provider import AnthropicProvider
from app.services.ai.base import AIProviderResponse
from app.services.ai.factory import AIProviderFactory
from app.services.ai.mock_provider import MockAIProvider
from app.services.ai.openai_provider import OpenAIProvider
from app.services.ai.service import (
    AIClassificationService,
    DeterministicFallbackClassifier,
    extract_json_payload,
)


# ==============================================================================
# 1. Strict Schema Validation Unit Tests
# ==============================================================================

def test_valid_schema_output():
    result = LeadClassificationResult(
        category="enterprise",
        priority="high",
        confidence=0.92,
        reasoning="Lead indicates 5000+ seat deployment.",
        suggested_action="create_crm_lead",
        tokens_used=50,
        prompt_tokens=30,
        completion_tokens=20,
        provider="mock",
        model="mock-model",
        latency_ms=12,
        is_fallback=False,
        fallback_reason=None,
    )
    assert result.category == "enterprise"
    assert result.priority == "high"
    assert result.confidence == 0.92
    assert result.tokens_used == 50
    assert result.is_fallback is False


def test_confidence_below_zero_rejected():
    with pytest.raises(ValidationError) as exc_info:
        LeadClassificationResult(
            category="sales",
            priority="medium",
            confidence=-0.05,
            reasoning="Invalid negative confidence",
            provider="mock",
            model="mock-model",
        )
    assert "greater than or equal to 0" in str(exc_info.value)


def test_confidence_above_one_rejected():
    # Strict validation: confidence > 1.0 must be rejected and NEVER silently clamped
    with pytest.raises(ValidationError) as exc_info:
        LeadClassificationResult(
            category="sales",
            priority="medium",
            confidence=1.05,
            reasoning="Invalid confidence above 1.0",
            provider="mock",
            model="mock-model",
        )
    assert "less than or equal to 1" in str(exc_info.value)

    # Specific 4.7 check mandated by spec
    with pytest.raises(ValidationError) as exc_info_47:
        LeadClassificationResult(
            category="sales",
            priority="medium",
            confidence=4.7,
            reasoning="Testing explicit 4.7 confidence rejection",
            provider="mock",
            model="mock-model",
        )
    assert "less than or equal to 1" in str(exc_info_47.value)


def test_unknown_category_rejected():
    with pytest.raises(ValidationError) as exc_info:
        LeadClassificationResult(
            category="unknown_alien_category",
            priority="low",
            confidence=0.5,
            reasoning="Unknown category",
            provider="mock",
            model="mock-model",
        )
    assert "Unknown category" in str(exc_info.value)


def test_missing_required_fields_rejected():
    with pytest.raises(ValidationError):
        # Missing category, confidence, reasoning, provider, model
        LeadClassificationResult.model_validate({})


def test_invalid_priority_rejected():
    with pytest.raises(ValidationError) as exc_info:
        LeadClassificationResult(
            category="sales",
            priority="super_urgent_critical",
            confidence=0.8,
            reasoning="Invalid priority level",
            provider="mock",
            model="mock-model",
        )
    assert "Unknown priority" in str(exc_info.value)


# ==============================================================================
# 2. Deterministic Mock Provider Unit Tests
# ==============================================================================

@pytest.mark.asyncio
async def test_deterministic_mock_provider_exact_match():
    provider = MockAIProvider()
    inp = LeadClassificationInput(
        text="We need enterprise support with SLA guarantees.",
        categories=["enterprise", "sales", "billing"],
    )
    cfg = AIProviderConfig(provider="mock", model="mock-test-v1")
    resp = await provider.classify(inp, cfg)

    assert isinstance(resp, AIProviderResponse)
    assert resp.provider == "mock"
    assert resp.model == "mock-test-v1"
    assert resp.prompt_tokens > 0
    assert resp.completion_tokens > 0
    assert resp.total_tokens == resp.prompt_tokens + resp.completion_tokens
    assert resp.latency_ms >= 0

    data = json.loads(resp.raw_output)
    assert data["category"] == "enterprise"
    assert data["confidence"] == 0.95
    assert data["priority"] == "high"


@pytest.mark.asyncio
async def test_deterministic_mock_provider_tie_breaking():
    provider = MockAIProvider()
    # "invoice" matches billing, "technical" matches technical
    inp = LeadClassificationInput(
        text="Please review this invoice and bug report.",
        categories=["technical", "billing"],
    )
    cfg = AIProviderConfig(provider="mock")
    resp = await provider.classify(inp, cfg)
    data = json.loads(resp.raw_output)

    # Billing precedes technical alphabetically
    assert data["category"] == "billing"
    assert data["confidence"] == 0.70


# ==============================================================================
# 3. Deterministic Fallback Classifier Unit Tests
# ==============================================================================

def test_deterministic_fallback_classifier_behavior():
    inp = LeadClassificationInput(
        text="Urgent outage on production billing server",
        categories=["urgent", "billing", "general"],
    )
    fallback_res = DeterministicFallbackClassifier.classify(
        input_data=inp,
        fallback_reason="timeout",
    )
    assert isinstance(fallback_res, LeadClassificationResult)
    assert fallback_res.is_fallback is True
    assert fallback_res.fallback_reason == "timeout"
    assert fallback_res.tokens_used == 0
    assert fallback_res.prompt_tokens == 0
    assert fallback_res.completion_tokens == 0
    assert fallback_res.provider == "fallback"
    assert fallback_res.model == "deterministic-fallback-v1"
    assert fallback_res.category in ["urgent", "billing"]
    assert 0.0 <= fallback_res.confidence <= 1.0


def test_deterministic_fallback_classifier_empty_input_fails():
    inp = LeadClassificationInput.model_construct(text="", categories=["general"])
    with pytest.raises(ValueError) as exc:
        DeterministicFallbackClassifier.classify(inp, fallback_reason="provider_unavailable")
    assert "input text is empty" in str(exc.value)


# ==============================================================================
# 4. Safe JSON Extraction & Parsing Unit Tests (Zero eval/exec/compile)
# ==============================================================================

def test_extract_json_clean():
    raw = '{"category": "sales", "confidence": 0.88}'
    extracted = extract_json_payload(raw)
    assert extracted == {"category": "sales", "confidence": 0.88}


def test_extract_json_markdown_wrapped():
    raw = '```json\n{\n  "category": "enterprise",\n  "confidence": 0.95\n}\n```'
    extracted = extract_json_payload(raw)
    assert extracted["category"] == "enterprise"
    assert extracted["confidence"] == 0.95


def test_extract_json_malformed_raises():
    raw = 'not a valid json payload'
    with pytest.raises(json.JSONDecodeError):
        extract_json_payload(raw)


# ==============================================================================
# 5. Mocked External Provider HTTP Tests (OpenAI & Anthropic)
# ==============================================================================

@pytest.mark.asyncio
async def test_openai_provider_success():
    provider = OpenAIProvider(api_key="sk-mock-valid-key")
    inp = LeadClassificationInput(text="Interested in purchasing 50 licenses")
    cfg = AIProviderConfig(provider="openai", model="gpt-4o-mini")

    mock_resp_data = {
        "choices": [{
            "message": {
                "content": json.dumps({
                    "category": "sales",
                    "priority": "medium",
                    "confidence": 0.91,
                    "reasoning": "Purchasing licenses indicates sales lead.",
                    "suggested_action": "create_crm_lead",
                })
            }
        }],
        "usage": {"prompt_tokens": 40, "completion_tokens": 25, "total_tokens": 65},
    }

    mock_http_resp = httpx.Response(200, json=mock_resp_data, request=httpx.Request("POST", "https://api.openai.com"))

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_http_resp
        resp = await provider.classify(inp, cfg)

        assert resp.provider == "openai"
        assert resp.total_tokens == 65
        assert "sales" in resp.raw_output


@pytest.mark.asyncio
async def test_openai_provider_rate_limit():
    provider = OpenAIProvider(api_key="sk-mock-valid-key")
    inp = LeadClassificationInput(text="Test rate limit handling")
    cfg = AIProviderConfig(provider="openai")

    mock_err_resp = httpx.Response(429, json={"error": "Rate limit exceeded"}, request=httpx.Request("POST", "https://api.openai.com"))

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.side_effect = httpx.HTTPStatusError("Rate limit", request=mock_err_resp.request, response=mock_err_resp)
        with pytest.raises(RuntimeError) as exc_info:
            await provider.classify(inp, cfg)
        assert "rate limit reached (HTTP 429)" in str(exc_info.value)


@pytest.mark.asyncio
async def test_openai_provider_timeout():
    provider = OpenAIProvider(api_key="sk-mock-valid-key")
    inp = LeadClassificationInput(text="Test timeout handling")
    cfg = AIProviderConfig(provider="openai", timeout_seconds=5.0)

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.side_effect = httpx.TimeoutException("Connection timed out")
        with pytest.raises(TimeoutError) as exc_info:
            await provider.classify(inp, cfg)
        assert "timed out" in str(exc_info.value)


@pytest.mark.asyncio
async def test_anthropic_provider_success():
    provider = AnthropicProvider(api_key="sk-ant-mock-key")
    inp = LeadClassificationInput(text="Need technical assistance with API integration")
    cfg = AIProviderConfig(provider="anthropic", model="claude-3-5-sonnet-20241022")

    mock_resp_data = {
        "content": [{
            "text": json.dumps({
                "category": "technical",
                "priority": "medium",
                "confidence": 0.89,
                "reasoning": "Inquiry regarding API integration.",
                "suggested_action": "route_to_technical",
            })
        }],
        "usage": {"input_tokens": 55, "output_tokens": 30},
    }

    mock_http_resp = httpx.Response(200, json=mock_resp_data, request=httpx.Request("POST", "https://api.anthropic.com"))

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_http_resp
        resp = await provider.classify(inp, cfg)

        assert resp.provider == "anthropic"
        assert resp.prompt_tokens == 55
        assert resp.completion_tokens == 30
        assert resp.total_tokens == 85
        assert "technical" in resp.raw_output


# ==============================================================================
# 6. Service Fallback Triggers Unit Tests
# ==============================================================================

@pytest.mark.asyncio
async def test_service_malformed_json_triggers_fallback():
    service = AIClassificationService()
    inp = LeadClassificationInput(text="Enterprise software inquiry with urgent timeline")

    # Mock provider returning malformed JSON
    mock_bad_resp = AIProviderResponse(raw_output="INVALID JSON NOT A DICT", provider="mock", total_tokens=10)
    with patch.object(MockAIProvider, "classify", new_callable=AsyncMock) as mock_classify:
        mock_classify.return_value = mock_bad_resp
        result = await service.classify(inp, AIProviderConfig(provider="mock"))

        assert result.is_fallback is True
        assert result.fallback_reason == "malformed_response"


@pytest.mark.asyncio
async def test_service_schema_invalid_confidence_triggers_fallback():
    service = AIClassificationService()
    inp = LeadClassificationInput(text="Enterprise software inquiry")

    # Provider returns confidence 4.7 (invalid)
    bad_json = json.dumps({
        "category": "enterprise",
        "priority": "high",
        "confidence": 4.7,
        "reasoning": "Bad confidence",
    })
    mock_bad_resp = AIProviderResponse(raw_output=bad_json, provider="mock", total_tokens=10)
    with patch.object(MockAIProvider, "classify", new_callable=AsyncMock) as mock_classify:
        mock_classify.return_value = mock_bad_resp
        result = await service.classify(inp, AIProviderConfig(provider="mock"))

        assert result.is_fallback is True
        assert result.fallback_reason == "schema_validation_error"
        # Fallback output has valid confidence
        assert 0.0 <= result.confidence <= 1.0


@pytest.mark.asyncio
async def test_service_timeout_triggers_fallback():
    service = AIClassificationService()
    inp = LeadClassificationInput(text="Urgent help requested")

    with patch.object(MockAIProvider, "classify", new_callable=AsyncMock) as mock_classify:
        mock_classify.side_effect = asyncio.TimeoutError()
        result = await service.classify(inp, AIProviderConfig(provider="mock"))

        assert result.is_fallback is True
        assert result.fallback_reason == "timeout"


@pytest.mark.asyncio
async def test_service_both_provider_and_fallback_failure_raises():
    service = AIClassificationService()
    # Empty text causes fallback to fail as well
    inp = LeadClassificationInput.model_construct(text="", categories=["general"])

    with patch.object(MockAIProvider, "classify", new_callable=AsyncMock) as mock_classify:
        mock_classify.side_effect = RuntimeError("Provider exploded")
        with pytest.raises(RuntimeError) as exc_info:
            await service.classify(inp, AIProviderConfig(provider="mock"))
        assert "AI classification failed" in str(exc_info.value)
        assert "deterministic fallback failed" in str(exc_info.value)


# ==============================================================================
# 7. Security Invariants: Zero Secret Exposure & Zero Code Execution
# ==============================================================================

def test_zero_eval_exec_compile_in_all_ai_modules():
    ai_dir = Path("backend/app/services/ai") if Path("backend/app/services/ai").exists() else Path("app/services/ai")
    py_files = list(ai_dir.glob("*.py"))
    assert len(py_files) >= 5, "AI service directory files not found"

    forbidden_calls = {"eval", "exec", "compile"}
    for fpath in py_files:
        tree = ast.parse(fpath.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                if isinstance(node.func, ast.Name):
                    assert node.func.id not in forbidden_calls, (
                        f"Forbidden dynamic execution call '{node.func.id}' found in {fpath}"
                    )


def test_zero_secret_exposure_in_provider_config():
    secret = "sk-live-super-secret-key-1234567890"
    cfg = AIProviderConfig(provider="openai", model="gpt-4o-mini", api_key=secret)

    # 1. model_dump() must exclude api_key
    dumped = cfg.model_dump()
    assert "api_key" not in dumped
    assert secret not in str(dumped)

    # 2. repr() and str() must not leak secret
    assert secret not in repr(cfg)
    assert secret not in str(cfg)


@pytest.mark.asyncio
async def test_zero_secret_exposure_in_error_messages():
    secret = "sk-live-secret-never-expose-998877"
    provider = OpenAIProvider(api_key=secret)
    inp = LeadClassificationInput(text="Inquiry about pricing")

    # Simulate network error with sensitive client
    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.side_effect = httpx.RequestError("Connection failed to api.openai.com")
        try:
            await provider.classify(inp, AIProviderConfig(provider="openai"))
        except RuntimeError as e:
            err_msg = str(e)
            assert secret not in err_msg, "API key leaked in exception message!"
