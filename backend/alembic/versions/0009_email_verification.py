"""Add email verification and user is_verified flag

Revision ID: 0009_email_verification
Revises: 0008_gmail_integration
Create Date: 2026-10-20 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '0009_email_verification'
down_revision: Union[str, None] = '0008_gmail_integration'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add is_verified to users
    op.add_column(
        'users',
        sa.Column('is_verified', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    )

    # 2. Create email_verifications table
    op.create_table(
        'email_verifications',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('otp_hash', sa.String(length=255), nullable=False),
        sa.Column('attempts', sa.Integer(), server_default='0', nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_email_verifications_email'), 'email_verifications', ['email'], unique=False)
    op.create_index(op.f('ix_email_verifications_user_id'), 'email_verifications', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_email_verifications_user_id'), table_name='email_verifications')
    op.drop_index(op.f('ix_email_verifications_email'), table_name='email_verifications')
    op.drop_table('email_verifications')
    op.drop_column('users', 'is_verified')
