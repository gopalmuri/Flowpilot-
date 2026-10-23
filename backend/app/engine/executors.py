import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.engine.base import BaseStepExecutor, StepExecutionContext, StepExecutionResult
from app.engine.condition_evaluator import evaluate_condition_rule
from app.engine.sanitizer import sanitize_error_message, sanitize_payload
from app.models.audit_log import AuditLog
from app.models.base import utc_now
from app.models.conversation import InboundMessage, ReplyDraft
from app.schemas.ai import (
    ALLOWED_LEAD_CATEGORIES,
    AIProviderConfig,
    LeadClassificationInput,
    LeadClassificationResult,
    MessageAnalysisInput,
    MessageAnalysisResult,
)
from app.services.ai.message_analysis import MessageAnalysisService, provider_config_from_step
from app.services.ai.service import AIClassificationService
from app.services.crm.mock_crm_service import MockCRMService
from app.services.inbound.drafts import add_version, create_initial_version
from app.services.outbound.delivery import DeliveryRefused, create_delivery
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
        for s_data in ctx.workflow_data.values():
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
            for step_out in ctx.workflow_data.values():
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

        # If an upstream step produced a reply draft, the approval is bound to it (the reviewer sees and
        # authorises that exact text). Taken from the run's own step outputs, never from the trigger payload.
        draft_id = next(
            (
                out["draft_id"]
                for out in (ctx.workflow_data or {}).values()
                if isinstance(out, dict) and out.get("draft_id")
            ),
            None,
        )
        approval_context: Dict[str, Any] = {
            "step_key": ctx.step_key,
            "step_id": str(ctx.step_id),
            "title": title,
            "approver_role": approver_role,
            "timeout_hours": timeout_hours,
        }
        if draft_id:
            approval_context["draft_id"] = str(draft_id)

        return StepExecutionResult(
            status="PAUSED",
            requires_approval=True,
            output_data={
                "status": "waiting_for_approval",
                "approver_role": approver_role,
                "title": title,
                "timeout_hours": timeout_hours,
            },
            approval_context=approval_context,
        )


