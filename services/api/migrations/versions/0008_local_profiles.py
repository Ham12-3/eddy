"""Desktop app: an optional PIN on a profile (ADR-0036)

- student_profile gains pin_hash. The desktop app has no email sign-in: students pick a profile
  on the computer, and a PIN keeps a brother or sister out of it. Only a salted scrypt hash is
  stored. The column stays empty everywhere else.
- pin_failed_tries and pin_locked_until count wrong PINs in a row and pause the profile after
  too many, so closing the app does not give a fresh set of guesses.

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-25 16:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("student_profile", sa.Column("pin_hash", sa.String(length=200), nullable=True))
    op.add_column(
        "student_profile",
        sa.Column("pin_failed_tries", sa.SmallInteger(), server_default="0", nullable=False),
    )
    op.add_column(
        "student_profile",
        sa.Column("pin_locked_until", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("student_profile", "pin_locked_until")
    op.drop_column("student_profile", "pin_failed_tries")
    op.drop_column("student_profile", "pin_hash")
