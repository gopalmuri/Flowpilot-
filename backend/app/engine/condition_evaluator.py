from typing import Any, Dict, List, Optional, Tuple, Union
from app.schemas.condition import ConditionOperator, LogicalOperator, RuleGroup, ConditionClause


def resolve_path_entry(path: str, context: Dict[str, Any]) -> Tuple[bool, Any]:
    """
    Safely resolves dot-notation variable paths against context dictionary.
    Returns (found: bool, value: Any).
    Distinguishes between a path that exists with value None vs a path that doesn't exist.
    """
    if not path or not isinstance(path, str) or not isinstance(context, dict):
        return False, None

    segments = path.strip().split(".")
    curr: Any = context

    for i, seg in enumerate(segments):
        if isinstance(curr, dict):
            if seg in curr:
                curr = curr[seg]
            else:
                return False, None
        elif isinstance(curr, list):
            try:
                idx = int(seg)
                if 0 <= idx < len(curr):
                    curr = curr[idx]
                else:
                    return False, None
            except ValueError:
                return False, None
        else:
            return False, None

    return True, curr


def resolve_path_value(path: str, context: Dict[str, Any]) -> Any:
    """
    Safely resolves dot-notation variable paths against context dictionary.
    Returns None if any path segment does not exist. Preserves backward compatibility.
    """
    found, val = resolve_path_entry(path, context)
    return val if found else None


def resolve_context_path(field: str, context: Dict[str, Any]) -> Tuple[bool, Any]:
    """
    Resolves field path searching context root, then trigger_payload, then workflow_data.
    """
    found, val = resolve_path_entry(field, context)
    if not found and "trigger_payload" in context and isinstance(context["trigger_payload"], dict):
        found, val = resolve_path_entry(field, context["trigger_payload"])
    if not found and "workflow_data" in context and isinstance(context["workflow_data"], dict):
        found, val = resolve_path_entry(field, context["workflow_data"])
    return found, val


def _is_boolean(val: Any) -> bool:
    return isinstance(val, bool)


def _is_numeric(val: Any) -> bool:
    if isinstance(val, bool) or val is None:
        return False
    return isinstance(val, (int, float))


def evaluate_is_empty(value: Any) -> bool:
    """
    Deterministic scalar-safe emptiness evaluation.
    - None -> True
    - "" -> True
    - [] -> True
    - {} -> True
    - non-empty string/list/dict/set/tuple -> False
    - scalar numbers (int, float) and booleans -> False (never raises TypeError)
    """
    if value is None:
        return True
    if isinstance(value, (str, list, dict, set, tuple)):
        return len(value) == 0
    if isinstance(value, (int, float, bool)):
        return False
    return False


def evaluate_is_not_empty(value: Any) -> bool:
    """
    Deterministic scalar-safe non-emptiness evaluation.
    - non-empty string/list/dict/set/tuple -> True
    - None -> False
    - "" -> False
    - [] -> False
    - {} -> False
    - scalar numbers (int, float) and booleans -> False (never raises TypeError)
    """
    if value is None:
        return False
    if isinstance(value, (str, list, dict, set, tuple)):
        return len(value) > 0
    if isinstance(value, (int, float, bool)):
        return False
    return False


def evaluate_contains(field_value: Any, expected_value: Any) -> bool:
    """
    Evaluates: field_value contains expected_value
    - String field: checks if str(expected_value) is a substring of field_value
    - List / Set / Tuple field: checks if expected_value is in field_value
    - Dict field: checks if expected_value (or str(expected_value)) is a KEY in field_value
    - Scalar / None / incompatible: returns False deterministically without exception
    """
    if field_value is None or expected_value is None:
        return False

    if isinstance(field_value, str):
        return str(expected_value) in field_value

    if isinstance(field_value, (list, set, tuple)):
        try:
            return expected_value in field_value
        except TypeError:
            return False

    if isinstance(field_value, dict):
        # Operates strictly against dictionary keys
        try:
            if expected_value in field_value:
                return True
            if not isinstance(expected_value, (dict, list, set)):
                return str(expected_value) in field_value
        except TypeError:
            return False
        return False

    return False


