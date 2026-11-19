"""M9 parents: link codes, and parent sign-up through a child's code (ADR-0033)

- parent_link_code: a code a student gives a parent (a link, or typed in). Only its SHA-256
  hash is stored; it lasts 7 days, works once, and a new one replaces the old.
- pending_signup gains a role. A student's needs an invite and an age check, as before; a
  parent's needs a live link code instead and holds no birth date.

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-12 15:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "parent_link_code",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("student_id", sa.UUID(), nullable=False),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["student_id"],
            ["users.id"],
            name=op.f("fk_parent_link_code_student_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_parent_link_code")),
        sa.UniqueConstraint("code_hash", name=op.f("uq_parent_link_code_code_hash")),
        sa.UniqueConstraint("student_id", name=op.f("uq_parent_link_code_student_id")),
    )
    op.add_column(
        "pending_signup",
        sa.Column(
            "role",
            sa.Enum(
                "student",
                "parent",
                name="pending_role",
                native_enum=False,
                create_constraint=True,
                length=32,
            ),
            server_default="student",
            nullable=False,
        ),
    )
    op.add_column("pending_signup", sa.Column("link_code_id", sa.UUID(), nullable=True))
    op.create_foreign_key(
        op.f("fk_pending_signup_link_code_id_parent_link_code"),
        "pending_signup",
        "parent_link_code",
        ["link_code_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(op.f("ix_pending_signup_link_code_id"), "pending_signup", ["link_code_id"])
    op.alter_column(
        "pending_signup", "invite_code", existing_type=sa.String(length=32), nullable=True
    )
    op.alter_column("pending_signup", "birth_year", existing_type=sa.SmallInteger(), nullable=True)
    op.alter_column("pending_signup", "birth_month", existing_type=sa.SmallInteger(), nullable=True)
    op.create_check_constraint(
        op.f("ck_pending_signup_role_needs"),
        "pending_signup",
        "(role = 'student' AND invite_code IS NOT NULL AND birth_year IS NOT NULL"
        " AND birth_month IS NOT NULL)"
        " OR (role = 'parent' AND link_code_id IS NOT NULL)",
    )


def downgrade() -> None:
    op.execute("DELETE FROM pending_signup WHERE role = 'parent'")
    op.drop_constraint(op.f("ck_pending_signup_role_needs"), "pending_signup", type_="check")
    op.alter_column(
        "pending_signup", "birth_month", existing_type=sa.SmallInteger(), nullable=False
    )
    op.alter_column("pending_signup", "birth_year", existing_type=sa.SmallInteger(), nullable=False)
    op.alter_column(
        "pending_signup", "invite_code", existing_type=sa.String(length=32), nullable=False
    )
    op.drop_index(op.f("ix_pending_signup_link_code_id"), table_name="pending_signup")
    op.drop_constraint(
        op.f("fk_pending_signup_link_code_id_parent_link_code"),
        "pending_signup",
        type_="foreignkey",
    )
    op.drop_column("pending_signup", "link_code_id")
    op.drop_column("pending_signup", "role")
    op.drop_table("parent_link_code")
