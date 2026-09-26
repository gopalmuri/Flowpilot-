import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from app.core.config import settings
from app.engine.base import BaseStepExecutor, StepExecutionContext, StepExecutionResult
from app.engine.condition_evaluator import evaluate_condition_rule
from app.engine.sanitizer import sanitize_error_message, sanitize_payload
from app.schemas.ai import (
    ALLOWED_LEAD_CATEGORIES,
    AIProviderConfig,
    LeadClassificationInput,
    LeadClassificationResult,
)
from app.services.ai.service import AIClassificationService
from app.services.crm.mock_crm_service import MockCRMService
from app.services.slack.slack_service import SlackService


class TriggerExecutor(BaseStepExecutor):
    """
    Handles WEBHOOK_TRIGGER and MANUAL_TRIGGER.
    Sanitizes incoming trigger payload and passes it forward into workflow data.
    Never executes external network requests.
    """

    async def execute(self, ctx: StepExecutionContext) -> StepExecutionResult:
        sanitized = sanitize_payload(ctx.trigger_payload)
        return StepExecutionResult(
            status="COMPLETED",
            output_data={
                "trigger_type": ctx.step_type,
                "payload": sanitized,
                "received_at": datetime.now(timezone.utc).isoformat(),
            },
        )


class ValidateDataExecutor(BaseStepExecutor):
    """
    Handles VALIDATE_DATA.
    Evaluates trigger payload or upstream workflow data against required fields.
    Deterministic failure occurs if mandatory attributes are absent.
    """

    async def execute(self, ctx: StepExecutionContext) -> StepExecutionResult:
        config = ctx.config or {}
        required_fields: List[str] = config.get("required_fields") or []

        candidate_data: Dict[str, Any] = dict(ctx.trigger_payload)
        for step_k, step_out in ctx.workflow_data.items():
            if isinstance(step_out, dict):
                candidate_data[step_k] = step_out

        missing_fields: List[str] = []
        for field in required_fields:
            if field not in candidate_data or candidate_data[field] is None:
                nested = candidate_data.get("payload", {})
                if isinstance(nested, dict) and field in nested and nested[field] is not None:
                    continue
                missing_fields.append(field)

        if missing_fields:
            return StepExecutionResult(
                status="FAILED",
                error_message=f"Validation failed: missing required fields: {', '.join(missing_fields)}",
                output_data={"valid": False, "missing_fields": missing_fields},
            )

        return StepExecutionResult(
            status="COMPLETED",
            output_data={
                "valid": True,
                "validated_fields": required_fields,
                "data": sanitize_payload(candidate_data),
            },
        )


class ConditionRuleExecutor(BaseStepExecutor):
    """
    Handles CONDITION.
    Evaluates explicit comparison operators safely without eval() or exec().
    Selects active outgoing branch edge ('true' / 'false' or matching label).
    """

    async def execute(self, ctx: StepExecutionContext) -> StepExecutionResult:
        config = ctx.config or {}
        context = {
            "trigger": ctx.trigger_payload,
            "trigger_payload": ctx.trigger_payload,
            "workflow_data": ctx.workflow_data,
            **ctx.trigger_payload,
            **ctx.workflow_data,
        }
        for s_key, s_data in ctx.workflow_data.items():
            if isinstance(s_data, dict):
                for k, v in s_data.items():
                    if k not in context:
                        context[k] = v

        try:
            passed, selected_branch = evaluate_condition_rule(
                config=config,
                context=context,
            )

            return StepExecutionResult(
                status="COMPLETED",
                selected_branch=selected_branch,
                output_data={
                    "evaluation_result": passed,
                    "selected_branch": selected_branch,
                },
            )
        except Exception as e:
            return StepExecutionResult(
                status="FAILED",
                error_message=f"Condition evaluation failed: {str(e)}",
            )


