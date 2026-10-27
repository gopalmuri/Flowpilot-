"""Add conversations, inbound messages and integration public keys

Foundation for multi-channel inbound communication (portfolio form first).
Purely additive: new tables plus one nullable column.

Revision ID: 0004_inbound_messages
Revises: 0003_workflow_delete_cascades
Create Date: 2026-10-17 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '0004_inbound_messages'
down_revision: Union[str, None] = '0003_workflow_delete_cascades'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('integrations', sa.Column('public_key', sa.String(length=64), nullable=True))
    op.create_index('ix_integrations_public_key', 'integrations', ['public_key'], unique=True)

    op.create_table(
        'conversations',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization_id', sa.Uuid(), nullable=False),
        sa.Column('integration_id', sa.Uuid(), nullable=False),
        sa.Column('channel', sa.String(length=50), nullable=False),
        sa.Column('external_conversation_id', sa.String(length=255), nullable=False),
        sa.Column('sender_identity', sa.String(length=320), nullable=False),
        sa.Column('status', sa.String(length=30), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['integration_id'], ['integrations.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'organization_id', 'integration_id', 'channel', 'external_conversation_id',
            name='uq_conversation_external',
        ),
    )
    op.create_index('ix_conversations_organization_id', 'conversations', ['organization_id'])
    op.create_index('ix_conversations_integration_id', 'conversations', ['integration_id'])

    op.create_table(
        'inbound_messages',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization_id', sa.Uuid(), nullable=False),
        sa.Column('conversation_id', sa.Uuid(), nullable=False),
        sa.Column('integration_id', sa.Uuid(), nullable=False),
        sa.Column('channel', sa.String(length=50), nullable=False),
        sa.Column('external_message_id', sa.String(length=255), nullable=False),
        sa.Column('sender_name', sa.String(length=255), nullable=True),
        sa.Column('sender_address', sa.String(length=320), nullable=True),
        sa.Column('subject', sa.String(length=500), nullable=True),
        sa.Column('text_content', sa.Text(), nullable=False),
        sa.Column('received_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('processing_status', sa.String(length=30), nullable=False),
        sa.Column('workflow_run_id', sa.Uuid(), nullable=True),
        sa.Column('correlation_id', sa.String(length=64), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['integration_id'], ['integrations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['workflow_run_id'], ['workflow_runs.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'organization_id', 'channel', 'external_message_id',
            name='uq_inbound_message_external',
        ),
    )
    op.create_index('ix_inbound_messages_organization_id', 'inbound_messages', ['organization_id'])
    op.create_index('ix_inbound_messages_conversation_id', 'inbound_messages', ['conversation_id'])
    op.create_index('ix_inbound_messages_integration_id', 'inbound_messages', ['integration_id'])
    op.create_index('ix_inbound_messages_processing_status', 'inbound_messages', ['processing_status'])
    op.create_index('idx_inbound_messages_org_received', 'inbound_messages', ['organization_id', 'received_at'])


def downgrade() -> None:
    op.drop_table('inbound_messages')
    op.drop_table('conversations')
    op.drop_index('ix_integrations_public_key', table_name='integrations')
    op.drop_column('integrations', 'public_key')
