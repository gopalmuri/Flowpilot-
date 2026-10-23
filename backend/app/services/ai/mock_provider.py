import json
import re
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

    async def generate_json(
        self,
        system_prompt: str,
        user_prompt: str,
        config: AIProviderConfig,
    ) -> AIProviderResponse:
        """
        Deterministic structured analysis for development and tests. No network, no invented
        facts: the draft only acknowledges the message and asks clarifying questions.
        """
        start_time = time.monotonic()

        # Handle Workflow Assistant requests in tests and offline mock mode
        if "Workflow Architect" in system_prompt or "AI Test Engineer" in system_prompt:
            prompt_lower = user_prompt.lower()
            if "clarify" in prompt_lower or "missing" in prompt_lower:
                payload = {
                    "mode": "clarification",
                    "message": "Which Slack channel should notifications be sent to?",
                    "clarification_questions": [
                        {
                            "id": "channel_select",
                            "question": "Which channel should receive alerts?",
                            "options": ["#sales-alerts", "#executive-escalations", "#general"],
                        }
                    ],
                }
            elif "fix validation" in prompt_lower or "repair" in prompt_lower:
                payload = {
                    "mode": "proposal",
                    "message": "I have analyzed the validation issues and repaired the DAG by adding missing condition branches and reconnecting orphan nodes.",
                    "proposal": {
                        "steps": [
                            {
                                "step_key": "webhook_1",
                                "step_type": "WEBHOOK_TRIGGER",
                                "name": "Incoming Lead Webhook",
                                "config": {"allowed_methods": ["POST"]},
                            },
                            {
                                "step_key": "condition_1",
                                "step_type": "CONDITION",
                                "name": "Check Priority",
                                "config": {"field": "priority", "operator": "equals", "value": "high"},
                            },
                            {
                                "step_key": "approval_1",
                                "step_type": "HUMAN_APPROVAL",
                                "name": "Manager Review Gate",
                                "config": {"approver_role": "MANAGER", "timeout_hours": 24},
                            },
                            {
                                "step_key": "slack_alert_1",
                                "step_type": "SLACK_NOTIFICATION",
                                "name": "Alert High Priority",
                                "config": {"channel": "#alerts"},
                            },
                            {
                                "step_key": "slack_alert_default",
                                "step_type": "SLACK_NOTIFICATION",
                                "name": "Standard Notification",
                                "config": {"channel": "#general"},
                            },
                        ],
                        "connections": [
                            {"source_step_key": "webhook_1", "target_step_key": "condition_1"},
                            {"source_step_key": "condition_1", "target_step_key": "approval_1", "condition_label": "true"},
                            {"source_step_key": "condition_1", "target_step_key": "slack_alert_default", "condition_label": "false"},
                            {"source_step_key": "approval_1", "target_step_key": "slack_alert_1", "condition_label": "approved"},
                        ],
                        "warnings": [],
                    },
                }
            elif "explain" in prompt_lower or "audit" in prompt_lower:
                payload = {
                    "mode": "explanation",
                    "message": "This workflow ingests inbound leads via webhook, classifies lead intent using AI, and routes high-value enterprise leads to a human review gate before syncing to CRM.",
                }

            elif "generate a realistic json input payload" in prompt_lower or "simulate payload" in prompt_lower:
                if "edge_case" in prompt_lower:
                    payload = {
                        "scenario": "edge_case",
                        "summary": "Boundary value payload testing exact score threshold and null optional attributes.",
                        "payload": {
                            "lead_score": 75,
                            "email": "boundary.user@domain.co",
                            "company": "Boundary Corp",
                            "notes": None,
                            "tier": "standard",
                        },
                        "target_trigger": "webhook_1",
                    }
                elif "failure" in prompt_lower or "rejection" in prompt_lower:
                    payload = {
                        "scenario": "failure",
                        "summary": "Negative branch payload designed to test rejection and routing to fallback notification.",
                        "payload": {
                            "lead_score": 25,
                            "email": "spam.account@tempmail.com",
                            "company": "Unknown",
                            "tier": "low",
                        },
                        "target_trigger": "webhook_1",
                    }
                else:
                    payload = {
                        "scenario": "happy_path",
                        "summary": "Enterprise qualifying lead payload satisfying all required conditions and human gate thresholds.",
                        "payload": {
                            "lead_score": 92,
                            "email": "alex.morgan@enterprise-scale.com",
                            "company": "Enterprise Scale Inc",
                            "arr_estimate": 120000,
                            "tier": "enterprise",
                        },
                        "target_trigger": "webhook_1",
                    }
            else:
                # Propose a standard, valid workflow DAG
                payload = {
                    "mode": "proposal",
                    "message": "I've drafted a fault-tolerant workflow based on your requirements. Review the proposed steps and connections on your canvas:",
                    "proposal": {
                        "steps": [
                            {
                                "step_key": "webhook_1",
                                "step_type": "WEBHOOK_TRIGGER",
                                "name": "Incoming Lead Webhook",
                                "config": {"allowed_methods": ["POST"]},
                            },
                            {
                                "step_key": "ai_classify_1",
                                "step_type": "AI_CLASSIFICATION",
                                "name": "AI Intent Triage",
                                "config": {"prompt": "Classify lead tier", "categories": ["enterprise", "mid_market", "smb"]},
                            },
                            {
                                "step_key": "condition_1",
                                "step_type": "CONDITION",
                                "name": "Check Enterprise Tier",
                                "config": {"field": "category", "operator": "equals", "value": "enterprise"},
                            },
                            {
                                "step_key": "approval_1",
                                "step_type": "HUMAN_APPROVAL",
                                "name": "Manager Sign-off Gate",
                                "config": {"approver_role": "MANAGER", "timeout_hours": 24},
                            },
                            {
                                "step_key": "crm_lead_1",
                                "step_type": "MOCK_CRM_CREATE",
                                "name": "Sync to Mock CRM",
                                "config": {"entity_type": "lead"},
                            },
                            {
                                "step_key": "slack_alert_1",
                                "step_type": "SLACK_NOTIFICATION",
                                "name": "Alert Sales Team",
                                "config": {"channel": "#sales-alerts"},
                            },
                        ],
                        "connections": [
                            {"source_step_key": "webhook_1", "target_step_key": "ai_classify_1"},
                            {"source_step_key": "ai_classify_1", "target_step_key": "condition_1"},
                            {"source_step_key": "condition_1", "target_step_key": "approval_1", "condition_label": "true"},
                            {"source_step_key": "condition_1", "target_step_key": "crm_lead_1", "condition_label": "false"},
                            {"source_step_key": "approval_1", "target_step_key": "crm_lead_1", "condition_label": "approved"},
                            {"source_step_key": "crm_lead_1", "target_step_key": "slack_alert_1"},
                        ],
                        "warnings": [],
                    },
                }

            return AIProviderResponse(
                raw_output=json.dumps(payload),
                prompt_tokens=len(user_prompt) // 4,
                completion_tokens=150,
                total_tokens=len(user_prompt) // 4 + 150,
                provider="mock",
                model="mock-model",
                latency_ms=max(1, int((time.monotonic() - start_time) * 1000)),
            )

        match = re.search(r"<untrusted_message>\n(.*?)\n</untrusted_message>", user_prompt, re.DOTALL)
        body = (match.group(1) if match else user_prompt).lower()
        name_match = re.search(r"<sender>(.*?)</sender>", user_prompt)
        name = (name_match.group(1) if name_match else "").strip()
        greeting = f"Hello {name}," if name and name != "(unknown)" else "Hello,"


        if any(k in body for k in MOCK_KEYWORDS["spam"]):
            category, action, draft = "spam", "ignore", None
        elif any(k in body for k in ("price", "pricing", "quote", "cost", "budget")):
            category, action = "pricing_request", "ask_clarification"
        elif any(k in body for k in ("bug", "error", "broken", "not working", "issue")):
            category, action = "support_request", "draft_reply"
        elif any(k in body for k in ("partner", "collaborat")):
            category, action = "partnership", "draft_reply"
        elif any(k in body for k in ("project", "build", "develop", "solution", "automation", "ai")):
            category, action = "new_project", "ask_clarification"
        else:
            category, action = "other", "draft_reply"

        if category != "spam":
            draft = (
                f"{greeting}\n\nThank you for reaching out. We have received your message and a member of our "
                "team will review it. To help us respond properly, could you share more detail about your goals, "
                "the scope of what you need, and your preferred timeline?\n\nBest regards,\nThe Team"
            )
        first_line = next((ln.strip() for ln in body.splitlines() if ln.strip() and not ln.startswith("subject:")), "")
        payload = {
            "category": category,
            "summary": (first_line or "No content")[:300],
            "requirements": [first_line[:200]] if first_line else [],
            "missing_information": ["scope", "timeline"] if category in ("new_project", "pricing_request") else [],
            "urgency": "high" if any(k in body for k in ("urgent", "asap", "immediately")) else "medium",
            "recommended_action": action,
            "confidence": 0.8,
            "uncertainty_notes": None,
            "injection_suspected": False,
            "reply_draft": draft,
        }
        return AIProviderResponse(
            raw_output=json.dumps(payload),
            prompt_tokens=len(user_prompt) // 4,
            completion_tokens=100,
            total_tokens=len(user_prompt) // 4 + 100,
            provider="mock",
            model="mock-model",
            latency_ms=max(1, int((time.monotonic() - start_time) * 1000)),
        )
