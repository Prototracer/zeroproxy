"""enforce_case_insensitive_unique_roll_no

Revision ID: cefde025f20b
Revises: 40c101c08072
Create Date: 2026-10-25 16:20:35.105232

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'cefde025f20b'
down_revision: Union[str, Sequence[str], None] = '40c101c08072'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Enforce NOT NULL on users.roll_no
    op.alter_column('users', 'roll_no', existing_type=sa.String(length=50), nullable=False)

    # 2. Drop existing case-sensitive unique constraint
    op.drop_constraint('users_roll_no_key', 'users', type_='unique')

    # 3. Create case-insensitive functional unique index on LOWER(roll_no)
    op.create_index(
        'uq_users_roll_no_lower',
        'users',
        [sa.text('lower(roll_no)')],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index('uq_users_roll_no_lower', table_name='users')
    op.create_unique_constraint('users_roll_no_key', 'users', ['roll_no'])