def evaluate_in(field_value: Any, expected_value: Any) -> bool:
    """
    Evaluates: field_value is a member of expected_value/container
    - String expected_value: checks if str(field_value) is a substring of expected_value
    - List / Set / Tuple expected_value: checks if field_value is in expected_value
    - Dict expected_value: checks if field_value (or str(field_value)) is a KEY in expected_value
    - Scalar / None / incompatible: returns False deterministically without exception
    """
    if field_value is None or expected_value is None:
        return False

    if isinstance(expected_value, str):
        return str(field_value) in expected_value

    if isinstance(expected_value, (list, set, tuple)):
        try:
            return field_value in expected_value
        except TypeError:
            return False

    if isinstance(expected_value, dict):
        # Operates strictly against dictionary keys
        try:
            if field_value in expected_value:
                return True
            if not isinstance(field_value, (dict, list, set)):
                return str(field_value) in expected_value
        except TypeError:
            return False
        return False

    return False


def compare_values(actual: Any, op: str, expected: Any, found: bool = True) -> bool:
    """
    Safely and deterministically evaluates 16 canonical comparison operators without eval() or exec().
    """
    normalized_op = op.strip().lower()

    # Canonical: equals
    if normalized_op in ("equals", "==", "eq"):
        if _is_boolean(actual) or _is_boolean(expected):
            if _is_boolean(actual) and _is_boolean(expected):
                return actual is expected
            return False
        if _is_numeric(actual) and _is_numeric(expected):
            return actual == expected
        return actual == expected

    # Canonical: not_equals
    if normalized_op in ("not_equals", "!=", "neq"):
        if _is_boolean(actual) or _is_boolean(expected):
            if _is_boolean(actual) and _is_boolean(expected):
                return actual is not expected
            return True
        if _is_numeric(actual) and _is_numeric(expected):
            return actual != expected
        return actual != expected

    # Canonical: exists / not_exists
    if normalized_op == "exists":
        return found
    if normalized_op == "not_exists":
        return not found

    # Canonical: is_null / is_not_null
    if normalized_op in ("is_null", "null"):
        return not found or actual is None
    if normalized_op in ("is_not_null", "not_null"):
        return found and actual is not None

    # Canonical: is_empty / is_not_empty
    if normalized_op in ("is_empty", "empty"):
        return evaluate_is_empty(actual)
    if normalized_op in ("is_not_empty", "not_empty"):
        return evaluate_is_not_empty(actual)

    # Canonical: contains / not_contains
    if normalized_op in ("contains", "contain"):
        return evaluate_contains(actual, expected)
    if normalized_op in ("not_contains", "not_contain"):
        return not evaluate_contains(actual, expected)

    # Canonical: in / not_in
    if normalized_op == "in":
        return evaluate_in(actual, expected)
    if normalized_op == "not_in":
        return not evaluate_in(actual, expected)

    # Relational: require compatible types
    if normalized_op in ("greater_than", ">", "gt"):
        if _is_boolean(actual) or _is_boolean(expected):
            return False
        try:
            if _is_numeric(actual) and _is_numeric(expected):
                return actual > expected
            if type(actual) == type(expected):
                return actual > expected
        except TypeError:
            return False
        return False

    if normalized_op in ("less_than", "<", "lt"):
        if _is_boolean(actual) or _is_boolean(expected):
            return False
        try:
            if _is_numeric(actual) and _is_numeric(expected):
                return actual < expected
            if type(actual) == type(expected):
                return actual < expected
        except TypeError:
            return False
        return False

    if normalized_op in ("greater_than_or_equal", ">=", "gte"):
        if _is_boolean(actual) or _is_boolean(expected):
            return False
        try:
            if _is_numeric(actual) and _is_numeric(expected):
                return actual >= expected
            if type(actual) == type(expected):
                return actual >= expected
        except TypeError:
            return False
        return False

    if normalized_op in ("less_than_or_equal", "<=", "lte"):
        if _is_boolean(actual) or _is_boolean(expected):
            return False
        try:
            if _is_numeric(actual) and _is_numeric(expected):
                return actual <= expected
            if type(actual) == type(expected):
                return actual <= expected
        except TypeError:
            return False
        return False

    raise ValueError(f"Unsupported condition operator: '{op}'")


