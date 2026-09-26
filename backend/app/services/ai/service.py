import asyncio
import json
import logging
import re
import time
from typing import Any, Dict, List, Optional
from pydantic import ValidationError

from app.core.config import settings
from app.schemas.ai import (
    ALLOWED_LEAD_CATEGORIES,
    AIProviderConfig,
    LeadClassificationInput,
    LeadClassificationResult,
)
from app.services.ai.base import AIProviderResponse, BaseAIProvider
from app.services.ai.factory import AIProviderFactory

logger = logging.getLogger("flowpilot.ai")


FALLBACK_KEYWORDS: Dict[str, List[str]] = {
    "enterprise": ["enterprise", "fortune", "global", "deployment", "scale", "security", "sla", "soc2"],
    "sales": ["sales", "pricing", "demo", "purchase", "quote", "buy", "deal", "budget"],
    "support": ["help", "question", "guidance", "assist", "inquiry", "how to"],
    "billing": ["billing", "invoice", "charge", "refund", "payment", "subscription", "price"],
    "technical": ["bug", "error", "crash", "issue", "broken", "failed", "exception"],
    "urgent": ["urgent", "asap", "critical", "emergency", "immediately", "priority", "p0"],
    "mid_market": ["growth", "mid-market", "expanding"],
    "smb": ["small business", "startup", "smb"],
    "spam": ["viagra", "casino", "lottery", "crypto scam", "click here"],
    "general": ["general", "other", "info"],
}


def extract_json_payload(raw_text: str) -> Dict[str, Any]:
    """
    Safely extracts JSON dictionary from raw provider output.
    Supports markdown JSON code blocks.
    Strictly forbids eval(), exec(), compile(), or dynamic code execution.
    """
    text = (raw_text or "").strip()
    if not text:
        raise ValueError("Provider output is empty")

    # Extract JSON inside markdown blocks if present
    if "```" in text:
        match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
        if match:
            text = match.group(1).strip()

    # Standard library JSON parsing only
    data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError("Parsed JSON payload is not a dictionary object")
    return data


class DeterministicFallbackClassifier:
    """
    Production fallback mechanism.
    Distinct from MockAIProvider (testing mock).
    Executes bounded, deterministic heuristic classification when external AI providers fail.
    """

    @classmethod
    def classify(
        cls,
        input_data: LeadClassificationInput,
        fallback_reason: str,
    ) -> LeadClassificationResult:
        start_time = time.monotonic()
        if not input_data.text or not input_data.text.strip():
            raise ValueError("Deterministic fallback failed: input text is empty")
        if not input_data.categories:
            raise ValueError("Deterministic fallback failed: candidate categories list is empty")

        text = input_data.text.strip().lower()
        categories = input_data.categories

        scores: Dict[str, int] = {cat: 0 for cat in categories}
        exact_category = None

        for cat in categories:
            cat_lower = cat.lower()
            if cat_lower in text:
                scores[cat] += 3
                if exact_category is None:
                    exact_category = cat

            keywords = FALLBACK_KEYWORDS.get(cat_lower, [cat_lower])
            for kw in keywords:
                if kw in text:
                    scores[cat] += 1

        max_score = max(scores.values()) if scores else 0
        if max_score > 0:
            candidates = [c for c, s in scores.items() if s == max_score]
            candidates.sort()  # Deterministic tie-break
            chosen_cat = candidates[0]
            confidence = 0.70 if len(candidates) > 1 else (0.85 if chosen_cat == exact_category else 0.75)
        else:
            chosen_cat = categories[0]
            confidence = 0.50

        # Assign conservative priority and action
        if chosen_cat in ("urgent", "p0"):
            priority = "urgent"
            action = "manual_escalation"
        elif chosen_cat == "enterprise":
            priority = "high"
            action = "manual_review"
        else:
            priority = "medium"
            action = "manual_review"

        reasoning = (
            f"Classified as '{chosen_cat}' by deterministic fallback classifier "
            f"following provider failure (reason: {fallback_reason})."
        )

        latency_ms = max(1, int((time.monotonic() - start_time) * 1000))

        return LeadClassificationResult(
            category=chosen_cat,
            priority=priority,
            confidence=confidence,
            reasoning=reasoning,
            suggested_action=action,
            tokens_used=0,
            prompt_tokens=0,
            completion_tokens=0,
            provider="fallback",
            model="deterministic-fallback-v1",
            latency_ms=latency_ms,
            is_fallback=True,
            fallback_reason=fallback_reason,
        )


