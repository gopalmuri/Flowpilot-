"""
Step catalog: the single description of every step type the product supports.

The AI builder prompt, the "setup needed" checker and the /catalog API are all generated from this list, so
adding a step here (plus its executor) makes it available to the AI builder without editing any prompt.
"""

import re
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Set

from app.schemas.workflow import StepType


@dataclass(frozen=True)
class StepSpec:
    step_type: str
    label: str  # plain-language name shown to users
    category: str  # trigger | ai | logic | human | action
    description: str  # plain-language description, also given to the AI
    config_hint: str  # concise config contract given to the AI
    example_config: Dict[str, Any] = field(default_factory=dict)
    edge_labels: List[str] = field(default_factory=list)  # required condition_label values on outgoing edges
    is_trigger: bool = False
    is_mock: bool = False  # side effects are simulated, not real
    needs_integration: Optional[str] = None  # integration that must be connected for real use
    needs_upstream: Optional[str] = None  # step type that must appear earlier in the flow


STEP_CATALOG: List[StepSpec] = [
    StepSpec(
        step_type=StepType.WEBHOOK_TRIGGER.value,
        label="Message or webhook received",
        category="trigger",
        description="Starts the workflow when an external system, a form, or an inbound message (such as a new email) delivers data. This is the only trigger that works with messages from connected channels.",
        config_hint='{"allowed_methods": ["POST"]}',
        example_config={"allowed_methods": ["POST"]},
        is_trigger=True,
    ),
    StepSpec(
        step_type=StepType.MANUAL_TRIGGER.value,
        label="Start manually",
        category="trigger",
        description="Starts the workflow when a person clicks Run, optionally filling in a form.",
        config_hint="{}",
        is_trigger=True,
    ),
    StepSpec(
        step_type=StepType.VALIDATE_DATA.value,
        label="Check required details",
        category="logic",
        description="Stops the run with a clear error when required details are missing from the incoming data.",
        config_hint='at least one of: "required_fields" (list of field names), "schema" (object), "rules" (list)',
        example_config={"required_fields": ["email"]},
    ),
    StepSpec(
        step_type=StepType.AI_CLASSIFICATION.value,
        label="AI sorts it into a category",
        category="ai",
        description="AI reads the incoming text and labels it with one category (for example lead size or ticket type).",
        config_hint='at least one of: "prompt" (string), "categories" (list; ONLY these values are accepted: enterprise, mid_market, smb, sales, support, billing, technical, urgent, inquiry, standard, low, spam, general); optional "confidence_threshold" (0-1). The category chosen is available to later steps as the field "category"',
        example_config={"categories": ["enterprise", "mid_market", "smb"], "confidence_threshold": 0.7},
    ),
    StepSpec(
        step_type=StepType.AI_ANALYZE_MESSAGE.value,
        label="AI reads a message and drafts a reply",
        category="ai",
        description=(
            "AI reads an inbound message (intent, urgency, summary) and prepares a reply draft for a person to review. "
            "It ONLY works when the flow starts from a message that arrived through a connected channel (Gmail or a website form), "
            "so the flow must start with the 'Message or webhook received' trigger and never with a manual start."
        ),
        config_hint="{} (optional: \"instructions\" string for tone or policy)",
        example_config={},
        needs_integration="inbound_channel",
    ),
    StepSpec(
        step_type=StepType.AI_EXTRACT_DATA.value,
        label="AI pulls out key details",
        category="ai",
        description="AI extracts named details (such as name, company, amount, date) from free text into structured fields.",
        config_hint='"fields" (list of field names to extract, required); optional "source_field" (where the text is) and "instructions"',
        example_config={"fields": ["name", "company", "amount"]},
    ),
    StepSpec(
        step_type=StepType.CONDITION.value,
        label="If / else decision",
        category="logic",
        description="Sends the run down the 'true' or 'false' path based on a rule.",
        config_hint='at least one of: "field" + "operator" + "value", or "expression", or "conditions". Operators: equals, not_equals, greater_than, less_than, contains. "field" is the name of a field in the incoming data or in the result of an earlier step (for example "amount", "category", "confidence", or a field named in an AI extract step)',
        example_config={"field": "category", "operator": "equals", "value": "enterprise"},
        edge_labels=["true", "false"],
    ),
    StepSpec(
        step_type=StepType.HUMAN_APPROVAL.value,
        label="Ask a person to approve",
        category="human",
        description="Pauses the run until a manager, admin or owner approves or rejects. Nothing downstream runs until they decide.",
        config_hint='at least one of: "approver_role" ("MANAGER"|"ADMIN"|"OWNER"), "title" (string), "timeout_hours" (int)',
        example_config={"approver_role": "MANAGER", "title": "Review before continuing", "timeout_hours": 24},
        edge_labels=["approved", "rejected"],
    ),
    StepSpec(
        step_type=StepType.SEND_REPLY.value,
        label="Send the approved reply",
        category="action",
        description="Queues the approved reply draft for delivery through the connected channel. Only works after a reply draft exists and has been approved.",
        config_hint="{}",
        needs_integration="gmail",
        needs_upstream=StepType.AI_ANALYZE_MESSAGE.value,
    ),
    StepSpec(
        step_type=StepType.MOCK_CRM_CREATE.value,
        label="Add to CRM",
        category="action",
        description="Creates a lead, contact or deal record. Currently a simulated CRM.",
        config_hint='at least one of: "entity_type" ("lead"|"contact"|"deal"), "mapping" (object)',
        example_config={"entity_type": "lead"},
        is_mock=True,
    ),
    StepSpec(
        step_type=StepType.SLACK_NOTIFICATION.value,
        label="Notify the team on Slack",
        category="action",
        description="Posts a message to a Slack channel. Currently simulated unless a webhook URL is supplied.",
        config_hint='at least one of: "channel" (e.g. "#sales"), "message" (string), "webhook_url" (string). Message text may include placeholders written as {{ trigger.field_name }}, {{ ai.category }}, {{ lead.company }} or {{ steps.step_key.field_name }}; any other placeholder style does not work',
        example_config={"channel": "#alerts", "message": "New item needs attention"},
        is_mock=True,
    ),
]

