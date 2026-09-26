from collections import defaultdict, deque
from typing import Any, Dict, List, Set, Union
from app.schemas.workflow import (
    StepType,
    WorkflowConnectionSchema,
    WorkflowStepSchema,
    WorkflowValidationResult,
)

APPROVED_STEP_TYPES: Set[str] = {t.value for t in StepType}
TRIGGER_STEP_TYPES: Set[str] = {
    StepType.WEBHOOK_TRIGGER.value,
    StepType.MANUAL_TRIGGER.value,
}


def validate_step_config(step_key: str, step_type: str, config: Dict[str, Any]) -> List[str]:
    """
    Validates required configuration attributes per step executor type.
    
    Semantics for required fields:
    - AI_CLASSIFICATION: OR semantics (requires 'prompt' or 'categories'; both may be supplied)
    - SLACK_NOTIFICATION: OR semantics (requires 'channel', 'message', or 'webhook_url'; at least one must be supplied)
    - CONDITION: OR semantics (requires 'conditions', 'expression', or 'field')
    - MOCK_CRM_CREATE: OR semantics (requires 'entity_type' or 'mapping')
    - VALIDATE_DATA: OR semantics (requires 'schema', 'rules', or 'required_fields')
    - HUMAN_APPROVAL: OR semantics (requires 'approver_role', 'title', or 'timeout_hours')
    - WEBHOOK_TRIGGER / MANUAL_TRIGGER: optional configuration (empty dict allowed)
    """
    errors: List[str] = []

    if step_type == StepType.AI_CLASSIFICATION.value:
        if not config.get("prompt") and not config.get("categories"):
            errors.append(
                f"Step '{step_key}' ({step_type}) requires 'prompt' or 'categories' in configuration"
            )
    elif step_type == StepType.SLACK_NOTIFICATION.value:
        if not config.get("channel") and not config.get("message") and not config.get("webhook_url"):
            errors.append(
                f"Step '{step_key}' ({step_type}) requires 'channel', 'message', or 'webhook_url' in configuration"
            )
    elif step_type == StepType.CONDITION.value:
        if not config.get("conditions") and not config.get("expression") and not config.get("field"):
            errors.append(
                f"Step '{step_key}' ({step_type}) requires 'conditions', 'expression', or 'field' in configuration"
            )
    elif step_type == StepType.MOCK_CRM_CREATE.value:
        if not config.get("entity_type") and not config.get("mapping"):
            errors.append(
                f"Step '{step_key}' ({step_type}) requires 'entity_type' or 'mapping' in configuration"
            )
    elif step_type == StepType.VALIDATE_DATA.value:
        if not config.get("schema") and not config.get("rules") and not config.get("required_fields"):
            errors.append(
                f"Step '{step_key}' ({step_type}) requires 'schema', 'rules', or 'required_fields' in configuration"
            )
    elif step_type == StepType.HUMAN_APPROVAL.value:
        if not config.get("approver_role") and not config.get("title") and not config.get("timeout_hours"):
            errors.append(
                f"Step '{step_key}' ({step_type}) requires 'approver_role', 'title', or 'timeout_hours' in configuration"
            )

    return errors