class AIAnalyzeMessageExecutor(BaseStepExecutor):
    """
    Handles AI_ANALYZE_MESSAGE.
    Analyses a stored inbound message with the configured AI provider, persists the validated
    analysis and (if one is produced) a review-only ReplyDraft.

    Hard boundaries:
    - Reads the message from the database scoped to the run's organization; the trigger payload is
      only used to find the id, so a forged id from another tenant resolves to "not found".
    - Never sends anything and never marks anything approved. The draft is status DRAFT.
    - Idempotent: if the message was already analysed (a retry), the stored analysis is reused and
      the provider is not called again.
    """

    def __init__(self, analysis_service: Optional[MessageAnalysisService] = None):
        self.analysis_service = analysis_service or MessageAnalysisService()

    @staticmethod
    def _output(result: MessageAnalysisResult, draft_id: Optional[uuid.UUID]) -> Dict[str, Any]:
        data = result.model_dump(mode="json")
        data["draft_id"] = str(draft_id) if draft_id else None
        return data

    async def execute(self, ctx: StepExecutionContext) -> StepExecutionResult:
        config = ctx.config or {}
        if ctx.session_factory is None:
            return StepExecutionResult(status="FAILED", error_message="AI message analysis requires database access")

        try:
            message_id = uuid.UUID(str((ctx.trigger_payload or {}).get("inbound_message_id")))
        except ValueError:
            return StepExecutionResult(
                status="FAILED", error_message="AI message analysis failed: no inbound message in trigger payload"
            )

        async with ctx.session_factory() as session:
            message = (
                await session.execute(
                    select(InboundMessage).where(
                        InboundMessage.id == message_id,
                        InboundMessage.organization_id == ctx.organization_id,
                    )
                )
            ).scalar_one_or_none()
            if message is None:
                return StepExecutionResult(status="FAILED", error_message="Inbound message not found")

            existing_draft = (
                await session.execute(select(ReplyDraft.id).where(ReplyDraft.source_message_id == message.id))
            ).scalar_one_or_none()
            if message.ai_analysis and not config.get("force_reanalyze"):
                try:
                    stored = MessageAnalysisResult.model_validate(message.ai_analysis)
                    return StepExecutionResult(status="COMPLETED", output_data=self._output(stored, existing_draft))
                except ValueError:
                    pass  # stored analysis no longer validates: analyse again

            analysis_input = MessageAnalysisInput(
                channel=message.channel,
                message_text=message.text_content,
                sender_name=message.sender_name,
                subject=message.subject,
                business_profile=(str(config.get("business_profile") or "")[:6000] or None),
            )

        try:
            provider_config, threshold = provider_config_from_step(config)
        except (TypeError, ValueError) as exc:
            return StepExecutionResult(
                status="FAILED", error_message=sanitize_error_message(f"Invalid AI analysis configuration: {exc}")
            )

        result = await self.analysis_service.analyze(analysis_input, provider_config, threshold)

        draft_id: Optional[uuid.UUID] = None
        async with ctx.session_factory() as session:
            row = (
                await session.execute(
                    select(InboundMessage).where(
                        InboundMessage.id == message_id,
                        InboundMessage.organization_id == ctx.organization_id,
                    )
                )
            ).scalar_one()
            row.ai_analysis = result.model_dump(mode="json")
            row.analyzed_at = utc_now()
            row.processing_status = "NEEDS_REVIEW" if result.needs_human_attention else "ANALYZED"

            if result.reply_draft:
                draft = (
                    await session.execute(select(ReplyDraft).where(ReplyDraft.source_message_id == row.id))
                ).scalar_one_or_none()
                if draft is None:
                    try:
                        async with session.begin_nested():
                            draft = ReplyDraft(
                                organization_id=ctx.organization_id,
                                conversation_id=row.conversation_id,
                                source_message_id=row.id,
                                draft_content=result.reply_draft,
                                status="DRAFT",
                                generated_by=f"{result.provider}:{result.model}",
                                risk_flags=result.risk_flags,
                            )
                            session.add(draft)
                            await session.flush()
                            await create_initial_version(session, draft, result.reply_draft)
                    except IntegrityError:  # concurrent retry created it first
                        draft = (
                            await session.execute(select(ReplyDraft).where(ReplyDraft.source_message_id == row.id))
                        ).scalar_one()
                elif draft.status == "DRAFT" and draft.draft_content != result.reply_draft:
                    # A regenerated draft is a new immutable version, never an overwrite.
                    await add_version(session, draft, result.reply_draft, "AI", None)
                    draft.generated_by = f"{result.provider}:{result.model}"
                    draft.risk_flags = result.risk_flags
                draft_id = draft.id

            session.add(
                AuditLog(
                    organization_id=ctx.organization_id,
                    user_id=None,
                    action="ai.message_analyzed",
                    resource_type="inbound_message",
                    resource_id=str(row.id),
                    details={
                        "workflow_run_id": str(ctx.workflow_run_id),
                        "category": result.category.value,
                        "recommended_action": result.recommended_action.value,
                        "confidence": result.confidence,
                        "provider": result.provider,
                        "model": result.model,
                        "tokens_used": result.tokens_used,
                        "is_fallback": result.is_fallback,
                        "fallback_reason": result.fallback_reason,
                        "injection_suspected": result.injection_suspected,
                        "risk_flags": result.risk_flags,
                        "draft_id": str(draft_id) if draft_id else None,
                    },
                )
            )
            await session.commit()

        return StepExecutionResult(status="COMPLETED", output_data=self._output(result, draft_id))


class SendReplyExecutor(BaseStepExecutor):
    """
    Handles SEND_REPLY: records the intent to send the draft's approved reply. It does not send.

    It creates (or finds) the single OutboundDelivery for the approved version through the authorisation gate and
    returns immediately; the outbox dispatcher and a Celery worker perform the delivery asynchronously. The step
    therefore completes with "queued", never with "delivered". It refuses (step FAILED) if the draft is not
    currently approved for sending, so wiring it to the rejected branch cannot send anything.
    """

    async def execute(self, ctx: StepExecutionContext) -> StepExecutionResult:
        if ctx.session_factory is None:
            return StepExecutionResult(status="FAILED", error_message="SEND_REPLY requires database access")

        draft_id = next(
            (
                out["draft_id"]
                for out in (ctx.workflow_data or {}).values()
                if isinstance(out, dict) and out.get("draft_id")
            ),
            None,
        )
        if not draft_id:
            return StepExecutionResult(status="FAILED", error_message="SEND_REPLY found no reply draft in this run")
        try:
            draft_uuid = uuid.UUID(str(draft_id))
        except ValueError:
            return StepExecutionResult(status="FAILED", error_message="SEND_REPLY received an invalid draft id")

        refused: Optional[DeliveryRefused] = None
        async with ctx.session_factory() as session:
            try:
                delivery, created = await create_delivery(session, ctx.organization_id, draft_uuid, ctx.workflow_run_id)
            except DeliveryRefused as err:
                refused = err
            await session.commit()  # also persists the refusal audit entry
            if refused is None:
                output = {
                    "delivery_id": str(delivery.id),
                    "delivery_status": delivery.status,
                    "created": created,
                    "note": "Queued. Provider acceptance is recorded asynchronously; this is not delivery confirmation.",
                }
        if refused is not None:
            return StepExecutionResult(
                status="FAILED",
                error_message=sanitize_error_message(f"Delivery refused ({refused.code}): {refused.message}"),
            )
        _kick_dispatcher()
        return StepExecutionResult(status="COMPLETED", output_data=output)


