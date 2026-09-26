import ast
from pathlib import Path
import pytest
from pydantic import ValidationError
from app.engine.condition_evaluator import (
    compare_values,
    evaluate_condition_rule,
    evaluate_is_empty,
    evaluate_is_not_empty,
    evaluate_contains,
    evaluate_in,
    resolve_path_entry,
    resolve_path_value,
)
from app.schemas.condition import (
    ConditionClause,
    ConditionOperator,
    LogicalOperator,
    RuleGroup,
)


# ---------------------------------------------------------------------------
# 1. Canonical Operators & Type Safety
# ---------------------------------------------------------------------------
def test_canonical_relational_operators():
    assert compare_values(100, "equals", 100) is True
    assert compare_values(100, "equals", 100.0) is True
    assert compare_values(100, "equals", 200) is False
    assert compare_values(100, "not_equals", 200) is True
    assert compare_values(100, "not_equals", 100) is False

    assert compare_values(50, "greater_than", 25) is True
    assert compare_values(25, "greater_than", 50) is False
    assert compare_values(50, "greater_than_or_equal", 50) is True
    assert compare_values(50, "greater_than_or_equal", 49) is True
    assert compare_values(49, "greater_than_or_equal", 50) is False

    assert compare_values(25, "less_than", 50) is True
    assert compare_values(50, "less_than", 25) is False
    assert compare_values(25, "less_than_or_equal", 25) is True
    assert compare_values(25, "less_than_or_equal", 26) is True
    assert compare_values(26, "less_than_or_equal", 25) is False


def test_type_mismatch_and_boolean_isolation():
    # Boolean vs Number isolation: True must NOT equal 1, False must NOT equal 0
    assert compare_values(True, "equals", 1) is False
    assert compare_values(False, "equals", 0) is False
    assert compare_values(True, "not_equals", 1) is True
    assert compare_values(False, "not_equals", 0) is True
    assert compare_values(True, "greater_than", 0) is False
    assert compare_values(True, "less_than", 2) is False

    # Incompatible operand types evaluate to False without raising exceptions
    assert compare_values("100", "greater_than", 50) is False
    assert compare_values(50, "less_than", "100") is False
    assert compare_values("abc", "greater_than", 50) is False
    assert compare_values(None, "greater_than", 10) is False
    assert compare_values(10, "less_than", None) is False


# ---------------------------------------------------------------------------
# 2. Scalar-Safe is_empty & is_not_empty for all JSON-compatible types
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "val, expected_empty, expected_not_empty",
    [
        (None, True, False),
        ("", True, False),
        ("hello", False, True),
        ([], True, False),
        (["item"], False, True),
        ({}, True, False),
        ({"k": "v"}, False, True),
        (0, False, False),
        (100, False, False),
        (-5, False, False),
        (0.0, False, False),
        (3.14, False, False),
        (True, False, False),
        (False, False, False),
    ],
)
def test_is_empty_and_is_not_empty_all_types(val, expected_empty, expected_not_empty):
    assert evaluate_is_empty(val) is expected_empty
    assert evaluate_is_not_empty(val) is expected_not_empty
    assert compare_values(val, "is_empty", None) is expected_empty
    assert compare_values(val, "is_not_empty", None) is expected_not_empty


