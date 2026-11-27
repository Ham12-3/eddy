"""Desktop app: a progress summary a parent or carer can open on the same computer (ADR-0036)

- student_profile gains parent_view_on. The desktop app has no parent accounts and no email, so
  a student who wants a parent or carer to see their progress switches this on in Settings. The
  summary (topics secured, time spent, reviews due: never answers) can then be opened from the
  profile picker without the profile's PIN. Off unless the student turns it on, and unused
  everywhere else.

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-27 09:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "student_profile",
        sa.Column("parent_view_on", sa.Boolean(), server_default=sa.false(), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("student_profile", "parent_view_on")
