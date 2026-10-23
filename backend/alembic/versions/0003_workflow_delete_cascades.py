"""Let workflow deletion cascade through runs, approvals and usage

Deleting a workflow failed with a foreign-key violation (HTTP 500) once it had
runs, approvals or usage records, because these FKs had no ON DELETE rule.

Revision ID: 0003_workflow_delete_cascades
Revises: 0002_add_workflow_version_status
Create Date: 2026-10-16 21:30:00.000000

"""
from typing import Sequence, Union
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '0003_workflow_delete_cascades'
down_revision: Union[str, None] = '0002_add_workflow_version_status'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (table, column, referred table, constraint name, ON DELETE rule after upgrade)
FOREIGN_KEYS = [
    ('workflow_runs', 'workflow_version_id', 'workflow_versions', 'workflow_runs_workflow_version_id_fkey', 'CASCADE'),
    ('workflow_step_runs', 'step_id', 'workflow_steps', 'workflow_step_runs_step_id_fkey', 'CASCADE'),
    ('approval_requests', 'step_id', 'workflow_steps', 'approval_requests_step_id_fkey', 'CASCADE'),
    ('idempotency_records', 'workflow_run_id', 'workflow_runs', 'idempotency_records_workflow_run_id_fkey', 'CASCADE'),
    ('usage_records', 'workflow_id', 'workflows', 'usage_records_workflow_id_fkey', 'SET NULL'),
]


def _recreate(ondelete_for) -> None:
    for table, column, referred, name, rule in FOREIGN_KEYS:
        op.drop_constraint(name, table, type_='foreignkey')
        op.create_foreign_key(name, table, referred, [column], ['id'], ondelete=ondelete_for(rule))


def upgrade() -> None:
    _recreate(lambda rule: rule)


def downgrade() -> None:
    _recreate(lambda rule: None)
