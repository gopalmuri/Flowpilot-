"""Persist AI message analysis and reply drafts

Adds the analysis columns on inbound_messages and the reply_drafts table. Additive only.
Drafts are review-only in this revision; approval and send tracking come later.

Revision ID: 0005_message_analysis_and_drafts
Revises: 0004_inbound_messages
Create Date: 2026-10-17 15:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '0005_message_analysis_and_drafts'
down_revision: Union[str, None] = '0004_inbound_messages'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('inbound_messages', sa.Column('ai_analysis', sa.JSON(), nullable=True))
    op.add_column('inbound_messages', sa.Column('analyzed_at', sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        'reply_drafts',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization_id', sa.Uuid(), nullable=False),
        sa.Column('conversation_id', sa.Uuid(), nullable=False),
        sa.Column('source_message_id', sa.Uuid(), nullable=False),
        sa.Column('draft_content', sa.Text(), nullable=False),
        sa.Column('status', sa.String(length=30), nullable=False),
        sa.Column('generated_by', sa.String(length=120), nullable=False),
        sa.Column('risk_flags', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['source_message_id'], ['inbound_messages.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('source_message_id', name='uq_reply_draft_source_message'),
    )
    op.create_index('ix_reply_drafts_organization_id', 'reply_drafts', ['organization_id'])
    op.create_index('ix_reply_drafts_conversation_id', 'reply_drafts', ['conversation_id'])
    op.create_index('ix_reply_drafts_status', 'reply_drafts', ['status'])


def downgrade() -> None:
    op.drop_table('reply_drafts')
    op.drop_column('inbound_messages', 'analyzed_at')
    op.drop_column('inbound_messages', 'ai_analysis')
