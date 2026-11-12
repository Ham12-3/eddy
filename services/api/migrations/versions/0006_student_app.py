"""M8 student app: a runtime role, sign-up, set-up, the diagnostic and concerns

- pending_signup: someone who passed the age check and asked for a sign-up link. Deleted when
  the account is made, or by the purge job when it expires (ADR-0032). Nothing is ever stored
  for anyone under 13.
- invite_redemption: which invite an account came in by.
- student_profile: board, tier and target grade wait for set-up (`setup_completed_at`); the
  diagnostic's end is recorded too; a profile never names the DfE content as its board.
- diagnostic_session: the onboarding diagnostic, which can stop and resume.
- concern_report: "Report a concern", kept like a safeguarding event when an account goes.
- The runtime role `eddy_app` (ADR-0024): the API and worker connect as it. It may read and
  change every table except `audit_log`, where it may only read and add rows, and it owns
  nothing, so it cannot alter a table or switch off the audit trigger. Migrations and the seed
  run as the schema owner. The role is created here without a login if it does not exist; a
  password is set by `python -m eddy_api.db.local` locally and by the infrastructure elsewhere.

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-11 09:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

RUNTIME_ROLE = "eddy_app"

CREATE_ROLE = f"""
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '{RUNTIME_ROLE}') THEN
        CREATE ROLE {RUNTIME_ROLE} NOLOGIN;
    END IF;