def evaluate_clause(clause: Union[ConditionClause, Dict[str, Any]], context: Dict[str, Any]) -> bool:
    """
    Evaluates a single ConditionClause against context.
    """
    if isinstance(clause, ConditionClause):
        field_path = clause.field
        op = clause.operator.value if hasattr(clause.operator, "value") else str(clause.operator)
        expected_val = clause.value
    elif isinstance(clause, dict):
        field_path = clause.get("field", "")
        op = clause.get("operator", "equals")
        expected_val = clause.get("value")
    else:
        return False

    found, actual_val = resolve_context_path(field_path, context)
    return compare_values(actual_val, op, expected_val, found=found)


def evaluate_rule_group(group: Union[RuleGroup, Dict[str, Any]], context: Dict[str, Any]) -> bool:
    """
    Recursively evaluates a nested RuleGroup against context.
    - AND: all clauses and groups must evaluate to True
    - OR: at least one clause or group must evaluate to True
    - NOT: exactly one child must exist, and its result is inverted
    """
    if isinstance(group, dict):
        logic_str = group.get("logic", "AND")
        logic = LogicalOperator(logic_str.upper()) if isinstance(logic_str, str) else logic_str
        clauses = group.get("clauses", [])
        subgroups = group.get("groups", [])
    else:
        logic = group.logic
        clauses = group.clauses
        subgroups = group.groups

    total_children = len(clauses) + len(subgroups)

    if logic == LogicalOperator.NOT or logic == "NOT":
        if total_children != 1:
            raise ValueError(f"A 'NOT' rule group must have exactly 1 child, found {total_children}")
        if clauses:
            return not evaluate_clause(clauses[0], context)
        else:
            return not evaluate_rule_group(subgroups[0], context)

    # AND logic
    if logic == LogicalOperator.AND or logic == "AND":
        if total_children == 0:
            return True
        for c in clauses:
            if not evaluate_clause(c, context):
                return False
        for g in subgroups:
            if not evaluate_rule_group(g, context):
                return False
        return True

    # OR logic
    if logic == LogicalOperator.OR or logic == "OR":
        if total_children == 0:
            return True
        for c in clauses:
            if evaluate_clause(c, context):
                return True
        for g in subgroups:
            if evaluate_rule_group(g, context):
                return True
        return False

    raise ValueError(f"Unsupported logical operator: '{logic}'")


def evaluate_condition_rule(
    config: Dict[str, Any],
    context: Dict[str, Any],
) -> Tuple[bool, str]:
    """
    Evaluates a condition step configuration against execution context.
    Returns:
      (result: bool, selected_branch_label: str)
      Branch label is 'true' if result is True, else 'false'.
    """
    if not config:
        return True, "true"

    # 1. Advanced nested RuleGroup
    if "rule_group" in config and config["rule_group"]:
        res = evaluate_rule_group(config["rule_group"], context)
        return res, "true" if res else "false"

    # If config itself is structured as a RuleGroup with "logic" and ("clauses" or "groups")
    if "logic" in config and ("clauses" in config or "groups" in config):
        res = evaluate_rule_group(config, context)
        return res, "true" if res else "false"

    # 2. Backward compatible multi-clause structure: conditions: List[Dict], logic: "AND" | "OR"
    if "conditions" in config and isinstance(config["conditions"], list):
        clauses = config["conditions"]
        logic = config.get("logic", "AND")
        if isinstance(logic, str):
            logic_op = logic.strip().upper()
        elif hasattr(logic, "value"):
            logic_op = logic.value
        else:
            logic_op = "AND"

        if not clauses:
            return True, "true"

        results: List[bool] = [evaluate_clause(c, context) for c in clauses]
        overall = all(results) if logic_op == "AND" else any(results)
        return overall, "true" if overall else "false"

    # 3. Backward compatible single-clause structure: field, operator, value
    if "field" in config:
        res = evaluate_clause(config, context)
        return res, "true" if res else "false"

    # Default fallback
    return True, "true"