# ---------------------------------------------------------------------------
# 3. Explicit contains / not_contains direction and type semantics
# ---------------------------------------------------------------------------
def test_contains_and_not_contains():
    # String field
    assert compare_values("enterprise plan", "contains", "enterprise") is True
    assert compare_values("enterprise plan", "contains", "starter") is False
    assert compare_values("enterprise plan", "not_contains", "starter") is True

    # List field
    assert compare_values(["enterprise", "saas"], "contains", "enterprise") is True
    assert compare_values(["enterprise", "saas"], "contains", "starter") is False
    assert compare_values(["enterprise", "saas"], "not_contains", "starter") is True

    # Set field
    assert compare_values({"enterprise", "saas"}, "contains", "enterprise") is True
    assert compare_values({"enterprise", "saas"}, "contains", "starter") is False

    # Dictionary field: operates STRICTLY against dictionary KEYS
    assert compare_values({"enterprise": 100, "saas": 200}, "contains", "enterprise") is True
    # "100" or 100 is a value, not a key -> must evaluate to False
    assert compare_values({"tier": "enterprise"}, "contains", "enterprise") is False
    assert compare_values({"tier": "enterprise"}, "not_contains", "enterprise") is True
    assert compare_values({"tier": "enterprise"}, "contains", "tier") is True

    # Scalar / None operands -> deterministic False / True without TypeError
    assert compare_values(12345, "contains", "123") is False
    assert compare_values(12345, "not_contains", "123") is True
    assert compare_values(None, "contains", "test") is False
    assert compare_values(None, "not_contains", "test") is True
    assert compare_values(True, "contains", True) is False
    assert compare_values(3.14, "contains", 3) is False


# ---------------------------------------------------------------------------
# 4. Explicit in / not_in direction and type semantics
# ---------------------------------------------------------------------------
def test_in_and_not_in():
    # String container
    assert compare_values("enterprise", "in", "enterprise plan") is True
    assert compare_values("starter", "in", "enterprise plan") is False
    assert compare_values("starter", "not_in", "enterprise plan") is True

    # List container
    assert compare_values("HOT", "in", ["HOT", "WARM"]) is True
    assert compare_values("COLD", "in", ["HOT", "WARM"]) is False
    assert compare_values("COLD", "not_in", ["HOT", "WARM"]) is True

    # Set container
    assert compare_values("HOT", "in", {"HOT", "WARM"}) is True
    assert compare_values("COLD", "in", {"HOT", "WARM"}) is False

    # Dictionary container: operates STRICTLY against dictionary KEYS
    assert compare_values("tier", "in", {"tier": "enterprise"}) is True
    # "enterprise" is a value, not a key -> must evaluate to False
    assert compare_values("enterprise", "in", {"tier": "enterprise"}) is False
    assert compare_values("enterprise", "not_in", {"tier": "enterprise"}) is True

    # Scalar / None container -> deterministic False / True without TypeError
    assert compare_values("test", "in", 12345) is False
    assert compare_values("test", "not_in", 12345) is True
    assert compare_values("test", "in", None) is False
    assert compare_values("test", "not_in", None) is True
    assert compare_values("test", "in", True) is False
    assert compare_values("test", "in", 3.14) is False


# ---------------------------------------------------------------------------
# 5. Existence & Nullity
# ---------------------------------------------------------------------------
def test_exists_and_nullity():
    ctx = {
        "existing_key": "some_value",
        "null_key": None,
    }

    # exists: True if key found, even if value is None
    found1, val1 = resolve_path_entry("existing_key", ctx)
    assert compare_values(val1, "exists", None, found=found1) is True
    found2, val2 = resolve_path_entry("null_key", ctx)
    assert compare_values(val2, "exists", None, found=found2) is True
    found3, val3 = resolve_path_entry("missing_key", ctx)
    assert compare_values(val3, "exists", None, found=found3) is False
    assert compare_values(val3, "not_exists", None, found=found3) is True

    # is_null / is_not_null
    assert compare_values(val2, "is_null", None, found=found2) is True
    assert compare_values(val1, "is_null", None, found=found1) is False
    assert compare_values(val1, "is_not_null", None, found=found1) is True
    assert compare_values(val3, "is_null", None, found=found3) is True
    assert compare_values(val3, "is_not_null", None, found=found3) is False


