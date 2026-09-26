from enum import Enum
from typing import Any, List, Optional
from pydantic import BaseModel, ConfigDict, Field, model_validator


class ConditionOperator(str, Enum):
    EQUALS = "equals"
    NOT_EQUALS = "not_equals"
    GREATER_THAN = "greater_than"
    GREATER_THAN_OR_EQUAL = "greater_than_or_equal"
    LESS_THAN = "less_than"
    LESS_THAN_OR_EQUAL = "less_than_or_equal"
    CONTAINS = "contains"
    NOT_CONTAINS = "not_contains"
    IN = "in"
    NOT_IN = "not_in"
    EXISTS = "exists"
    NOT_EXISTS = "not_exists"
    IS_NULL = "is_null"
    IS_NOT_NULL = "is_not_null"
    IS_EMPTY = "is_empty"
    IS_NOT_EMPTY = "is_not_empty"


class LogicalOperator(str, Enum):
    AND = "AND"
    OR = "OR"
    NOT = "NOT"


class ConditionClause(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: str = Field(..., min_length=1, description="Context path, e.g. 'category' or 'trigger.amount'")
    operator: ConditionOperator = Field(..., description="Canonical comparison operator")
    value: Optional[Any] = Field(None, description="Expected value for comparison (ignored for exists/is_null/is_empty)")


class RuleGroup(BaseModel):
    model_config = ConfigDict(extra="forbid")

    logic: LogicalOperator = Field(default=LogicalOperator.AND)
    clauses: List[ConditionClause] = Field(default_factory=list)
    groups: List["RuleGroup"] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_group_structure(self) -> "RuleGroup":
        total_children = len(self.clauses) + len(self.groups)
        if self.logic == LogicalOperator.NOT:
            # Enforce NOT group invariant: exactly one child
            if total_children != 1:
                raise ValueError(
                    f"A 'NOT' rule group must have exactly 1 child (clause or sub-group), found {total_children}"
                )
        else:
            if total_children == 0:
                raise ValueError(f"'{self.logic}' rule group must have at least 1 child clause or sub-group")
        return self


class ConditionStepConfig(BaseModel):
    model_config = ConfigDict(extra="allow")

    # Simple single-clause configuration (backward compatible)
    field: Optional[str] = None
    operator: Optional[ConditionOperator] = None
    value: Optional[Any] = None

    # Flat conditions list configuration (backward compatible)
    logic: Optional[LogicalOperator] = None
    conditions: Optional[List[ConditionClause]] = None

    # Advanced nested rule group configuration
    rule_group: Optional[RuleGroup] = None
