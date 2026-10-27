"""Reply draft approval: immutable versions, decision tracking, resume bookkeeping

Additive. Creates reply_draft_versions (insert-only, enforced by a trigger), adds approval/decision columns to
reply_drafts, adds resume_claimed_at/resume_completed_at to approval_requests, and backfills a version 1 for
every draft created in Phase 2.

Revision ID: 0006_draft_approval_versions
Revises: 0005_message_analysis_and_drafts
Create Date: 2026-10-17 18:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '0006_draft_approval_versions'
down_revision: Union[str, None] = '0005_message_analysis_and_drafts'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'reply_draft_versions',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization_id', sa.Uuid(), nullable=False),
        sa.Column('draft_id', sa.Uuid(), nullable=False),
        sa.Column('version_number', sa.Integer(), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('content_hash', sa.String(length=64), nullable=False),
        sa.Column('author_type', sa.String(length=10), nullable=False),
        sa.Column('author_user_id', sa.Uuid(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['draft_id'], ['reply_drafts.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['author_user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('draft_id', 'version_number', name='uq_reply_draft_version_number'),
    )
    op.create_index('ix_reply_draft_versions_organization_id', 'reply_draft_versions', ['organization_id'])
    op.create_index('ix_reply_draft_versions_draft_id', 'reply_draft_versions', ['draft_id'])

    op.add_column('reply_drafts', sa.Column('current_version_number', sa.Integer(), nullable=False, server_default='1'))
    op.add_column('reply_drafts', sa.Column('approved_version_number', sa.Integer(), nullable=True))
    op.add_column('reply_drafts', sa.Column('approval_request_id', sa.Uuid(), nullable=True))
    op.add_column('reply_drafts', sa.Column('decided_by', sa.Uuid(), nullable=True))
    op.add_column('reply_drafts', sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('reply_drafts', sa.Column('decision_comment', sa.Text(), nullable=True))
    op.add_column('reply_drafts', sa.Column('revision_instructions', sa.Text(), nullable=True))
    op.create_foreign_key(
        'fk_reply_drafts_approval_request', 'reply_drafts', 'approval_requests',
        ['approval_request_id'], ['id'], ondelete='SET NULL',
    )
    op.create_foreign_key('fk_reply_drafts_decided_by', 'reply_drafts', 'users', ['decided_by'], ['id'])
    op.create_index('ix_reply_drafts_approval_request_id', 'reply_drafts', ['approval_request_id'])
    op.alter_column('reply_drafts', 'current_version_number', server_default=None)

    op.add_column('approval_requests', sa.Column('resume_claimed_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('approval_requests', sa.Column('resume_completed_at', sa.DateTime(timezone=True), nullable=True))

    # Backfill: every Phase 2 draft becomes version 1 (AI-authored).
    op.execute(
        """
        INSERT INTO reply_draft_versions
            (id, organization_id, draft_id, version_number, content, content_hash, author_type, created_at)
        SELECT gen_random_uuid(), organization_id, id, 1, draft_content,
               encode(sha256(convert_to(draft_content, 'UTF8')), 'hex'), 'AI', created_at
        FROM reply_drafts
        """
    )

    # Versions are evidence of exactly what was approved: reject any UPDATE.
    op.execute(
        """
        CREATE FUNCTION reply_draft_versions_immutable() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'reply_draft_versions rows are immutable';
        END;
        $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_reply_draft_versions_immutable
        BEFORE UPDATE ON reply_draft_versions
        FOR EACH ROW EXECUTE FUNCTION reply_draft_versions_immutable()
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_reply_draft_versions_immutable ON reply_draft_versions")
    op.execute("DROP FUNCTION IF EXISTS reply_draft_versions_immutable()")
    op.drop_column('approval_requests', 'resume_completed_at')
    op.drop_column('approval_requests', 'resume_claimed_at')
    op.drop_index('ix_reply_drafts_approval_request_id', table_name='reply_drafts')
    op.drop_constraint('fk_reply_drafts_decided_by', 'reply_drafts', type_='foreignkey')
    op.drop_constraint('fk_reply_drafts_approval_request', 'reply_drafts', type_='foreignkey')
    for col in (
        'revision_instructions', 'decision_comment', 'decided_at', 'decided_by',
        'approval_request_id', 'approved_version_number', 'current_version_number',
    ):
        op.drop_column('reply_drafts', col)
    op.drop_table('reply_draft_versions')