def validate_workflow_dag(
    steps: List[Any],
    connections: List[Any],
) -> WorkflowValidationResult:
    """
    Validates a workflow DAG against structural and semantic rules:
    1. Exactly one trigger node.
    2. Valid registered step types.
    3. Required node configurations.
    4. Unique step keys.
    5. Connection integrity (no dangling edges, no self-loops, triggers cannot be targets).
    6. Reachability (all non-trigger nodes must be reachable from trigger).
    7. Acyclic DAG (Kahn's algorithm cycle check).
    """
    errors: List[str] = []
    warnings: List[str] = []

    # 1. Non-empty check
    if not steps:
        errors.append("Workflow must contain at least one step")
        return WorkflowValidationResult(valid=False, errors=errors, warnings=warnings)

    step_keys: Set[str] = set()
    step_dict: Dict[str, Any] = {}
    triggers: List[str] = []

    # 2. Step keys, types, configs
    for s in steps:
        key = getattr(s, "step_key", None) or (s.get("step_key") if isinstance(s, dict) else None)
        stype = getattr(s, "step_type", None) or (s.get("step_type") if isinstance(s, dict) else None)
        cfg = getattr(s, "config", {}) or (s.get("config", {}) if isinstance(s, dict) else {})

        if not key:
            errors.append("Step missing required 'step_key'")
            continue

        if key in step_keys:
            errors.append(f"Duplicate step_key detected: '{key}'")
        step_keys.add(key)
        step_dict[key] = s

        # Step type registry validation
        if stype not in APPROVED_STEP_TYPES:
            errors.append(f"Step '{key}' specifies invalid step_type: '{stype}'")
        elif stype in TRIGGER_STEP_TYPES:
            triggers.append(key)

        # Config validation
        if stype in APPROVED_STEP_TYPES:
            config_errors = validate_step_config(key, stype, cfg)
            errors.extend(config_errors)

    # 3. Trigger cardinality validation
    if len(triggers) == 0:
        errors.append("Workflow must contain exactly one trigger step (WEBHOOK_TRIGGER or MANUAL_TRIGGER)")
    elif len(triggers) > 1:
        errors.append(
            f"Workflow contains {len(triggers)} trigger steps ({', '.join(triggers)}); exactly one trigger is permitted"
        )

    # 4. Connection integrity
    adj: Dict[str, List[str]] = defaultdict(list)
    in_degree: Dict[str, int] = {k: 0 for k in step_keys}
    out_degree: Dict[str, int] = {k: 0 for k in step_keys}

    for c in connections:
        src = getattr(c, "source_step_key", None) or (c.get("source_step_key") if isinstance(c, dict) else None)
        tgt = getattr(c, "target_step_key", None) or (c.get("target_step_key") if isinstance(c, dict) else None)

        if not src or not tgt:
            errors.append("Connection missing source_step_key or target_step_key")
            continue

        if src not in step_keys:
            errors.append(f"Connection source '{src}' does not exist in workflow steps")
        if tgt not in step_keys:
            errors.append(f"Connection target '{tgt}' does not exist in workflow steps")

        if src in step_keys and tgt in step_keys:
            if src == tgt:
                errors.append(f"Self-referencing loop detected on step '{src}'")
                continue

            if tgt in triggers:
                errors.append(f"Trigger step '{tgt}' cannot be the target of a connection")

            adj[src].append(tgt)
            in_degree[tgt] += 1
            out_degree[src] += 1

    # 5. Reachability Check (All non-trigger nodes must be reachable from trigger)
    if triggers and len(triggers) == 1:
        trigger_node = triggers[0]
        reachable: Set[str] = set()
        queue = deque([trigger_node])

        while queue:
            curr = queue.popleft()
            if curr not in reachable:
                reachable.add(curr)
                for neighbor in adj[curr]:
                    if neighbor not in reachable:
                        queue.append(neighbor)

        unreachable = step_keys - reachable
        if unreachable:
            for unreach_key in sorted(unreachable):
                errors.append(f"Step '{unreach_key}' is not reachable from the trigger node")

    # 6. Cycle Detection using Kahn's Algorithm
    in_degree_copy = in_degree.copy()
    q = deque([k for k in step_keys if in_degree_copy[k] == 0])
    visited_count = 0

    while q:
        curr = q.popleft()
        visited_count += 1
        for neighbor in adj[curr]:
            in_degree_copy[neighbor] -= 1
            if in_degree_copy[neighbor] == 0:
                q.append(neighbor)

    if visited_count < len(step_keys):
        errors.append("Workflow contains circular dependencies (cycles detected in DAG)")

    # 7. Check condition branches warning
    for key, s in step_dict.items():
        stype = getattr(s, "step_type", None) or (s.get("step_type") if isinstance(s, dict) else None)
        if stype == StepType.CONDITION.value and out_degree[key] < 2:
            warnings.append(f"Condition step '{key}' has fewer than 2 outgoing branch connections")

    return WorkflowValidationResult(
        valid=len(errors) == 0,
        errors=errors,
        warnings=warnings,
    )
