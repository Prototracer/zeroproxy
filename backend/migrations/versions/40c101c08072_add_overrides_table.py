"""add_overrides_table

Revision ID: 40c101c08072
Revises: 7c8435660e31
Create Date: 2026-10-25 11:52:49.052182

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '40c101c08072'
down_revision: Union[str, Sequence[str], None] = '7c8435660e31'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'overrides',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('tenant_id', sa.Integer(), nullable=False),
        sa.Column('session_id', sa.Integer(), nullable=False),
        sa.Column('student_id', sa.Integer(), nullable=False),
        sa.Column('actor_id', sa.Integer(), nullable=False),
        sa.Column('reason', sa.String(length=50), nullable=False),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint(
            "reason IN ('hackathon', 'sports', 'medical', 'no_biometric_consent', 'other')",
            name='ck_overrides_reason',
        ),
        sa.ForeignKeyConstraint(['session_id'], ['attendance_sessions.id']),
        sa.ForeignKeyConstraint(['student_id'], ['users.id']),
        sa.ForeignKeyConstraint(['actor_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_overrides_id'), 'overrides', ['id'], unique=False)
    op.create_index(op.f('ix_overrides_session_id'), 'overrides', ['session_id'], unique=False)
    op.create_index(op.f('ix_overrides_student_id'), 'overrides', ['student_id'], unique=False)
    op.create_index(op.f('ix_overrides_actor_id'), 'overrides', ['actor_id'], unique=False)
    op.create_index(op.f('ix_overrides_tenant_id'), 'overrides', ['tenant_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_overrides_tenant_id'), table_name='overrides')
    op.drop_index(op.f('ix_overrides_actor_id'), table_name='overrides')
    op.drop_index(op.f('ix_overrides_student_id'), table_name='overrides')
    op.drop_index(op.f('ix_overrides_session_id'), table_name='overrides')
    op.drop_index(op.f('ix_overrides_id'), table_name='overrides')
    op.drop_table('overrides')
