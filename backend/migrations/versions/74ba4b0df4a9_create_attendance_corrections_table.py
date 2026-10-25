"""create_attendance_corrections_table

Revision ID: 74ba4b0df4a9
Revises: 8bf0bc54f122
Create Date: 2026-10-25 19:09:43.311282

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '74ba4b0df4a9'
down_revision: Union[str, Sequence[str], None] = '8bf0bc54f122'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Create attendance_corrections table
    op.create_table(
        'attendance_corrections',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('tenant_id', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('session_id', sa.Integer(), sa.ForeignKey('attendance_sessions.id', ondelete='CASCADE'), nullable=False),
        sa.Column('student_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('faculty_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('reason', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("status IN ('present', 'absent')", name='ck_attendance_corrections_status'),
    )

    # 2. Create indices for fast lookup
    op.create_index('ix_attendance_corrections_tenant_id', 'attendance_corrections', ['tenant_id'])
    op.create_index('ix_attendance_corrections_session_id', 'attendance_corrections', ['session_id'])
    op.create_index('ix_attendance_corrections_student_id', 'attendance_corrections', ['student_id'])
    op.create_index(
        'ix_attendance_corrections_lookup',
        'attendance_corrections',
        ['session_id', 'student_id', 'id'],
    )

    # 3. Create database trigger to strictly enforce append-only behavior (preventing UPDATE/DELETE)
    op.execute("""
        CREATE OR REPLACE FUNCTION block_attendance_corrections_mod()
        RETURNS TRIGGER AS $$
        BEGIN
            RAISE EXCEPTION 'attendance_corrections is append-only: updates and deletes are prohibited';
        END;
        $$ LANGUAGE plpgsql;
    """)

    op.execute("""
        CREATE TRIGGER trg_block_attendance_corrections_mod
        BEFORE UPDATE OR DELETE ON attendance_corrections
        FOR EACH ROW EXECUTE FUNCTION block_attendance_corrections_mod();
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_block_attendance_corrections_mod ON attendance_corrections;")
    op.execute("DROP FUNCTION IF EXISTS block_attendance_corrections_mod();")
    op.drop_table('attendance_corrections')