# ---------------------------------------------------------------------------
# 6. Nested Rule Groups (AND, OR, NOT with single-child invariant)
# ---------------------------------------------------------------------------
def test_rule_group_structures():
    # Valid AND group
    grp_and = RuleGroup(
        logic=LogicalOperator.AND,
        clauses=[
            ConditionClause(field="amount", operator=ConditionOperator.GREATER_THAN, value=500),
            ConditionClause(field="tier", operator=ConditionOperator.EQUALS, value="gold"),
        ],
    )
    assert len(grp_and.clauses) == 2

    # Valid NOT group: exactly one child
    grp_not = RuleGroup(
        logic=LogicalOperator.NOT,
        clauses=[
            ConditionClause(field="status", operator=ConditionOperator.EQUALS, value="churned"),
        ],
    )
    assert len(grp_not.clauses) == 1

    # Invalid NOT group: zero children raises ValidationError
    with pytest.raises(ValidationError):
        RuleGroup(logic=LogicalOperator.NOT, clauses=[])

    # Invalid NOT group: 2 children raises ValidationError
    with pytest.raises(ValidationError):
        RuleGroup(
            logic=LogicalOperator.NOT,
            clauses=[
                ConditionClause(field="a", operator=ConditionOperator.EQUALS, value=1),
                ConditionClause(field="b", operator=ConditionOperator.EQUALS, value=2),
            ],
        )

    # Invalid AND group: 0 children raises ValidationError
    with pytest.raises(ValidationError):
        RuleGroup(logic=LogicalOperator.AND, clauses=[])


def test_evaluate_condition_rule_nested_group():
    context = {
        "lead": {
            "score": 85,
            "category": "HOT",
            "country": "US",
            "opt_out": False,
        }
    }

    # Rule: (score > 80 AND category == "HOT") AND NOT(opt_out == True)
    config = {
        "rule_group": {
            "logic": "AND",
            "clauses": [
                {"field": "lead.score", "operator": "greater_than", "value": 80},
                {"field": "lead.category", "operator": "equals", "value": "HOT"},
            ],
            "groups": [
                {
                    "logic": "NOT",
                    "clauses": [
                        {"field": "lead.opt_out", "operator": "equals", "value": True},
                    ],
                }
            ],
        }
    }

    res, branch = evaluate_condition_rule(config, context)
    assert res is True
    assert branch == "true"

    # Invert opt_out -> should evaluate to False and branch "false"
    context["lead"]["opt_out"] = True
    res, branch = evaluate_condition_rule(config, context)
    assert res is False
    assert branch == "false"


# ---------------------------------------------------------------------------
# 7. AST Security Audit: Zero eval(), exec(), compile()
# ---------------------------------------------------------------------------
def test_zero_dynamic_code_execution_in_evaluator():
    engine_dir = Path("E:/flowpilot/backend/app/engine")
    forbidden_calls = {"eval", "exec", "compile"}

    for py_file in engine_dir.glob("*.py"):
        code = py_file.read_text(encoding="utf-8")
        tree = ast.parse(code, filename=str(py_file))
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                if isinstance(node.func, ast.Name) and node.func.id in forbidden_calls:
                    pytest.fail(f"Forbidden dynamic call '{node.func.id}' found in {py_file}")


# ---------------------------------------------------------------------------
# 8. Phase 16 Coverage Elevation: Comprehensive Edge Cases & Branches
# ---------------------------------------------------------------------------
from app.engine.condition_evaluator import (
    evaluate_clause,
    evaluate_rule_group,
    resolve_context_path,
)

def test_path_resolution_list_indexing_and_fallbacks():
    context = {
        "items": [{"name": "item0"}, {"name": "item1"}],
        "trigger_payload": {"fallback_trigger": "from_trigger"},
        "workflow_data": {"fallback_wf": 999},
        "scalar_leaf": "not_a_dict",
    }

    # List index access
    found, val = resolve_path_entry("items.0.name", context)
    assert found is True and val == "item0"
    found, val = resolve_path_entry("items.1.name", context)
    assert found is True and val == "item1"

    # Out of range list index
    found, val = resolve_path_entry("items.99.name", context)
    assert found is False and val is None

    # Invalid list index (non-integer)
    found, val = resolve_path_entry("items.not_an_int.name", context)
    assert found is False and val is None

    # Traversing through a scalar leaf
    found, val = resolve_path_entry("scalar_leaf.invalid_child", context)
    assert found is False and val is None

    # Fallback to trigger_payload
    found, val = resolve_context_path("fallback_trigger", context)
    assert found is True and val == "from_trigger"

    # Fallback to workflow_data
    found, val = resolve_context_path("fallback_wf", context)
    assert found is True and val == 999

    # Nonexistent path across all levels
    found, val = resolve_context_path("totally_missing", context)
    assert found is False and val is None


