from enum import Enum
from typing import Any, Dict, List, Optional, Set
from pydantic import BaseModel, ConfigDict, Field, field_validator


class LeadCategory(str, Enum):
    ENTERPRISE = "enterprise"
    MID_MARKET = "mid_market"
    SMB = "smb"
    SALES = "sales"
    SUPPORT = "support"
    BILLING = "billing"
    TECHNICAL = "technical"
    URGENT = "urgent"
    INQUIRY = "inquiry"
    STANDARD = "standard"
    LOW = "low"
    SPAM = "spam"
    GENERAL = "general"


ALLOWED_LEAD_CATEGORIES: Set[str] = {c.value for c in LeadCategory}

ALLOWED_PRIORITIES: Set[str] = {"low", "medium", "high", "urgent"}


class LeadClassificationInput(BaseModel):
    model_config = ConfigDict(extra="ignore")

    text: str = Field(..., min_length=1, description="Lead body, message, or prompt text to classify")
    categories: List[str] = Field(
        default_factory=lambda: [
            "enterprise",
            "mid_market",
            "smb",
            "sales",
            "support",
            "billing",
            "technical",
            "urgent",
            "inquiry",
            "general",
        ],
        description="Candidate categories to evaluate",
    )
    context: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Optional upstream context or metadata",
    )

    @field_validator("categories")
    @classmethod
    def validate_categories(cls, v: List[str]) -> List[str]:
        if not v:
            raise ValueError("Candidate categories list cannot be empty")
        normalized: List[str] = []
        for cat in v:
            clean = cat.strip().lower()
            if not clean:
                continue
            if clean not in ALLOWED_LEAD_CATEGORIES:
                raise ValueError(
                    f"Unknown candidate category '{cat}'. Allowed categories: {sorted(ALLOWED_LEAD_CATEGORIES)}"
                )
            if clean not in normalized:
                normalized.append(clean)
        if not normalized:
            raise ValueError("No valid categories provided")
        return normalized


class LeadClassificationResult(BaseModel):
    model_config = ConfigDict(extra="ignore")

    category: str = Field(..., description="Chosen classification category")
    priority: str = Field(default="medium", description="Suggested lead priority: low, medium, high, urgent")
    confidence: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Confidence score strictly between 0.0 and 1.0 (clamping forbidden)",
    )
    reasoning: str = Field(
        ...,
        min_length=1,
        max_length=2000,
        description="Application-facing concise explanation of classification (no private chain-of-thought)",
    )
    suggested_action: Optional[str] = Field(
        default=None,
        description="Suggested next action for workflow condition logic",
    )
    tokens_used: int = Field(default=0, ge=0, description="Total tokens consumed")
    prompt_tokens: int = Field(default=0, ge=0, description="Prompt tokens consumed")
    completion_tokens: int = Field(default=0, ge=0, description="Completion tokens consumed")
    provider: str = Field(..., min_length=1, description="Provider used (e.g. mock, openai, anthropic, fallback)")
    model: str = Field(..., min_length=1, description="Model identifier")
    latency_ms: int = Field(default=0, ge=0, description="Call latency in milliseconds")
    is_fallback: bool = Field(default=False, description="True if produced by deterministic fallback classifier")
    fallback_reason: Optional[str] = Field(default=None, description="Explicit failure reason if fallback was invoked")

    @field_validator("category")
    @classmethod
    def validate_category(cls, v: str) -> str:
        clean = v.strip().lower()
        if clean not in ALLOWED_LEAD_CATEGORIES:
            raise ValueError(
                f"Unknown category '{v}'. Allowed categories are: {sorted(ALLOWED_LEAD_CATEGORIES)}"
            )
        return clean

    @field_validator("priority")
    @classmethod
    def validate_priority(cls, v: str) -> str:
        clean = v.strip().lower()
        if clean not in ALLOWED_PRIORITIES:
            raise ValueError(
                f"Unknown priority '{v}'. Allowed priorities are: {sorted(ALLOWED_PRIORITIES)}"
            )
        return clean


class AIProviderConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: str = Field(default="mock", description="AI provider name")
    model: Optional[str] = Field(default=None, description="Target model name")
    temperature: float = Field(default=0.0, ge=0.0, le=2.0, description="Sampling temperature")
    max_tokens: int = Field(default=500, gt=0, description="Maximum token generation limit")
    timeout_seconds: float = Field(default=10.0, gt=0.0, description="Request timeout in seconds")
    # Strict Zero-Secret-Exposure: api_key is excluded from serialization and string repr
    api_key: Optional[str] = Field(default=None, repr=False, exclude=True)
