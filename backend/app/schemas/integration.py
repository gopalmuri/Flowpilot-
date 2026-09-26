import enum
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class IntegrationType(str, enum.Enum):
    MOCK_CRM = "MOCK_CRM"
    SLACK = "SLACK"


class IntegrationStatus(str, enum.Enum):
    CONNECTED = "CONNECTED"
    DISCONNECTED = "DISCONNECTED"
    ERROR = "ERROR"


class IntegrationCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255, description="Human-readable integration name")
    type: IntegrationType = Field(..., description="Integration provider type")
    credentials: Dict[str, Any] = Field(default_factory=dict, description="Sensitive credentials to encrypt at rest")
    config: Dict[str, Any] = Field(default_factory=dict, description="Non-sensitive configuration settings")


class IntegrationUpdateRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    status: Optional[IntegrationStatus] = None
    credentials: Optional[Dict[str, Any]] = None
    clear_credentials: Optional[bool] = False
    config: Optional[Dict[str, Any]] = None


class IntegrationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    organization_id: uuid.UUID
    type: IntegrationType
    name: str
    status: IntegrationStatus
    has_credentials: bool = Field(..., description="Whether encrypted credentials are configured (no secret exposed)")
    config: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class IntegrationListResponse(BaseModel):
    items: List[IntegrationResponse]
    total: int


class IntegrationTestResponse(BaseModel):
    status: str = Field(..., description="'healthy' or 'error'")
    latency_ms: float = Field(..., description="Round-trip handshake latency in milliseconds")
    message: str = Field(..., description="Diagnostic summary or test message")
    tested_at: datetime = Field(..., description="Timestamp of handshake verification")