class AIClassificationService:
    """
    Orchestrates AI lead classification, timeout enforcement, schema validation,
    and automatic deterministic fallback on provider failure.
    """

    def __init__(self, provider_factory: Optional[type[AIProviderFactory]] = None):
        self.factory = provider_factory or AIProviderFactory

    async def classify(
        self,
        input_data: LeadClassificationInput,
        config: Optional[AIProviderConfig] = None,
    ) -> LeadClassificationResult:
        cfg = config or AIProviderConfig(
            provider=settings.AI_PROVIDER,
            model=settings.AI_DEFAULT_MODEL,
            timeout_seconds=settings.AI_REQUEST_TIMEOUT_SECONDS,
        )

        fallback_reason: Optional[str] = None

        try:
            provider: BaseAIProvider = self.factory.get_provider(
                provider_name=cfg.provider,
                api_key=cfg.api_key,
            )

            # Enforce external provider timeout
            timeout_sec = cfg.timeout_seconds or settings.AI_REQUEST_TIMEOUT_SECONDS or 10.0
            provider_resp: AIProviderResponse = await asyncio.wait_for(
                provider.classify(input_data, cfg),
                timeout=timeout_sec,
            )

            # Safely parse JSON without eval/exec/compile
            parsed = extract_json_payload(provider_resp.raw_output)

            # Validate category against candidate categories
            cat = str(parsed.get("category", "")).strip().lower()
            if cat not in [c.lower() for c in input_data.categories]:
                raise ValueError(
                    f"Returned category '{cat}' not in candidate categories {input_data.categories}"
                )

            # Validate full schema strictly (e.g. rejects confidence out of [0, 1])
            validated = LeadClassificationResult(
                category=cat,
                priority=parsed.get("priority", "medium"),
                confidence=float(parsed["confidence"]),
                reasoning=str(parsed.get("reasoning", f"Classified by {provider_resp.provider}")),
                suggested_action=parsed.get("suggested_action"),
                tokens_used=provider_resp.total_tokens,
                prompt_tokens=provider_resp.prompt_tokens,
                completion_tokens=provider_resp.completion_tokens,
                provider=provider_resp.provider,
                model=provider_resp.model,
                latency_ms=provider_resp.latency_ms,
                is_fallback=False,
                fallback_reason=None,
            )
            return validated

        except asyncio.TimeoutError:
            fallback_reason = "timeout"
        except TimeoutError:
            fallback_reason = "timeout"
        except json.JSONDecodeError:
            fallback_reason = "malformed_response"
        except (ValidationError, ValueError) as e:
            err_msg = str(e).lower()
            if "confidence" in err_msg or "category" in err_msg or "priority" in err_msg:
                fallback_reason = "schema_validation_error"
            elif "not configured" in err_msg or "missing" in err_msg:
                fallback_reason = "missing_configuration"
            elif "unsupported ai provider" in err_msg:
                fallback_reason = "provider_unavailable"
            else:
                fallback_reason = "schema_validation_error"
        except RuntimeError as e:
            err_msg = str(e).lower()
            if "rate limit" in err_msg or "429" in err_msg:
                fallback_reason = "rate_limit"
            elif "auth" in err_msg or "401" in err_msg or "403" in err_msg:
                fallback_reason = "authentication_error"
            elif "network" in err_msg or "request error" in err_msg:
                fallback_reason = "network_error"
            else:
                fallback_reason = "provider_unavailable"
        except Exception:
            fallback_reason = "provider_unavailable"

        # Attempt deterministic fallback
        logger.warning(
            f"AI provider '{cfg.provider}' failed ({fallback_reason}). Attempting deterministic fallback."
        )

        try:
            fallback_result = DeterministicFallbackClassifier.classify(
                input_data=input_data,
                fallback_reason=fallback_reason,
            )
            return fallback_result
        except Exception as fb_err:
            # Both provider and fallback failed -> Fail workflow step
            raise RuntimeError(
                f"AI classification failed ({fallback_reason}) and deterministic fallback failed: {str(fb_err)}"
            ) from None