class MockCRMCreateExecutor(BaseStepExecutor):
    """
    Handles MOCK_CRM_CREATE.
    Creates or updates a lead record in MockCRMService with atomic deduplication.
    """

    def __init__(self, crm_service: Optional[MockCRMService] = None):
        self.crm_service = crm_service or MockCRMService()

    async def execute(self, ctx: StepExecutionContext) -> StepExecutionResult:
        config = ctx.config or {}
        mapping = config.get("mapping", {})

        resolved_attrs: Dict[str, Any] = {}
        for crm_field, source_field in mapping.items():
            if isinstance(source_field, str):
                val = ctx.trigger_payload.get(source_field)
                if val is None:
                    for s_data in ctx.workflow_data.values():
                        if isinstance(s_data, dict) and source_field in s_data:
                            val = s_data[source_field]
                            break
                resolved_attrs[crm_field] = val if val is not None else source_field
            else:
                resolved_attrs[crm_field] = source_field

        # Auto-extract common lead attributes if not explicitly in mapping
        for candidate in ["email", "company", "first_name", "last_name", "phone", "deal_size", "lead_score"]:
            if candidate not in resolved_attrs:
                if candidate in ctx.trigger_payload:
                    resolved_attrs[candidate] = ctx.trigger_payload[candidate]
                else:
                    for s_data in ctx.workflow_data.values():
                        if isinstance(s_data, dict) and candidate in s_data:
                            resolved_attrs[candidate] = s_data[candidate]
                            break

        # If upstream AI classification ran, capture category and priority
        for s_data in ctx.workflow_data.values():
            if isinstance(s_data, dict) and "category" in s_data and "confidence" in s_data:
                if "category" not in resolved_attrs:
                    resolved_attrs["category"] = s_data["category"]
                if "priority" not in resolved_attrs and "priority" in s_data:
                    resolved_attrs["priority"] = s_data["priority"]
                break

        sanitized_attrs = sanitize_payload(resolved_attrs)

        try:
            result = await self.crm_service.create_lead(
                organization_id=str(ctx.organization_id),
                lead_data=sanitized_attrs,
                simulated_latency_ms=config.get("simulated_latency_ms"),
            )
            return StepExecutionResult(
                status="COMPLETED",
                output_data=result,
            )
        except Exception as e:
            return StepExecutionResult(
                status="FAILED",
                error_message=sanitize_error_message(f"Mock CRM lead creation failed: {str(e)}"),
            )


class MockSlackNotificationExecutor(BaseStepExecutor):
    """
    Handles SLACK_NOTIFICATION.
    Dispatches notifications via SlackService with safe template interpolation and Block Kit formatting.
    """

    def __init__(self, slack_service: Optional[SlackService] = None):
        self.slack_service = slack_service or SlackService()

    async def execute(self, ctx: StepExecutionContext) -> StepExecutionResult:
        config = ctx.config or {}
        channel = config.get("channel", "#general")
        message_template = config.get("message") or "Workflow notification"

        # Build interpolation context
        context: Dict[str, Any] = {
            "trigger": ctx.trigger_payload or {},
            "steps": ctx.workflow_data or {},
            "lead": {},
            "ai": {},
        }

        # Auto-populate lead from any upstream CRM create step if present
        for s_data in ctx.workflow_data.values():
            if isinstance(s_data, dict):
                if "crm_id" in s_data:
                    context["lead"] = s_data.get("attributes", s_data)
                if "category" in s_data and "confidence" in s_data:
                    context["ai"] = s_data

        # Render message
        rendered_message = self.slack_service.interpolate_template(message_template, context)

        # Generate Block Kit blocks if requested or if lead card is enabled
        blocks = config.get("blocks")
        if not blocks and (config.get("include_lead_card", True) and context.get("lead")):
            blocks = self.slack_service.format_lead_notification(
                lead=context["lead"],
                classification=context.get("ai"),
                channel=channel,
            )["blocks"]

        webhook_url = config.get("webhook_url") or "mock://slack"
        mock_mode = config.get("mock_mode", True)

        try:
            delivery = await self.slack_service.send_notification(
                webhook_url=webhook_url,
                message=rendered_message,
                blocks=blocks,
                channel=channel,
                mock_mode=mock_mode,
            )
            return StepExecutionResult(
                status="COMPLETED",
                output_data=delivery,
            )
        except Exception as e:
            return StepExecutionResult(
                status="FAILED",
                error_message=sanitize_error_message(f"Slack notification delivery failed: {str(e)}"),
            )


# Backward compatibility alias
SlackNotificationExecutor = MockSlackNotificationExecutor


