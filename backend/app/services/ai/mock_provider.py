import json
import time
from typing import Dict, List
from app.schemas.ai import AIProviderConfig, LeadClassificationInput
from app.services.ai.base import AIProviderResponse, BaseAIProvider

MOCK_KEYWORDS: Dict[str, List[str]] = {
    "urgent": ["urgent", "asap", "critical", "immediately", "emergency", "high", "p0", "priority"],
    "billing": ["billing", "invoice", "charge", "refund", "payment", "subscription", "price", "credit"],
    "technical": ["technical", "bug", "error", "crash", "issue", "broken", "failed", "exception", "defect"],
    "sales": ["sales", "pricing", "demo", "purchase", "enterprise", "quote", "buy", "deal"],
    "support": ["help", "question", "how to", "inquiry", "support", "guidance"],
    "inquiry": ["inquiry", "question", "how to", "help", "support", "guidance"],
    "enterprise": ["enterprise", "fortune", "global", "deployment", "scale", "security", "sla", "soc2"],
    "mid_market": ["growth", "mid-market", "expanding"],
    "smb": ["small business", "startup", "smb"],
    "spam": ["viagra", "casino", "lottery", "crypto scam", "click here"],
    "general": ["general", "other", "info"],
    "standard": ["standard", "normal"],
    "low": ["low", "minor", "low priority"],
}


class MockAIProvider(BaseAIProvider):
    """
    Deterministic test provider for unit, integration, and CI testing.
    Never executes external network requests.
    Computes deterministic classifications, simulated token usage, and latency.
    """

    async def classify(
        self,
        input_data: LeadClassificationInput,
        config: AIProviderConfig,
    ) -> AIProviderResponse:
        start_time = time.monotonic()
        text = input_data.text or ""
        normalized = text.strip().lower()
        categories = input_data.categories

        scores: Dict[str, int] = {cat: 0 for cat in categories}
        matched_keywords: Dict[str, List[str]] = {cat: [] for cat in categories}
        exact_match_found = False
        exact_category = None

        for cat in categories:
            cat_lower = cat.lower()
            if cat_lower in normalized:
                scores[cat] += 3
                matched_keywords[cat].append(cat_lower)
                exact_match_found = True
                if exact_category is None:
                    exact_category = cat

            keywords = MOCK_KEYWORDS.get(cat_lower, [cat_lower])
            for kw in keywords:
                if kw in normalized and kw not in matched_keywords[cat]:
                    scores[cat] += 1
                    matched_keywords[cat].append(kw)

        max_score = max(scores.values()) if scores else 0

        if max_score > 0:
            top_candidates = [c for c, s in scores.items() if s == max_score]
            # Tie-break: alphabetical sort for determinism
            top_candidates.sort()
            chosen_cat = top_candidates[0]

            if len(top_candidates) > 1:
                confidence = 0.70
            elif exact_match_found and chosen_cat == exact_category:
                confidence = 0.95
            else:
                confidence = 0.85
        else:
            chosen_cat = categories[0] if categories else "general"
            confidence = 0.50

        # Determine priority and suggested action
        if chosen_cat in ("urgent", "p0"):
            priority = "urgent"
            suggested_action = "escalate_immediately"
        elif chosen_cat == "enterprise":
            priority = "high"
            suggested_action = "create_crm_lead"
        elif chosen_cat in ("sales", "billing", "technical"):
            priority = "medium"
            suggested_action = "route_to_department"
        else:
            priority = "low"
            suggested_action = "archive_or_review"

        reasoning = f"Lead matched keywords and rules for {chosen_cat} category."

        output_dict = {
            "category": chosen_cat,
            "priority": priority,
            "confidence": confidence,
            "reasoning": reasoning,
            "suggested_action": suggested_action,
        }
        raw_output = json.dumps(output_dict)

        # Simulated token counts based on text length
        prompt_tokens = max(1, len(text.split())) + 15
        completion_tokens = max(1, len(raw_output.split()))
        total_tokens = prompt_tokens + completion_tokens

        duration_ms = max(1, int((time.monotonic() - start_time) * 1000))

        return AIProviderResponse(
            raw_output=raw_output,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            provider="mock",
            model=config.model or "mock-deterministic-v1",
            latency_ms=duration_ms,
        )
