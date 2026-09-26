import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, ConfigDict


class WebhookResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    workflow_run_id: uuid.UUID
    workflow_id: uuid.UUID
    status: str
    idempotent: bool
    correlation_id: str
    created_at: datetime
    execution_summary: Optional[Dict[str, Any]] = None


class WebhookDetailsResponse(BaseModel):
    """
    Webhook inspection response.
    STRICT ZERO-SECRET POLICY: Neither secret_token nor secret_preview
    is ever returned. Only boolean has_secret_token is exposed.
    """
    model_config = ConfigDict(from_attributes=True)

    webhook_url: str
    webhook_key: str
    allowed_methods: List[str] = Field(default_factory=lambda: ["POST"])
    has_secret_token: bool
    is_active: bool


class WebhookKeyRotateResponse(BaseModel):
    """
    Response returned upon rotating the public webhook key.
    Secrets are never included.
    """
    model_config = ConfigDict(from_attributes=True)

    webhook_key: str
    webhook_url: str
    rotated_at: datetime
