"""Add status column to workflow_versions

Revision ID: 0002_add_workflow_version_status
Revises: 0001_initial_schema
Create Date: 2026-09-21 12:30:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '0002_add_workflow_version_status'
down_revision: Union[str, None] = '0001_initial_schema'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'workflow_versions',
        sa.Column('status', sa.String(length=50), server_default='DRAFT', nullable=False),
    )
    op.create_index(
        'ix_workflow_versions_status',
        'workflow_versions',
        ['status'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index('ix_workflow_versions_status', table_name='workflow_versions')
    op.drop_column('workflow_versions', 'status')