CATALOG_BY_TYPE: Dict[str, StepSpec] = {s.step_type: s for s in STEP_CATALOG}

# Capabilities people commonly ask for that the engine cannot do yet. The builder must say so, not fake it.
UNSUPPORTED_CAPABILITIES: List[str] = [
    "WhatsApp messages (not built yet)",
    "waiting or delaying for a period of time",
    "running on a schedule (daily, weekly)",
    "loops and repeating steps",
    "arbitrary third-party apps beyond the steps above",
]


def catalog_prompt_section() -> str:
    """Renders the catalog as the step-type reference inside the AI system prompt."""
    lines: List[str] = []
    for spec in STEP_CATALOG:
        line = f'  * "{spec.step_type}" ({spec.label}): {spec.description} Config: {spec.config_hint}.'
        if spec.edge_labels:
            labels = " or ".join(f'"{lbl}"' for lbl in spec.edge_labels)
            line += f" IMPORTANT: every outgoing edge must have condition_label {labels}."
        lines.append(line)
    return "\n".join(lines)


def catalog_as_dicts() -> List[Dict[str, Any]]:
    return [
        {
            "step_type": s.step_type,
            "label": s.label,
            "category": s.category,
            "description": s.description,
            "example_config": s.example_config,
            "edge_labels": s.edge_labels,
            "is_trigger": s.is_trigger,
            "is_mock": s.is_mock,
            "needs_integration": s.needs_integration,
        }
        for s in STEP_CATALOG
    ]


_ALLOWED_PLACEHOLDER_ROOTS = ("trigger", "ai", "lead", "steps", "workflow")
_PLACEHOLDER = re.compile(r"\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}")


def flow_semantic_errors(steps: Sequence[Any], connections: Sequence[Any]) -> List[str]:
    """
    Rules that keep a generated flow from passing structural validation and then failing on its first real run.
    Used by the AI builder only (the general validator stays permissive so existing workflows are unaffected).
    """
    def g(o: Any, name: str) -> Any:
        return o.get(name) if isinstance(o, dict) else getattr(o, name, None)

    errors: List[str] = []
    by_key = {g(s, "step_key"): s for s in steps}
    types = {k: g(s, "step_type") for k, s in by_key.items()}

    incoming: Dict[str, List[str]] = defaultdict(list)
    for c in connections:
        incoming[g(c, "target_step_key")].append(g(c, "source_step_key"))

    def ancestors(key: str) -> Set[str]:
        seen: Set[str] = set()
        stack = list(incoming.get(key, []))
        while stack:
            cur = stack.pop()
            if cur in seen:
                continue
            seen.add(cur)
            stack.extend(incoming.get(cur, []))
        return seen

    has_manual_trigger = any(t == StepType.MANUAL_TRIGGER.value for t in types.values())
    for key, t in types.items():
        if t == StepType.AI_ANALYZE_MESSAGE.value and has_manual_trigger:
            errors.append(
                f"Step '{key}' (AI reads a message) cannot follow a manual start: it needs a message that arrived from a connected "
                "channel. Start the flow with WEBHOOK_TRIGGER instead of MANUAL_TRIGGER."
            )
        if t == StepType.SEND_REPLY.value:
            anc_types = {types.get(a) for a in ancestors(key)}
            if StepType.AI_ANALYZE_MESSAGE.value not in anc_types:
                errors.append(f"Step '{key}' (send the approved reply) needs an AI_ANALYZE_MESSAGE step earlier in the flow to prepare the reply draft.")
            if StepType.HUMAN_APPROVAL.value not in anc_types:
                errors.append(f"Step '{key}' (send the approved reply) needs a HUMAN_APPROVAL step earlier in the flow; replies are never sent without approval.")
        if t == StepType.SLACK_NOTIFICATION.value:
            message = (g(by_key[key], "config") or {}).get("message")
            if isinstance(message, str):
                for root in (m.group(1).split(".")[0].lower() for m in _PLACEHOLDER.finditer(message)):
                    if root not in _ALLOWED_PLACEHOLDER_ROOTS:
                        errors.append(
                            f"Step '{key}' message uses a placeholder starting with '{root}', which does not work. "
                            "Write placeholders like {{ trigger.field_name }} or {{ steps.step_key.field_name }}."
                        )
                        break
    return errors