class AIExtractDataExecutor(BaseStepExecutor):
    """
    Handles AI_EXTRACT_DATA: pulls named fields out of free text into structured output.

    Fields already present as keys in the trigger payload are copied as-is (no model call, no guessing). Only the
    remaining fields are requested from the model. If the model is unavailable the step still completes, with null
    for anything it could not find, so a provider outage never invents values or blocks the run.
    """

    _SOURCE_KEYS = ["message", "text", "body", "email_body", "description", "content", "subject"]

    async def execute(self, ctx: StepExecutionContext) -> StepExecutionResult:
        config = ctx.config or {}
        fields = [f.strip() for f in (config.get("fields") or []) if isinstance(f, str) and f.strip()]
        if not fields:
            return StepExecutionResult(status="FAILED", error_message="AI extract data requires a 'fields' list")

        payload = ctx.trigger_payload or {}
        nested = payload.get("payload") if isinstance(payload.get("payload"), dict) else {}
        extracted: Dict[str, Any] = {}
        for name in fields:
            for source in (payload, nested):
                if source.get(name) not in (None, ""):
                    extracted[name] = source[name]
                    break

        remaining = [f for f in fields if f not in extracted]
        method = "payload"
        if remaining:
            text = self._find_text(ctx, config.get("source_field"))
            if not text:
                return StepExecutionResult(
                    status="FAILED",
                    error_message="AI extract data found no text to read in the trigger payload or upstream steps",
                )
            found, method = await self._extract_with_ai(text, remaining, config)
            for name in remaining:
                extracted[name] = found.get(name)

        output = {"extracted": extracted, "method": method, **extracted}
        return StepExecutionResult(status="COMPLETED", output_data=output)

    def _find_text(self, ctx: StepExecutionContext, source_field: Optional[str]) -> str:
        sources: List[Dict[str, Any]] = [ctx.trigger_payload or {}]
        sources.extend(o for o in (ctx.workflow_data or {}).values() if isinstance(o, dict))
        for src in sources:
            candidates = ([source_field] if source_field else []) + self._SOURCE_KEYS
            for key in candidates:
                val = src.get(key)
                if isinstance(val, str) and val.strip():
                    return val.strip()[:6000]
                nested = src.get("payload")
                if isinstance(nested, dict) and isinstance(nested.get(key), str) and nested[key].strip():
                    return nested[key].strip()[:6000]
        return ""

    async def _extract_with_ai(self, text: str, fields: List[str], config: Dict[str, Any]):
        from app.services.ai.factory import AIProviderFactory
        from app.services.ai.service import extract_json_payload

        provider_name = config.get("provider") or settings.AI_PROVIDER or "mock"
        if provider_name == "mock":
            return {}, "unavailable"
        try:
            provider = AIProviderFactory.get_provider(provider_name=provider_name)
            response = await provider.generate_json(
                system_prompt=(
                    "You extract structured details from text. Return a JSON object whose keys are exactly the "
                    "requested field names. Use null for any field the text does not state. Never guess or invent."
                ),
                user_prompt=(
                    f"Fields: {fields}\n"
                    f"Extra instructions: {config.get('instructions') or 'none'}\n"
                    f"Text:\n{text}"
                ),
                config=AIProviderConfig(
                    provider=provider_name,
                    temperature=0.0,
                    max_tokens=600,
                    timeout_seconds=float(config.get("timeout_seconds", settings.AI_REQUEST_TIMEOUT_SECONDS)),
                ),
            )
            data = extract_json_payload(response.raw_output)
            return {f: data.get(f) for f in fields}, "ai"
        except Exception:  # noqa: BLE001 - never block a run or leak provider detail; nulls are explicit
            return {}, "unavailable"


def _kick_dispatcher() -> None:
    """Best-effort nudge so the outbox relay runs now instead of at its next tick. Failure is harmless."""
    try:
        from app.workers.tasks import dispatch_outbound_deliveries

        dispatch_outbound_deliveries.delay()
    except Exception:  # noqa: BLE001 - the periodic relay will pick the delivery up anyway
        pass
