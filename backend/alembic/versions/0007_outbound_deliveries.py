"""Outbound delivery records (outbox + delivery state machine)

Additive: one new table. A delivery is unique per (draft, approved version), which is what makes "the same
approved text is consumed once" a database guarantee rather than an application convention.

Revision ID: 0007_outbound_deliveries
Revises: 0006_draft_approval_versions
Create Date: 2026-10-17 21:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '0007_outbound_deliveries'
down_revision: Union[str, None] = '0006_draft_approval_versions'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'outbound_deliveries',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization_id', sa.Uuid(), nullable=False),
        sa.Column('draft_id', sa.Uuid(), nullable=False),
        sa.Column('conversation_id', sa.Uuid(), nullable=False),
        sa.Column('integration_id', sa.Uuid(), nullable=True),
        sa.Column('approval_request_id', sa.Uuid(), nullable=True),
        sa.Column('workflow_run_id', sa.Uuid(), nullable=True),
        sa.Column('version_number', sa.Integer(), nullable=False),
        sa.Column('content_hash', sa.String(length=64), nullable=False),
        sa.Column('channel', sa.String(length=50), nullable=False),
        sa.Column('provider', sa.String(length=30), nullable=False),
        sa.Column('destination', sa.String(length=320), nullable=False),
        sa.Column('provider_context', sa.JSON(), nullable=False),
        sa.Column('idempotency_key', sa.String(length=255), nullable=False),
        sa.Column('status', sa.String(length=30), nullable=False),
        sa.Column('attempt_count', sa.Integer(), nullable=False),
        sa.Column('max_attempts', sa.Integer(), nullable=False),
        sa.Column('next_attempt_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('enqueued_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('claimed_by', sa.String(length=80), nullable=True),
        sa.Column('claimed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('lease_expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('consumed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('attempt_started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('provider_message_id', sa.String(length=255), nullable=True),
        sa.Column('resolution', sa.String(length=30), nullable=True),
        sa.Column('last_error_category', sa.String(length=30), nullable=True),
        sa.Column('last_error_code', sa.String(length=60), nullable=True),
        sa.Column('last_error_detail', sa.String(length=500), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['draft_id'], ['reply_drafts.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['integration_id'], ['integrations.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['approval_request_id'], ['approval_requests.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['workflow_run_id'], ['workflow_runs.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('draft_id', 'version_number', name='uq_outbound_delivery_draft_version'),
        sa.UniqueConstraint('organization_id', 'idempotency_key', name='uq_outbound_delivery_idempotency'),
    )
    op.create_index('ix_outbound_deliveries_organization_id', 'outbound_deliveries', ['organization_id'])
    op.create_index('ix_outbound_deliveries_draft_id', 'outbound_deliveries', ['draft_id'])
    op.create_index('ix_outbound_deliveries_status', 'outbound_deliveries', ['status'])
    op.create_index('idx_outbound_deliveries_dispatch', 'outbound_deliveries', ['status', 'next_attempt_at'])


def downgrade() -> None:
    op.drop_table('outbound_deliveries')