def test_empty_and_contains_in_edge_cases():
    # evaluate_is_empty
    assert evaluate_is_empty(None) is True
    assert evaluate_is_empty("") is True
    assert evaluate_is_empty([]) is True
    assert evaluate_is_empty({}) is True
    assert evaluate_is_empty(0) is False
    assert evaluate_is_empty(False) is False
    assert evaluate_is_empty(["non-empty"]) is False

    # evaluate_is_not_empty
    assert evaluate_is_not_empty(None) is False
    assert evaluate_is_not_empty("hello") is True

    # evaluate_contains against set and dict keys
    assert evaluate_contains({"alpha", "beta"}, "alpha") is True
    assert evaluate_contains({"alpha", "beta"}, "gamma") is False
    assert evaluate_contains({"key1": "val1"}, "key1") is True
    assert evaluate_contains({"key1": "val1"}, "missing_key") is False
    assert evaluate_contains(12345, "anything") is False

    # evaluate_in against various containers
    assert evaluate_in(None, [1, 2, 3]) is False
    assert evaluate_in(1, None) is False
    assert evaluate_in("apple", "apple pie") is True
    assert evaluate_in("foo", ["foo", "bar"]) is True
    assert evaluate_in("key_a", {"key_a": 100}) is True
    assert evaluate_in("missing", {"key_a": 100}) is False
    assert evaluate_in("x", 42) is False


def test_relational_comparisons_and_unsupported_operators():
    # Relational ops with boolean isolation (booleans should return False in relational ops)
    assert compare_values(True, "greater_than", 0) is False
    assert compare_values(False, "less_than", 1) is False
    assert compare_values(True, "greater_than_or_equal", 1) is False
    assert compare_values(False, "less_than_or_equal", 0) is False

    # Relational ops with incompatible types
    assert compare_values("hello", "greater_than", 123) is False
    assert compare_values(123, "less_than", "hello") is False
    assert compare_values("hello", "greater_than_or_equal", 123) is False
    assert compare_values(123, "less_than_or_equal", "hello") is False

    # Unsupported condition operator
    with pytest.raises(ValueError, match="Unsupported condition operator"):
        compare_values(10, "unknown_operator_xyz", 10)

    # Invalid clause input type
    assert evaluate_clause(12345, {}) is False


def test_rule_group_advanced_logic_branches():
    context = {"user": {"role": "admin", "score": 95}}

    # Empty rule group returns True
    assert evaluate_rule_group({"logic": "AND", "clauses": []}, context) is True
    assert evaluate_rule_group({"logic": "OR", "clauses": []}, context) is True

    # OR logic evaluation: one match
    or_grp = {
        "logic": "OR",
        "clauses": [
            {"field": "user.role", "operator": "equals", "value": "guest"},
            {"field": "user.score", "operator": "greater_than", "value": 90},
        ],
    }
    assert evaluate_rule_group(or_grp, context) is True

    # OR logic evaluation: no match
    or_fail = {
        "logic": "OR",
        "clauses": [
            {"field": "user.role", "operator": "equals", "value": "guest"},
            {"field": "user.score", "operator": "less_than", "value": 50},
        ],
    }
    assert evaluate_rule_group(or_fail, context) is False

    # NOT logic with subgroup
    not_with_subgroup = {
        "logic": "NOT",
        "groups": [
            {
                "logic": "AND",
                "clauses": [
                    {"field": "user.role", "operator": "equals", "value": "guest"},
                ],
            }
        ],
    }
    assert evaluate_rule_group(not_with_subgroup, context) is True

    # Unsupported logical operator
    with pytest.raises(ValueError):
        evaluate_rule_group({"logic": "XOR", "clauses": []}, context)
    # NOT logic with 0 or >1 children
    with pytest.raises(ValueError, match="must have exactly 1 child"):
        evaluate_rule_group({"logic": "NOT", "clauses": []}, context)
    with pytest.raises(ValueError, match="must have exactly 1 child"):
        evaluate_rule_group({
            "logic": "NOT",
            "clauses": [
                {"field": "user.role", "operator": "equals", "value": "admin"},
                {"field": "user.score", "operator": "equals", "value": 95},
            ]
        }, context)



