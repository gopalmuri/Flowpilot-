"""Gmail integration: mailbox state, OAuth states, inbound message provider metadata

Additive: two new tables plus one nullable column. `gmail_accounts.email_address` is unique among CONNECTED accounts
(partial unique index) so a Pub/Sub notification, which only names a mailbox, maps to exactly one organization.

Revision ID: 0008_gmail_integration
Revises: 0007_outbound_deliveries
Create Date: 2026-10-17 23:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '0008_gmail_integration'
down_revision: Union[str, None] = '0007_outbound_deliveries'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('inbound_messages', sa.Column('provider_metadata', sa.JSON(), nullable=True))

    op.create_table(
        'gmail_accounts',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization_id', sa.Uuid(), nullable=False),
        sa.Column('integration_id', sa.Uuid(), nullable=False),
        sa.Column('email_address', sa.String(length=320), nullable=False),
        sa.Column('granted_scopes', sa.JSON(), nullable=False),
        sa.Column('connected_by', sa.Uuid(), nullable=True),
        sa.Column('connected_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('disconnected_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('history_id', sa.String(length=32), nullable=True),
        sa.Column('sync_state', sa.String(length=30), nullable=False),
        sa.Column('sync_requested_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_notification_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_sync_started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_sync_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_sync_error', sa.String(length=200), nullable=True),
        sa.Column('consecutive_failures', sa.Integer(), nullable=False),
        sa.Column('sync_lease_owner', sa.String(length=80), nullable=True),
        sa.Column('sync_lease_expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('watch_status', sa.String(length=30), nullable=False),
        sa.Column('watch_expiration', sa.DateTime(timezone=True), nullable=True),
        sa.Column('watch_registered_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('watch_error', sa.String(length=200), nullable=True),
        sa.Column('watch_lease_until', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['integration_id'], ['integrations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['connected_by'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('integration_id'),
    )
    op.create_index('ix_gmail_accounts_organization_id', 'gmail_accounts', ['organization_id'])
    op.create_index(
        'uq_gmail_accounts_active_email',
        'gmail_accounts',
        ['email_address'],
        unique=True,
        postgresql_where=sa.text('disconnected_at IS NULL'),
    )
    op.create_index('idx_gmail_accounts_sync', 'gmail_accounts', ['sync_requested_at', 'last_sync_at'])

    op.create_table(
        'oauth_states',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization_id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('integration_id', sa.Uuid(), nullable=True),
        sa.Column('purpose', sa.String(length=30), nullable=False),
        sa.Column('state_hash', sa.String(length=64), nullable=False),
        sa.Column('nonce_hash', sa.String(length=64), nullable=False),
        sa.Column('code_verifier_encrypted', sa.LargeBinary(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('consumed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('failure_reason', sa.Text(), nullable=True),
        sa.Column('extra', sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['integration_id'], ['integrations.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('state_hash'),
    )
    op.create_index('ix_oauth_states_organization_id', 'oauth_states', ['organization_id'])


def downgrade() -> None:
    op.drop_table('oauth_states')
    op.drop_table('gmail_accounts')
    op.drop_column('inbound_messages', 'provider_metadata')