END
$$
"""

GRANTS = (
    f"GRANT USAGE ON SCHEMA public TO {RUNTIME_ROLE}",
    f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {RUNTIME_ROLE}",
    f"REVOKE UPDATE, DELETE ON audit_log FROM {RUNTIME_ROLE}",
    f"REVOKE INSERT, UPDATE, DELETE ON alembic_version FROM {RUNTIME_ROLE}",
    f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {RUNTIME_ROLE}",
    # Tables that later migrations create get the same rights.
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public"
    f" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {RUNTIME_ROLE}",
    f"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO {RUNTIME_ROLE}",
)

REVOKES = (
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public"
    f" REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM {RUNTIME_ROLE}",
    f"ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE USAGE ON SEQUENCES FROM {RUNTIME_ROLE}",
    # A constant role name, not input: "SELECT ... FROM" only looks like a query to the linter.
    f"ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON SEQUENCES FROM {RUNTIME_ROLE}",  # noqa: S608
    f"REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM {RUNTIME_ROLE}",
    f"REVOKE ALL ON ALL TABLES IN SCHEMA public FROM {RUNTIME_ROLE}",
    f"REVOKE USAGE ON SCHEMA public FROM {RUNTIME_ROLE}",
)


def upgrade() -> None:
    op.alter_column("student_profile", "board", existing_type=sa.String(length=32), nullable=True)
    op.alter_column("student_profile", "tier", existing_type=sa.String(length=32), nullable=True)
    op.alter_column(
        "student_profile", "target_grade", existing_type=sa.SmallInteger(), nullable=True
    )
    op.add_column(
        "student_profile",
        sa.Column("setup_completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "student_profile",
        sa.Column("diagnostic_completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_check_constraint(
        op.f("ck_student_profile_board_not_dfe"),
        "student_profile",
        "board IS NULL OR board <> 'DFE'",
    )
    op.create_check_constraint(
        op.f("ck_student_profile_setup_complete"),
        "student_profile",
        "setup_completed_at IS NULL"
        " OR (board IS NOT NULL AND tier IS NOT NULL AND target_grade IS NOT NULL)",
    )

    op.create_table(
        "pending_signup",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("invite_code", sa.String(length=32), nullable=False),
        sa.Column("birth_year", sa.SmallInteger(), nullable=False),
        sa.Column("birth_month", sa.SmallInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "birth_month BETWEEN 1 AND 12", name=op.f("ck_pending_signup_birth_month")
        ),
        sa.ForeignKeyConstraint(
            ["invite_code"],
            ["invite_code.code"],
            name=op.f("fk_pending_signup_invite_code_invite_code"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_pending_signup")),
    )
    op.create_index(
        "uq_pending_signup_email_lower",
        "pending_signup",
        [sa.literal_column("lower(email)")],
        unique=True,
    )
    op.create_index(op.f("ix_pending_signup_invite_code"), "pending_signup", ["invite_code"])
    op.create_index(op.f("ix_pending_signup_expires_at"), "pending_signup", ["expires_at"])

    op.create_table(
        "invite_redemption",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("invite_code", sa.String(length=32), nullable=False),
        sa.Column(
            "redeemed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["invite_code"],
            ["invite_code.code"],
            name=op.f("fk_invite_redemption_invite_code_invite_code"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_invite_redemption_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_invite_redemption")),
    )
    op.create_index(op.f("ix_invite_redemption_invite_code"), "invite_redemption", ["invite_code"])

    op.create_table(
        "diagnostic_session",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("student_id", sa.UUID(), nullable=False),
        sa.Column("state", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["student_id"],
            ["users.id"],
            name=op.f("fk_diagnostic_session_student_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_diagnostic_session")),
    )
    op.create_index(op.f("ix_diagnostic_session_student_id"), "diagnostic_session", ["student_id"])
    op.create_index(
        "uq_diagnostic_session_open",
        "diagnostic_session",
        ["student_id"],
        unique=True,
        postgresql_where=sa.text("completed_at IS NULL"),
    )

    op.create_table(
        "concern_report",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=True),
        sa.Column(
            "category",
            sa.Enum(
                "SAFETY",
                "CONTENT",
                "PRIVACY",
                "OTHER",
                name="concern_category",
                native_enum=False,
                create_constraint=True,
                length=32,
            ),
            nullable=False,
        ),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("page", sa.String(length=200), nullable=True),
        sa.Column("tutor_session_id", sa.UUID(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("notified_party", sa.String(length=128), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_by", sa.UUID(), nullable=True),
        sa.CheckConstraint(
            "char_length(message) BETWEEN 1 AND 2000",
            name=op.f("ck_concern_report_message_length"),
        ),
        sa.ForeignKeyConstraint(
            ["reviewed_by"],
            ["users.id"],
            name=op.f("fk_concern_report_reviewed_by_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["tutor_session_id"],
            ["tutor_session.id"],
            name=op.f("fk_concern_report_tutor_session_id_tutor_session"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_concern_report_user_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_concern_report")),
    )
    op.create_index(op.f("ix_concern_report_user_id"), "concern_report", ["user_id"])

    op.execute(CREATE_ROLE)
    for statement in GRANTS:
        op.execute(statement)


def downgrade() -> None:
    for statement in REVOKES:
        op.execute(statement)
    op.drop_index(op.f("ix_concern_report_user_id"), table_name="concern_report")
    op.drop_table("concern_report")
    op.drop_index("uq_diagnostic_session_open", table_name="diagnostic_session")
    op.drop_index(op.f("ix_diagnostic_session_student_id"), table_name="diagnostic_session")
    op.drop_table("diagnostic_session")
    op.drop_index(op.f("ix_invite_redemption_invite_code"), table_name="invite_redemption")
    op.drop_table("invite_redemption")
    op.drop_index(op.f("ix_pending_signup_expires_at"), table_name="pending_signup")
    op.drop_index(op.f("ix_pending_signup_invite_code"), table_name="pending_signup")
    op.drop_index("uq_pending_signup_email_lower", table_name="pending_signup")
    op.drop_table("pending_signup")
    op.drop_constraint(op.f("ck_student_profile_setup_complete"), "student_profile", type_="check")
    op.drop_constraint(op.f("ck_student_profile_board_not_dfe"), "student_profile", type_="check")
    # Profiles made by the age check but never set up cannot become NOT NULL again.
    op.execute("DELETE FROM student_profile WHERE setup_completed_at IS NULL")
    op.drop_column("student_profile", "diagnostic_completed_at")
    op.drop_column("student_profile", "setup_completed_at")
    op.alter_column(
        "student_profile", "target_grade", existing_type=sa.SmallInteger(), nullable=False
    )
    op.alter_column("student_profile", "tier", existing_type=sa.String(length=32), nullable=False)
    op.alter_column("student_profile", "board", existing_type=sa.String(length=32), nullable=False)
