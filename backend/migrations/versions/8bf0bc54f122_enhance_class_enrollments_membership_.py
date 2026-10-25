"""enhance_class_enrollments_membership_history

Revision ID: 8bf0bc54f122
Revises: cefde025f20b
Create Date: 2026-10-25 17:17:16.859568

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8bf0bc54f122'
down_revision: Union[str, Sequence[str], None] = 'cefde025f20b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add membership tracking columns
    op.add_column(
        'class_enrollments',
        sa.Column('left_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        'class_enrollments',
        sa.Column('ended_by', sa.String(length=50), nullable=True),
    )
    op.add_column(
        'class_enrollments',
        sa.Column('reason', sa.Text(), nullable=True),
    )

    # 2. Drop unconditional unique constraint to allow historical records
    op.drop_constraint('uq_class_enrollment_student_course', 'class_enrollments', type_='unique')

    # 3. Create partial unique index enforcing at most one active enrollment per student per class
    op.create_index(
        'uq_class_enrollments_active_student_course',
        'class_enrollments',
        ['tenant_id', 'course_id', 'student_id'],
        unique=True,
        postgresql_where=sa.text('active IS TRUE'),
    )


def downgrade() -> None:
    # 1. Drop partial index
    op.drop_index(
        'uq_class_enrollments_active_student_course',
        table_name='class_enrollments',
        postgresql_where=sa.text('active IS TRUE'),
    )

    # 2. Restore unconditional unique constraint
    op.create_unique_constraint(
        'uq_class_enrollment_student_course',
        'class_enrollments',
        ['tenant_id', 'course_id', 'student_id'],
    )

    # 3. Drop columns
    op.drop_column('class_enrollments', 'reason')
    op.drop_column('class_enrollments', 'ended_by')
    op.drop_column('class_enrollments', 'left_at')
