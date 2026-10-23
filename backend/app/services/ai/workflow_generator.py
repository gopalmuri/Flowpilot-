import json
import logging
import time
from collections import defaultdict, deque
from typing import Any, Dict, List, Optional, Set, Tuple

from app.core.config import settings
from app.schemas.ai import AIProviderConfig
from app.schemas.workflow import (
    StepType,
    WorkflowConnectionSchema,
    WorkflowStepSchema,
    WorkflowValidationResult,
)
from app.schemas.workflow_ai import (
    AIChatMessage,
    AIClarificationQuestion,
    AISimulateExecutionRequest,
    AISimulateExecutionResponse,
    AISimulateExecutionStep,
    AISimulatePayloadRequest,
    AISimulatePayloadResponse,
    AITemplateSuggestion,
    AIWorkflowAssistRequest,
    AIWorkflowAssistResponse,
    AIWorkflowDiffSummary,
    AIWorkflowProposal,
)
from app.services.ai.factory import AIProviderFactory
from app.services.ai.service import extract_json_payload
from app.services.ai.templates import DEFAULT_TEMPLATE_SUGGESTIONS, match_templates
from app.services.workflow_catalog import catalog_prompt_section, flow_semantic_errors
from app.services.workflow_validator import APPROVED_STEP_TYPES, validate_workflow_dag

logger = logging.getLogger("flowpilot.ai.workflow_generator")

_PROMPT_HEAD = """You are FlowPilot's AI Workflow Architect.
FlowPilot lets small and mid-size business teams automate repetitive work with a human approving the important decisions.
The people you help are NOT technical. Write messages in plain, friendly language; never mention "DAG", "step_key" or "step_type" in "message" or "summary".

Your role is to understand a request in natural language and respond in exactly one mode:
1. "clarification": ONLY when a value the workflow cannot work without is genuinely missing and cannot be reasonably defaulted
   (for example: which Slack channel, who must approve, the amount limit). Ask at most 3 short questions, each with 2-4 quick-choice options.
   ALWAYS ask when you cannot tell WHAT STARTS the automation (which event or data) or what the desired OUTCOME is; a one-line request such as
   "automate my follow ups" is too vague to build. If only a minor detail is missing and a sensible default exists, USE IT and mention it in "summary".
2. "proposal": a complete, valid workflow.
3. "explanation": when the user asks to explain, analyze or audit the existing workflow.
4. "suggestion": when the user asks for ideas, templates or best practices.

STEP TYPES YOU MAY USE (these are the only ones that exist):
"""

_PROMPT_TAIL = """
STRICT RULES:
- Use ONLY the step types listed above. If the user asks for something that is not possible with them, build the closest valid flow and
  say plainly in "message" what is not supported (for example: WhatsApp, waiting/delaying, schedules, loops, other apps).
  Never invent a step type or pretend an unsupported capability works.
- A workflow has EXACTLY ONE trigger step. A trigger can never be the target of a connection.
- The graph must be acyclic and every step must be reachable from the trigger.
- Any step that branches (if / else decision, approval) must have an outgoing connection for EACH of its labels.
- Connections out of a branching step must carry the matching condition_label; all other connections use null.
- Give every step a short human-friendly "name" (what it does, e.g. "Manager approves the offer") and a unique snake_case "step_key".
- Fill config values from what the user said. Use realistic defaults when they did not.
- Sending a reply to a customer must go: AI reads & drafts a reply -> Ask a person to approve -> Send the approved reply. Never send without approval.
- When REFINING an existing workflow, PRESERVE all existing steps and connections unless the user asks to remove or replace them.
- If "validation_errors" are provided, return a corrected full proposal that fixes every one of them.

Respond with ONE valid JSON object in this exact shape:
{
  "mode": "proposal" | "clarification" | "explanation" | "suggestion",
  "message": "Friendly message to show the user",
  "summary": "One short paragraph in plain English: when it starts, what happens, where a person decides (proposal mode only)",
  "suggested_name": "Short workflow name (proposal mode only)",
  "clarification_questions": [{"id": "q1", "question": "...", "options": ["A", "B"]}],
  "template_suggestions": [{"id": "t1", "title": "...", "description": "...", "prompt": "..."}],
  "proposal": {
    "steps": [{"step_key": "snake_case_key", "step_type": "ONE_OF_THE_TYPES_ABOVE", "name": "Friendly name", "config": {}}],
    "connections": [{"source_step_key": "a", "target_step_key": "b", "condition_label": null}],
    "warnings": []
  }
}
"""


