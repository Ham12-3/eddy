"""M2 review fixes: keep safeguarding and erasure records, tighten account tables, retire rows

- safeguarding_event.student_id is RESTRICT, not CASCADE; reviewed_by and data_request.user_id
  are SET NULL, so deleting an account never silently removes these records.
- sessions keep a hash of the token, never the token; accounts drop the OAuth token columns.
- invite_code and parent_link get integrity checks.
- curriculum_node, topic, misconception and set_text get retired_at (ADR-0021).

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-05 12:30:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

RETIRABLE = ("curriculum_node", "topic", "misconception", "set_text")
PARENT_LINK_STATUS = (
    "(status <> 'REQUESTED' OR accepted_at IS NULL)"
    " AND (status <> 'ACTIVE' OR accepted_at IS NOT NULL)"
    " AND (status <> 'ENDED' OR (ended_at IS NOT NULL AND ended_by IS NOT NULL))"
)


def _replace_fk(table: str, column: str, ondelete: str | None) -> None:
    name = op.f(f"fk_{table}_{column}_users")
    op.drop_constraint(name, table, type_="foreignkey")
    op.create_foreign_key(name, table, "users", [column], ["id"], ondelete=ondelete)


def upgrade() -> None:
    _replace_fk("safeguarding_event", "student_id", "RESTRICT")
    _replace_fk("safeguarding_event", "reviewed_by", "SET NULL")
    _replace_fk("data_request", "user_id", "SET NULL")
    op.alter_column("data_request", "user_id", existing_type=sa.UUID(), nullable=True)

    op.drop_constraint(op.f("uq_sessions_session_token"), "sessions", type_="unique")
    op.alter_column(
        "sessions",
        "session_token",
        new_column_name="session_token_hash",
        type_=sa.String(length=64),
        existing_type=sa.String(length=255),
        existing_nullable=False,
    )
    op.create_unique_constraint(
        op.f("uq_sessions_session_token_hash"), "sessions", ["session_token_hash"]
    )
    for column in ("refresh_token", "access_token", "id_token"):
        op.drop_column("accounts", column)

    op.create_check_constraint(op.f("ck_invite_code_used_count"), "invite_code", "used_count >= 0")
    op.create_check_constraint(op.f("ck_invite_code_max_uses"), "invite_code", "max_uses >= 1")
    op.create_check_constraint(
        op.f("ck_parent_link_not_self"), "parent_link", "student_id <> parent_user_id"
    )
    op.create_check_constraint(
        op.f("ck_parent_link_status_timestamps"), "parent_link", PARENT_LINK_STATUS
    )

    for table in RETIRABLE:
        op.add_column(table, sa.Column("retired_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    for table in RETIRABLE:
        op.drop_column(table, "retired_at")

    op.drop_constraint(op.f("ck_parent_link_status_timestamps"), "parent_link", type_="check")
    op.drop_constraint(op.f("ck_parent_link_not_self"), "parent_link", type_="check")
    op.drop_constraint(op.f("ck_invite_code_max_uses"), "invite_code", type_="check")
    op.drop_constraint(op.f("ck_invite_code_used_count"), "invite_code", type_="check")

    for column in ("id_token", "access_token", "refresh_token"):
        op.add_column("accounts", sa.Column(column, sa.Text(), nullable=True))
    op.drop_constraint(op.f("uq_sessions_session_token_hash"), "sessions", type_="unique")
    op.alter_column(
        "sessions",
        "session_token_hash",
        new_column_name="session_token",
        type_=sa.String(length=255),
        existing_type=sa.String(length=64),
        existing_nullable=False,
    )
    op.create_unique_constraint(op.f("uq_sessions_session_token"), "sessions", ["session_token"])

    # Rows whose user was deleted cannot return to NOT NULL; they would block the downgrade.
    op.execute("DELETE FROM data_request WHERE user_id IS NULL")
    op.alter_column("data_request", "user_id", existing_type=sa.UUID(), nullable=False)
    _replace_fk("data_request", "user_id", "CASCADE")
    _replace_fk("safeguarding_event", "reviewed_by", None)
    _replace_fk("safeguarding_event", "student_id", "CASCADE")
