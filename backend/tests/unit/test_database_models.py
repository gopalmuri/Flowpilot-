import uuid
from datetime import datetime, timezone
import pytest
from sqlalchemy import create_engine
from app.core.database import Base
from app.models import (
    User,
    Organization,
    OrganizationMember,
    Integration,
    Workflow,
    WorkflowVersion,
    WorkflowStep,
    WorkflowConnection,
    WorkflowRun,
    WorkflowStepRun,
    ApprovalRequest,
    AuditLog,
    UsageRecord,
    IdempotencyRecord,
)

EXPECTED_TABLES = [
    "approval_requests",
    "audit_logs",
    "idempotency_records",
    "integrations",
    "organization_members",
    "organizations",
    "usage_records",
    "users",
    "workflow_connections",
    "workflow_runs",
    "workflow_step_runs",
    "workflow_steps",
    "workflow_versions",
    "workflows",
]

TENANT_TABLES = [
    "approval_requests",
    "audit_logs",
    "idempotency_records",
    "integrations",
    "organization_members",
    "usage_records",
    "workflow_runs",
    "workflows",
]


def test_all_14_tables_registered():
    """Verify that all 14 required tables are registered in Base metadata."""
    tables = sorted(list(Base.metadata.tables.keys()))
    assert len(tables) == 14
    assert tables == EXPECTED_TABLES


def test_tenant_tables_have_organization_id():
    """Verify that every tenant-owned table contains organization_id."""
    for table_name in TENANT_TABLES:
        table = Base.metadata.tables[table_name]
        assert "organization_id" in table.columns, f"{table_name} missing organization_id"
        col = table.columns["organization_id"]
        assert col.nullable is False, f"{table_name}.organization_id must be non-nullable"


def test_all_tables_have_uuid_primary_key():
    """Verify that all 14 tables have an 'id' primary key."""
    for table_name in EXPECTED_TABLES:
        table = Base.metadata.tables[table_name]
        assert "id" in table.columns, f"{table_name} missing id column"
        assert table.columns["id"].primary_key is True, f"{table_name}.id must be primary key"


def test_metadata_creates_tables_in_memory():
    """Verify that SQLAlchemy can create all 14 tables without circular or syntax errors."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    
    with engine.connect() as conn:
        from sqlalchemy import inspect
        inspector = inspect(conn)
        created_tables = sorted(inspector.get_table_names())
        assert len(created_tables) == 14
        assert created_tables == EXPECTED_TABLES
    
    engine.dispose()
