"""Initial schema for FlowPilot 14 tables

Revision ID: 0001_initial_schema
Revises: 
Create Date: 2026-09-20 12:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '0001_initial_schema'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. users table
    op.create_table(
        'users',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('password_hash', sa.String(length=255), nullable=False),
        sa.Column('full_name', sa.String(length=255), nullable=False),
        sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
        sa.Column('is_superuser', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('email')
    )
    op.create_index('ix_users_email', 'users', ['email'])

    # 2. organizations table
    op.create_table(
        'organizations',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('slug', sa.String(length=255), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('slug')
    )
    op.create_index('ix_organizations_slug', 'organizations', ['slug'])

    # 3. organization_members table
    op.create_table(
        'organization_members',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization_id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('role', sa.String(length=50), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization_id', 'user_id', name='uq_org_member')
    )
    op.create_index('ix_organization_members_org', 'organization_members', ['organization_id'])
    op.create_index('ix_organization_members_user', 'organization_members', ['user_id'])

    # 4. integrations table
    op.create_table(
        'integrations',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization_id', sa.Uuid(), nullable=False),
        sa.Column('type', sa.String(length=50), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('status', sa.String(length=50), server_default='CONNECTED', nullable=False),
        sa.Column('credentials_encrypted', sa.LargeBinary(), nullable=True),
        sa.Column('config', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_integrations_org', 'integrations', ['organization_id'])
    op.create_index('ix_integrations_type', 'integrations', ['type'])

    # 5. workflows table
    op.create_table(
        'workflows',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization_id', sa.Uuid(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('status', sa.String(length=50), server_default='DRAFT', nullable=False),
        sa.Column('active_version_id', sa.Uuid(), nullable=True),
        sa.Column('webhook_key', sa.String(length=64), nullable=True),
        sa.Column('created_by', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['created_by'], ['users.id']),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('webhook_key')
    )
    op.create_index('ix_workflows_org', 'workflows', ['organization_id'])
    op.create_index('ix_workflows_status', 'workflows', ['status'])
    op.create_index('ix_workflows_webhook_key', 'workflows', ['webhook_key'])
    op.create_index('idx_workflows_org_status', 'workflows', ['organization_id', 'status'])

    # 6. workflow_versions table
    op.create_table(
        'workflow_versions',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('workflow_id', sa.Uuid(), nullable=False),
        sa.Column('version_number', sa.Integer(), nullable=False),
        sa.Column('definition', sa.JSON(), nullable=False),
        sa.Column('created_by', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['created_by'], ['users.id']),
        sa.ForeignKeyConstraint(['workflow_id'], ['workflows.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('workflow_id', 'version_number', name='uq_workflow_version')
    )
    op.create_index('ix_workflow_versions_workflow_id', 'workflow_versions', ['workflow_id'])

    # 7. workflow_steps table
    op.create_table(
        'workflow_steps',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('workflow_version_id', sa.Uuid(), nullable=False),
        sa.Column('step_key', sa.String(length=100), nullable=False),
        sa.Column('step_type', sa.String(length=50), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('config', sa.JSON(), nullable=False),
        sa.Column('ui_position', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['workflow_version_id'], ['workflow_versions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_workflow_steps_version_id', 'workflow_steps', ['workflow_version_id'])
    op.create_index('ix_workflow_steps_step_type', 'workflow_steps', ['step_type'])

    # 8. workflow_connections table
    op.create_table(
        'workflow_connections',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('workflow_version_id', sa.Uuid(), nullable=False),
        sa.Column('source_step_id', sa.Uuid(), nullable=False),
        sa.Column('target_step_id', sa.Uuid(), nullable=False),
        sa.Column('condition_label', sa.String(length=100), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['source_step_id'], ['workflow_steps.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['target_step_id'], ['workflow_steps.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['workflow_version_id'], ['workflow_versions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_workflow_connections_version', 'workflow_connections', ['workflow_version_id'])

    # 9. workflow_runs table
    op.create_table(
        'workflow_runs',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization_id', sa.Uuid(), nullable=False),
        sa.Column('workflow_id', sa.Uuid(), nullable=False),
        sa.Column('workflow_version_id', sa.Uuid(), nullable=False),
        sa.Column('status', sa.String(length=50), server_default='PENDING', nullable=False),
        sa.Column('trigger_type', sa.String(length=50), server_default='WEBHOOK', nullable=False),
        sa.Column('trigger_payload', sa.JSON(), nullable=False),
        sa.Column('correlation_id', sa.String(length=100), nullable=False),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['workflow_id'], ['workflows.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['workflow_version_id'], ['workflow_versions.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_workflow_runs_org', 'workflow_runs', ['organization_id'])
    op.create_index('ix_workflow_runs_workflow', 'workflow_runs', ['workflow_id'])
    op.create_index('ix_workflow_runs_status', 'workflow_runs', ['status'])
    op.create_index('idx_workflow_runs_org_status', 'workflow_runs', ['organization_id', 'status', 'started_at'])
    op.create_index('idx_workflow_runs_correlation', 'workflow_runs', ['correlation_id'])

    # 10. workflow_step_runs table
    op.create_table(
        'workflow_step_runs',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('workflow_run_id', sa.Uuid(), nullable=False),
        sa.Column('step_id', sa.Uuid(), nullable=False),
        sa.Column('status', sa.String(length=50), server_default='RUNNING', nullable=False),
        sa.Column('input_data', sa.JSON(), nullable=False),
        sa.Column('output_data', sa.JSON(), nullable=False),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('execution_time_ms', sa.Integer(), server_default='0', nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['step_id'], ['workflow_steps.id']),
        sa.ForeignKeyConstraint(['workflow_run_id'], ['workflow_runs.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_workflow_step_runs_run', 'workflow_step_runs', ['workflow_run_id'])
    op.create_index('ix_workflow_step_runs_step', 'workflow_step_runs', ['step_id'])

    # 11. approval_requests table
    op.create_table(
        'approval_requests',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization_id', sa.Uuid(), nullable=False),
        sa.Column('workflow_run_id', sa.Uuid(), nullable=False),
        sa.Column('step_id', sa.Uuid(), nullable=False),
        sa.Column('status', sa.String(length=50), server_default='PENDING', nullable=False),
        sa.Column('payload_snapshot', sa.JSON(), nullable=False),
        sa.Column('reviewed_by', sa.Uuid(), nullable=True),
        sa.Column('comment', sa.Text(), nullable=True),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['reviewed_by'], ['users.id']),
        sa.ForeignKeyConstraint(['step_id'], ['workflow_steps.id']),
        sa.ForeignKeyConstraint(['workflow_run_id'], ['workflow_runs.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_approval_requests_org', 'approval_requests', ['organization_id'])
    op.create_index('ix_approval_requests_run', 'approval_requests', ['workflow_run_id'])
    op.create_index('ix_approval_requests_status', 'approval_requests', ['status'])
    op.create_index('idx_approval_requests_org_status', 'approval_requests', ['organization_id', 'status'])

    # 12. audit_logs table
    op.create_table(
        'audit_logs',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization_id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=True),
        sa.Column('action', sa.String(length=100), nullable=False),
        sa.Column('resource_type', sa.String(length=50), nullable=False),
        sa.Column('resource_id', sa.String(length=100), nullable=False),
        sa.Column('details', sa.JSON(), nullable=False),
        sa.Column('ip_address', sa.String(length=45), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_audit_logs_org', 'audit_logs', ['organization_id'])
    op.create_index('ix_audit_logs_action', 'audit_logs', ['action'])
    op.create_index('idx_audit_logs_org_created', 'audit_logs', ['organization_id', 'created_at'])

    # 13. usage_records table
    op.create_table(
        'usage_records',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization_id', sa.Uuid(), nullable=False),
        sa.Column('metric_type', sa.String(length=50), nullable=False),
        sa.Column('quantity', sa.BigInteger(), server_default='1', nullable=False),
        sa.Column('workflow_id', sa.Uuid(), nullable=True),
        sa.Column('recorded_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['workflow_id'], ['workflows.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_usage_records_org', 'usage_records', ['organization_id'])
    op.create_index('ix_usage_records_metric', 'usage_records', ['metric_type'])
    op.create_index('idx_usage_records_org_metric', 'usage_records', ['organization_id', 'metric_type', 'recorded_at'])

    # 14. idempotency_records table
    op.create_table(
        'idempotency_records',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization_id', sa.Uuid(), nullable=False),
        sa.Column('idempotency_key', sa.String(length=255), nullable=False),
        sa.Column('workflow_run_id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['workflow_run_id'], ['workflow_runs.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization_id', 'idempotency_key', name='uq_org_idempotency_key')
    )
    op.create_index('ix_idempotency_records_org', 'idempotency_records', ['organization_id'])
    op.create_index('idx_idempotency_lookup', 'idempotency_records', ['organization_id', 'idempotency_key'])


def downgrade() -> None:
    op.drop_table('idempotency_records')
    op.drop_table('usage_records')
    op.drop_table('audit_logs')
    op.drop_table('approval_requests')
    op.drop_table('workflow_step_runs')
    op.drop_table('workflow_runs')
    op.drop_table('workflow_connections')
    op.drop_table('workflow_steps')
    op.drop_table('workflow_versions')
    op.drop_table('workflows')
    op.drop_table('integrations')
    op.drop_table('organization_members')
    op.drop_table('organizations')
    op.drop_table('users')