def test_evaluate_condition_rule_legacy_and_fallback_shapes():
    context = {"status": "ACTIVE", "score": 75}

    # 1. Empty config
    res, branch = evaluate_condition_rule({}, context)
    assert res is True and branch == "true"

    # 2. Config structured directly as RuleGroup (not wrapped in "rule_group")
    direct_grp_config = {
        "logic": "AND",
        "clauses": [{"field": "status", "operator": "equals", "value": "ACTIVE"}],
    }
    res, branch = evaluate_condition_rule(direct_grp_config, context)
    assert res is True and branch == "true"

    # 3. Legacy "conditions" list with OR logic
    legacy_or = {
        "logic": "OR",
        "conditions": [
            {"field": "status", "operator": "equals", "value": "INACTIVE"},
            {"field": "score", "operator": "greater_than", "value": 70},
        ],
    }
    res, branch = evaluate_condition_rule(legacy_or, context)
    assert res is True and branch == "true"

    # 4. Empty legacy "conditions" list
    empty_legacy = {"logic": "AND", "conditions": []}
    res, branch = evaluate_condition_rule(empty_legacy, context)
    assert res is True and branch == "true"

    # 5. Legacy single-clause "field" at top-level
    single_clause = {"field": "status", "operator": "equals", "value": "ACTIVE"}
    res, branch = evaluate_condition_rule(single_clause, context)
    assert res is True and branch == "true"

    # 6. Default fallback for unrecognized non-empty dict
    fallback = {"unrecognized_key": "some_value"}
    res, branch = evaluate_condition_rule(fallback, context)
    assert res is True and branch == "true"


def test_string_relational_comparisons_and_or_subgroups():
    # String relational comparisons (type(actual) == type(expected))
    assert compare_values("zebra", "greater_than", "apple") is True
    assert compare_values("apple", "less_than", "zebra") is True
    assert compare_values("zebra", "greater_than_or_equal", "zebra") is True
    assert compare_values("apple", "less_than_or_equal", "apple") is True

    # OR group with matching subgroup
    context = {"role": "admin"}
    or_with_subgroup = {
        "logic": "OR",
        "clauses": [],
        "groups": [
            {"logic": "AND", "clauses": [{"field": "role", "operator": "equals", "value": "admin"}]}
        ],
    }
    assert evaluate_rule_group(or_with_subgroup, context) is True

    # OR group with failing subgroup
    or_failing_subgroup = {
        "logic": "OR",
        "clauses": [],
        "groups": [
            {"logic": "AND", "clauses": [{"field": "role", "operator": "equals", "value": "guest"}]}
        ],
    }
    assert evaluate_rule_group(or_failing_subgroup, context) is False

    # Config with enum logic and non-string logic
    cfg_enum = {
        "logic": LogicalOperator.OR,
        "conditions": [
            {"field": "role", "operator": "equals", "value": "admin"},
        ],
    }
    res, branch = evaluate_condition_rule(cfg_enum, context)
    assert res is True and branch == "true"

    cfg_other_logic = {
        "logic": 12345,  # fallback to 'AND'
        "conditions": [
            {"field": "role", "operator": "equals", "value": "admin"},
        ],
    }
    res, branch = evaluate_condition_rule(cfg_other_logic, context)
    assert res is True and branch == "true"