class AIClassificationExecutor(BaseStepExecutor):
    """
    Handles AI_CLASSIFICATION.
    Invokes AIClassificationService to classify leads into structured, validated data.
    Enforces strict zero-secret-exposure and safe execution boundaries.
    Never executes external tools, CRM actions, or workflow transitions directly.
    """

    def __init__(self, ai_service: Optional[AIClassificationService] = None):
        self.ai_service = ai_service or AIClassificationService()

    async def execute(self, ctx: StepExecutionContext) -> StepExecutionResult:
        config = ctx.config or {}

        # 1. Extract input text from config, trigger_payload, or upstream workflow steps
        input_text = config.get("text") or config.get("prompt") or ""
        if not input_text and ctx.trigger_payload:
            for candidate_key in ["message", "text", "body", "email", "subject", "description", "content"]:
                val = ctx.trigger_payload.get(candidate_key)
                if val and isinstance(val, str) and val.strip():
                    input_text = val
                    break

        if not input_text and ctx.workflow_data:
            for step_k, step_out in ctx.workflow_data.items():
                if isinstance(step_out, dict):
                    for k in ["text", "body", "message", "email", "content", "description"]:
                        val = step_out.get(k)
                        if val and isinstance(val, str) and val.strip():
                            input_text = val
                            break
                    if input_text:
                        break

        input_text = str(input_text).strip() if input_text else ""
        if not input_text:
            return StepExecutionResult(
                status="FAILED",
                error_message="AI classification failed: No input text found in step config, trigger payload, or upstream data",
            )

        # 2. Candidate categories
        raw_categories = config.get("categories") or [
            "enterprise",
            "mid_market",
            "smb",
            "sales",
            "support",
            "billing",
            "technical",
            "urgent",
            "general",
        ]
        clean_categories = [
            c.strip().lower()
            for c in raw_categories
            if isinstance(c, str) and c.strip().lower() in ALLOWED_LEAD_CATEGORIES
        ]
        if not clean_categories:
            clean_categories = ["general", "support", "sales"]

        try:
            input_data = LeadClassificationInput(
                text=input_text,
                categories=clean_categories,
                context=sanitize_payload(ctx.trigger_payload) if ctx.trigger_payload else None,
            )
        except Exception as e:
            return StepExecutionResult(
                status="FAILED",
                error_message=sanitize_error_message(f"Invalid AI classification input: {str(e)}"),
            )

        # 3. Provider configuration (respecting precedence: step -> env -> mock)
        step_provider = config.get("provider") or settings.AI_PROVIDER or "mock"
        step_model = config.get("model") or settings.AI_DEFAULT_MODEL or "gpt-4o-mini"
        provider_config = AIProviderConfig(
            provider=step_provider,
            model=step_model,
            temperature=float(config.get("temperature", 0.0)),
            max_tokens=int(config.get("max_tokens", 500)),
            timeout_seconds=float(config.get("timeout_seconds", settings.AI_REQUEST_TIMEOUT_SECONDS)),
        )

        # 4. Call AIClassificationService
        try:
            result: LeadClassificationResult = await self.ai_service.classify(
                input_data=input_data,
                config=provider_config,
            )
        except Exception as e:
            return StepExecutionResult(
                status="FAILED",
                error_message=sanitize_error_message(f"AI classification failed: {str(e)}"),
            )

        output_payload = result.model_dump()

        return StepExecutionResult(
            status="COMPLETED",
            output_data=output_payload,
        )


# Backward compatibility alias for tests and existing registry references
MockAIClassificationExecutor = AIClassificationExecutor


class HumanApprovalExecutor(BaseStepExecutor):
    """
    Handles HUMAN_APPROVAL.
    Suspends workflow execution by returning status='PAUSED' and requires_approval=True.
    The workflow engine will create the ApprovalRequest record and pause the run.
    """

    async def execute(self, ctx: StepExecutionContext) -> StepExecutionResult:
        config = ctx.config or {}
        approver_role = config.get("approver_role", "MANAGER")
        title = config.get("title", f"Approval required for step '{ctx.step_key}'")
        timeout_hours = config.get("timeout_hours", 24)

        return StepExecutionResult(
            status="PAUSED",
            requires_approval=True,
            output_data={
                "status": "waiting_for_approval",
                "approver_role": approver_role,
                "title": title,
                "timeout_hours": timeout_hours,
            },
            approval_context={
                "step_key": ctx.step_key,
                "step_id": str(ctx.step_id),
                "title": title,
                "approver_role": approver_role,
                "timeout_hours": timeout_hours,
            },
        )