def build_system_prompt() -> str:
    return _PROMPT_HEAD + catalog_prompt_section() + _PROMPT_TAIL


SYSTEM_PROMPT = build_system_prompt()

MAX_REPAIR_ATTEMPTS = 2
MAX_CLARIFICATION_QUESTIONS = 3

# Kept under this name for existing imports; the full set lives in services/ai/templates.py
DEFAULT_TEMPLATES = DEFAULT_TEMPLATE_SUGGESTIONS


def compute_auto_layout(
    steps: List[WorkflowStepSchema],
    connections: List[WorkflowConnectionSchema],
) -> List[WorkflowStepSchema]:
    """
    Computes a clean, collision-free top-to-bottom layout for canvas rendering.
    Uses topological layering / rank calculation.
    """
    if not steps:
        return steps

    step_dict = {s.step_key: s for s in steps}
    adj: Dict[str, List[str]] = defaultdict(list)
    in_degree: Dict[str, int] = {s.step_key: 0 for s in steps}

    for c in connections:
        if c.source_step_key in in_degree and c.target_step_key in in_degree:
            adj[c.source_step_key].append(c.target_step_key)
            in_degree[c.target_step_key] += 1

    # Find root nodes (triggers or 0 in-degree)
    roots = [k for k, deg in in_degree.items() if deg == 0]
    if not roots and steps:
        roots = [steps[0].step_key]

    # Assign levels via BFS
    level: Dict[str, int] = {k: 0 for k in in_degree}
    q = deque(roots)
    while q:
        curr = q.popleft()
        for nxt in adj[curr]:
            if level[nxt] < level[curr] + 1:
                level[nxt] = level[curr] + 1
                q.append(nxt)

    # Group steps by level
    levels: Dict[int, List[str]] = defaultdict(list)
    for k, lvl in level.items():
        levels[lvl].append(k)

    # Calculate coordinates: level determines Y (top to bottom), index determines X
    positioned_steps: List[WorkflowStepSchema] = []
    y_gap = 140
    x_gap = 260
    base_x = 350
    base_y = 80

    for lvl, keys in levels.items():
        count = len(keys)
        total_width = (count - 1) * x_gap
        start_x = base_x - (total_width // 2)

        for idx, k in enumerate(keys):
            s = step_dict[k]
            x_pos = max(100, start_x + (idx * x_gap))
            y_pos = base_y + (lvl * y_gap)

            # Preserve existing position if it was already custom positioned
            existing_pos = s.ui_position or {}
            if existing_pos.get("x", 0) > 0 or existing_pos.get("y", 0) > 0:
                # Keep user-specified position if present
                pos = existing_pos
            else:
                pos = {"x": x_pos, "y": y_pos}

            positioned_steps.append(
                WorkflowStepSchema(
                    step_key=s.step_key,
                    step_type=s.step_type,
                    name=s.name,
                    config=s.config,
                    ui_position=pos,
                )
            )

    return positioned_steps


def calculate_diff_summary(
    current_steps: List[WorkflowStepSchema],
    current_connections: List[WorkflowConnectionSchema],
    proposed_steps: List[WorkflowStepSchema],
    proposed_connections: List[WorkflowConnectionSchema],
) -> AIWorkflowDiffSummary:
    """
    Computes a human-readable diff between current and proposed workflow states.
    """
    curr_keys = {s.step_key: s for s in current_steps}
    prop_keys = {s.step_key: s for s in proposed_steps}

    added = [f"{s.name} ({s.step_key}) [{s.step_type}]" for k, s in prop_keys.items() if k not in curr_keys]
    removed = [f"{s.name} ({s.step_key}) [{s.step_type}]" for k, s in curr_keys.items() if k not in prop_keys]
    modified = []

    for k, p_step in prop_keys.items():
        if k in curr_keys:
            c_step = curr_keys[k]
            if c_step.name != p_step.name or c_step.config != p_step.config or c_step.step_type != p_step.step_type:
                modified.append(f"{p_step.name} ({k})")

    curr_edges = {f"{c.source_step_key}->{c.target_step_key}:{c.condition_label or ''}" for c in current_connections}
    prop_edges = {f"{c.source_step_key}->{c.target_step_key}:{c.condition_label or ''}" for c in proposed_connections}

    new_edges = prop_edges - curr_edges
    reconnected = []
    for edge_str in sorted(new_edges):
        parts = edge_str.split("->")
        src = parts[0]
        tgt_parts = parts[1].split(":")
        tgt = tgt_parts[0]
        cond = f" [{tgt_parts[1]}]" if len(tgt_parts) > 1 and tgt_parts[1] else ""
        reconnected.append(f"{src} → {tgt}{cond}")

    return AIWorkflowDiffSummary(
        added_steps=added,
        removed_steps=removed,
        modified_steps=modified,
        reconnected_edges=reconnected,
    )


class AIWorkflowGeneratorService:
    """
    Service responsible for natural language workflow generation,
    clarification dialogues, iterative graph refinement, and explanation.
    Powered by Grok / Groq OpenAI-compatible provider with authoritative validation.
    """

    def __init__(self, provider_factory: Optional[type[AIProviderFactory]] = None):
        self.factory = provider_factory or AIProviderFactory

    async def assist(
        self,
        request: AIWorkflowAssistRequest,
        provider_name: Optional[str] = None,
    ) -> AIWorkflowAssistResponse:
        start_time = time.monotonic()
        target_provider = provider_name or settings.AI_PROVIDER or "grok"

        def _elapsed() -> int:
            return max(1, int((time.monotonic() - start_time) * 1000))

        try:
            provider = self.factory.get_provider(provider_name=target_provider)
        except Exception as exc:  # noqa: BLE001 - misconfiguration must degrade gracefully, never 500
            logger.warning("AI provider unavailable: %s", exc)
            return self._offline_response(request, _elapsed(), target_provider)

        prompt_lower = request.prompt.lower().strip()
        if any(w in prompt_lower for w in ["templates", "template ideas", "examples", "what can you do"]) and not request.current_steps:
            return AIWorkflowAssistResponse(
                mode="suggestion",
                message="Here are popular automations to start from. Pick one and I'll build it for you, or describe your own.",
                template_suggestions=DEFAULT_TEMPLATE_SUGGESTIONS,
                tokens_used=0,
                latency_ms=_elapsed(),
                provider=getattr(provider, "PROVIDER_NAME", "grok"),
                model=getattr(provider, "_model", "default"),
            )

        context = {
            "user_prompt": request.prompt,
            "workflow_name": request.workflow_name,
            "workflow_description": request.workflow_description,
            "current_steps": [s.model_dump() for s in request.current_steps],
            "current_connections": [c.model_dump() for c in request.current_connections],
            "recent_conversation": [
                {"role": m.role.value, "content": m.content} for m in request.conversation_history[-8:]
            ],
        }
        cfg = AIProviderConfig(
            provider=target_provider,
            temperature=0.2,
            max_tokens=4000,
            timeout_seconds=settings.AI_BUILDER_TIMEOUT_SECONDS,
        )

        total_tokens = 0
        try:
            response = await provider.generate_json(
                system_prompt=SYSTEM_PROMPT, user_prompt=json.dumps(context, indent=2), config=cfg
            )
            total_tokens += response.total_tokens
            parsed = extract_json_payload(response.raw_output)
        except Exception as exc:  # noqa: BLE001
            logger.warning("AI provider failed during workflow generation: %s", exc)
            return self._offline_response(request, _elapsed(), target_provider)

        result = self._interpret(parsed, request)

        # Self-repair: feed validator errors back to the model before the person ever sees a broken flow.
        attempts = 0
        while result["proposal"] is not None and not result["proposal"].valid and attempts < MAX_REPAIR_ATTEMPTS:
            attempts += 1
            repair_context = dict(context)
            repair_context["previous_proposal"] = {
                "steps": [s.model_dump(exclude={"ui_position"}) for s in result["proposal"].steps],
                "connections": [c.model_dump() for c in result["proposal"].connections],
            }
            repair_context["validation_errors"] = result["proposal"].errors
            try:
                repaired = await provider.generate_json(
                    system_prompt=SYSTEM_PROMPT, user_prompt=json.dumps(repair_context, indent=2), config=cfg
                )
                total_tokens += repaired.total_tokens
                repaired_result = self._interpret(extract_json_payload(repaired.raw_output), request)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Repair attempt %d failed: %s", attempts, exc)
                break
            if repaired_result["proposal"] is None:
                break
            result = repaired_result

        proposal = result["proposal"]
        message = result["message"]
        if proposal is not None and not proposal.valid:
            message = (
                f"{message}\n\nI couldn't fully fix this draft automatically. "
                "The problems are listed below; you can ask me to adjust it or fix them in the editor."
            )

        return AIWorkflowAssistResponse(
            mode=result["mode"],
            message=message,
            proposal=proposal,
            clarification_questions=result["questions"],
            template_suggestions=result["templates"],
            summary=result["summary"],
            suggested_name=result["name"],
            repair_attempts=attempts,
            tokens_used=total_tokens,
            latency_ms=_elapsed(),
            provider=response.provider,
            model=response.model,
        )

    def _offline_response(self, request: AIWorkflowAssistRequest, latency_ms: int, provider: str) -> AIWorkflowAssistResponse:
        """When the model cannot be reached: say so honestly and offer the closest ready-made starting points."""
        return AIWorkflowAssistResponse(
            mode="suggestion",
            message=(
                "The AI assistant couldn't be reached just now, so I can't build a custom flow right this second. "
                "Here are ready-made starting points that match your request. You can also build by hand in the editor."
            ),
            template_suggestions=match_templates(request.prompt),
            tokens_used=0,
            latency_ms=latency_ms,
            provider=provider,
            model="unavailable",
        )

    def _interpret(self, parsed: Dict[str, Any], request: AIWorkflowAssistRequest) -> Dict[str, Any]:
        """Turns raw model JSON into validated response parts. Unknown step types become validation errors, not silent drops."""
        mode = parsed.get("mode", "proposal")
        if mode not in ("proposal", "clarification", "explanation", "suggestion"):
            mode = "proposal"

        questions = [
            AIClarificationQuestion(
                id=str(q.get("id", f"q{i}")),
                question=q.get("question", ""),
                options=[str(o) for o in (q.get("options") or [])][:5],
            )
            for i, q in enumerate(parsed.get("clarification_questions") or [])
            if isinstance(q, dict) and q.get("question")
        ][:MAX_CLARIFICATION_QUESTIONS]

        templates = [
            AITemplateSuggestion(
                id=str(t.get("id", f"t{i}")),
                title=t.get("title", ""),
                description=t.get("description", ""),
                prompt=t.get("prompt", ""),
            )
            for i, t in enumerate(parsed.get("template_suggestions") or [])
            if isinstance(t, dict) and t.get("title") and t.get("prompt")
        ]

        if mode == "clarification" and not questions:
            mode = "explanation"  # nothing to ask; show the message instead of an empty question card

        proposal: Optional[AIWorkflowProposal] = None
        proposal_raw = parsed.get("proposal")
        if mode == "proposal" and isinstance(proposal_raw, dict):
            proposal = self._build_proposal(proposal_raw, request)

        summary = parsed.get("summary")
        name = parsed.get("suggested_name")
        return {
            "mode": mode,
            "message": parsed.get("message") or "Here is the proposed workflow.",
            "questions": questions,
            "templates": templates,
            "proposal": proposal,
            "summary": summary.strip() if isinstance(summary, str) and summary.strip() else None,
            "name": name.strip()[:120] if isinstance(name, str) and name.strip() else None,
        }

    def _build_proposal(self, proposal_raw: Dict[str, Any], request: AIWorkflowAssistRequest) -> AIWorkflowProposal:
        steps: List[WorkflowStepSchema] = []
        extra_errors: List[str] = []
        for s in proposal_raw.get("steps") or []:
            if not isinstance(s, dict):
                continue
            stype = s.get("step_type", "")
            if stype not in APPROVED_STEP_TYPES:
                extra_errors.append(
                    f"Step '{s.get('step_key', '?')}' uses the unknown type '{stype}'. "
                    f"Use only: {sorted(APPROVED_STEP_TYPES)}"
                )
                continue
            try:
                steps.append(
                    WorkflowStepSchema(
                        step_key=str(s.get("step_key", "step")),
                        step_type=stype,
                        name=str(s.get("name", s.get("step_key", "Step"))),
                        config=s.get("config") if isinstance(s.get("config"), dict) else {},
                        ui_position=s.get("ui_position") or {"x": 0, "y": 0},
                    )
                )
            except Exception as exc:  # noqa: BLE001
                extra_errors.append(f"Step '{s.get('step_key', '?')}' is malformed: {exc}")

        connections: List[WorkflowConnectionSchema] = []
        for c in proposal_raw.get("connections") or []:
            if not isinstance(c, dict):
                continue
            src, tgt = c.get("source_step_key"), c.get("target_step_key")
            if not (src and tgt):
                continue
            try:
                connections.append(
                    WorkflowConnectionSchema(
                        source_step_key=src, target_step_key=tgt, condition_label=c.get("condition_label") or None
                    )
                )
            except Exception as exc:  # noqa: BLE001
                extra_errors.append(f"A connection from '{src}' to '{tgt}' is malformed: {exc}")

        positioned = compute_auto_layout(steps, connections)
        validation: WorkflowValidationResult = validate_workflow_dag(positioned, connections)
        errors = extra_errors + list(validation.errors) + flow_semantic_errors(positioned, connections)
        return AIWorkflowProposal(
            steps=positioned,
            connections=connections,
            diff_summary=calculate_diff_summary(request.current_steps, request.current_connections, positioned, connections),
            valid=not errors,
            errors=errors,
            warnings=list(validation.warnings) + [w for w in (proposal_raw.get("warnings") or []) if isinstance(w, str)],
        )

    async def generate_test_payload(
        self,
        request: AISimulatePayloadRequest,
        provider_name: Optional[str] = None,
    ) -> AISimulatePayloadResponse:
        start_time = time.monotonic()
        target_provider = provider_name or settings.AI_PROVIDER or "grok"
        provider = self.factory.get_provider(provider_name=target_provider)

        trigger_step = next(
            (s for s in request.steps if s.step_type in ("WEBHOOK_TRIGGER", "MANUAL_TRIGGER")),
            request.steps[0] if request.steps else None,
        )
        target_trigger = trigger_step.step_key if trigger_step else "trigger_1"

        steps_summary = [
            {"step_key": s.step_key, "step_type": s.step_type, "name": s.name, "config": s.config}
            for s in request.steps
        ]
        connections_summary = [
            {"source": c.source_step_key, "target": c.target_step_key, "label": c.condition_label}
            for c in request.connections
        ]

        prompt = f"""Generate a realistic JSON input payload to test this workflow DAG.
Scenario: {request.scenario}
Custom instruction: {request.custom_instruction or 'None'}

Workflow Steps:
{json.dumps(steps_summary, indent=2)}

Connections:
{json.dumps(connections_summary, indent=2)}

Target Trigger Step: {target_trigger}

Respond ONLY with valid JSON in this exact structure:
{{
  "scenario": "{request.scenario}",
  "summary": "Brief explanation of how this payload tests the workflow and downstream condition branches",
  "payload": {{ ... fields matching trigger and downstream steps ... }},
  "target_trigger": "{target_trigger}"
}}
"""
        try:
            response = await provider.generate_json(
                system_prompt="You are FlowPilot's AI Test Engineer. You generate realistic mock payloads matching workflow triggers and condition rules. Respond with a single JSON object.",
                user_prompt=prompt,
                config=AIProviderConfig(
                    provider=target_provider,
                    temperature=0.3,
                    max_tokens=1200,
                    timeout_seconds=settings.AI_BUILDER_TIMEOUT_SECONDS,
                ),
            )
            data = extract_json_payload(response.raw_output)
            return AISimulatePayloadResponse(
                scenario=data.get("scenario", request.scenario or "happy_path"),
                summary=data.get("summary", f"Generated realistic {request.scenario} test payload"),
                payload=data.get("payload", {}),
                target_trigger=data.get("target_trigger", target_trigger),
            )
        except Exception as exc:
            logger.warning("Failed to generate test payload with AI provider, using fallback: %s", exc)
            default_payload = {
                "source": "flowpilot_simulator",
                "timestamp": "2026-10-21T12:00:00Z",
                "lead_score": 85 if request.scenario == "happy_path" else (20 if request.scenario == "failure" else 50),
                "email": "test.user@company.com",
                "tier": "enterprise" if request.scenario == "happy_path" else "free",
            }
            return AISimulatePayloadResponse(
                scenario=request.scenario or "happy_path",
                summary=f"Fallback simulated {request.scenario} payload for workflow testing.",
                payload=default_payload,
                target_trigger=target_trigger,
            )

    async def simulate_workflow_execution(
        self,
        request: AISimulateExecutionRequest,
    ) -> AISimulateExecutionResponse:
        start_time = time.monotonic()
        if not request.steps:
            return AISimulateExecutionResponse(
                overall_outcome="COMPLETED",
                simulation_summary="Empty workflow graph has no steps to execute.",
                active_step_ids=[],
                steps=[],
                latency_ms=1,
            )

        step_map: Dict[str, WorkflowStepSchema] = {s.step_key: s for s in request.steps}
        adj: Dict[str, List[Tuple[str, Optional[str]]]] = defaultdict(list)
        for conn in request.connections:
            adj[conn.source_step_key].append((conn.target_step_key, conn.condition_label))

        trigger_step = next(
            (s for s in request.steps if s.step_type in ("WEBHOOK_TRIGGER", "MANUAL_TRIGGER")),
            request.steps[0],
        )

        active_step_ids: List[str] = []
        simulated_steps: List[AISimulateExecutionStep] = []
        skipped_step_ids: Set[str] = set()
        visited: Set[str] = set()
        queue = deque([trigger_step.step_key])

        current_data = dict(request.payload)
        has_waiting_approval = False
        has_failure = False

        while queue:
            curr_key = queue.popleft()
            if curr_key in visited or curr_key not in step_map:
                continue
            visited.add(curr_key)
            step = step_map[curr_key]
            active_step_ids.append(curr_key)

            st_type = step.step_type
            status = "SUCCESS"
            branch_taken = None
            sim_output: Dict[str, Any] = {}
            reasoning = ""

            if st_type in ("WEBHOOK_TRIGGER", "MANUAL_TRIGGER"):
                status = "SUCCESS"
                sim_output = {"received_payload": current_data}
                reasoning = f"Trigger '{step.name}' accepted the input payload."
                for target_key, _ in adj.get(curr_key, []):
                    queue.append(target_key)

            elif st_type == "VALIDATE_DATA":
                req_fields = step.config.get("required_fields", [])
                missing = [f for f in req_fields if f not in current_data]
                if missing:
                    status = "FAILED"
                    has_failure = True
                    reasoning = f"Validation failed: payload is missing required field(s): {', '.join(missing)}."
                    sim_output = {"valid": False, "missing_fields": missing}
                else:
                    status = "SUCCESS"
                    reasoning = "Payload successfully validated against required field constraints."
                    sim_output = {"valid": True, "fields_checked": len(req_fields)}
                    for target_key, _ in adj.get(curr_key, []):
                        queue.append(target_key)

            elif st_type == "CONDITION":
                field = step.config.get("field")
                op = str(step.config.get("operator", "==")).lower()
                val = step.config.get("value")
                cond_result = True
                if field and field in current_data:
                    actual = current_data[field]
                    try:
                        if op in (">", "gt"):
                            cond_result = float(actual) > float(val)
                        elif op in (">=", "gte"):
                            cond_result = float(actual) >= float(val)
                        elif op in ("<", "lt"):
                            cond_result = float(actual) < float(val)
                        elif op in ("<=", "lte"):
                            cond_result = float(actual) <= float(val)
                        elif op in ("!=", "neq"):
                            cond_result = str(actual) != str(val)
                        else:
                            cond_result = str(actual).lower() == str(val).lower()
                    except Exception:
                        cond_result = bool(actual)

                branch_taken = "true" if cond_result else "false"
                status = "SUCCESS"
                reasoning = f"Condition evaluated to '{branch_taken.upper()}' (checked {field}={current_data.get(field)} against {op} {val})."
                sim_output = {"evaluated_branch": branch_taken, "result": cond_result}

                for target_key, label in adj.get(curr_key, []):
                    if label in (branch_taken, None, "default"):
                        queue.append(target_key)
                    else:
                        skipped_step_ids.add(target_key)

            elif st_type == "HUMAN_APPROVAL":
                role = step.config.get("approver_role", "MANAGER")
                status = "WAITING_APPROVAL"
                has_waiting_approval = True
                branch_taken = "approved"
                reasoning = f"Execution paused at gate '{step.name}'. Simulated with prospective {role} approval to project downstream flow."
                sim_output = {"gate": "HUMAN_APPROVAL", "required_role": role, "simulated_decision": "approved"}
                for target_key, label in adj.get(curr_key, []):
                    if label in ("approved", None, "default"):
                        queue.append(target_key)
                    else:
                        skipped_step_ids.add(target_key)

            elif st_type in ("AI_CLASSIFICATION", "AI_ANALYZE_MESSAGE"):
                category = current_data.get("tier", "enterprise")
                status = "SUCCESS"
                reasoning = f"AI classified intent as '{category}' with 0.94 confidence."
                sim_output = {"category": category, "confidence": 0.94, "priority": "high"}
                for target_key, _ in adj.get(curr_key, []):
                    queue.append(target_key)

            else:
                status = "SUCCESS"
                reasoning = f"Step '{step.name}' ({st_type}) simulated successfully with no side effects."
                sim_output = {"executed": True, "step_type": st_type}
                for target_key, _ in adj.get(curr_key, []):
                    queue.append(target_key)

            simulated_steps.append(
                AISimulateExecutionStep(
                    step_id=curr_key,
                    step_name=step.name,
                    step_type=step.step_type,
                    status=status,
                    branch_taken=branch_taken,
                    simulated_output=sim_output,
                    reasoning=reasoning,
                )
            )

        for skip_key in skipped_step_ids:
            if skip_key not in visited and skip_key in step_map:
                sk_step = step_map[skip_key]
                simulated_steps.append(
                    AISimulateExecutionStep(
                        step_id=skip_key,
                        step_name=sk_step.name,
                        step_type=sk_step.step_type,
                        status="SKIPPED",
                        branch_taken=None,
                        simulated_output={},
                        reasoning="Step skipped because its incoming branch was not selected by upstream condition.",
                    )
                )

        if has_failure:
            overall_outcome = "HALTED_ON_ERROR"
            summary = f"Simulated run halted on error during step execution. {len(active_step_ids)} step(s) traversed."
        elif has_waiting_approval:
            overall_outcome = "PENDING_APPROVAL"
            summary = f"Simulated run reached human approval gate and paused for review. {len(active_step_ids)} step(s) traversed."
        elif len(active_step_ids) == len(request.steps):
            overall_outcome = "COMPLETED"
            summary = f"Simulated run completed successfully across all {len(active_step_ids)} step(s)."
        else:
            overall_outcome = "COMPLETED"
            summary = f"Simulated run completed cleanly along the active branch ({len(active_step_ids)} traversed, {len(skipped_step_ids)} skipped)."

        latency_ms = max(1, int((time.monotonic() - start_time) * 1000))
        return AISimulateExecutionResponse(
            overall_outcome=overall_outcome,
            simulation_summary=summary,
            active_step_ids=active_step_ids,
            steps=simulated_steps,
            latency_ms=latency_ms,
        )

