"""M7 tutor safety: safeguarding events name their lesson, and checkpoints go with the lesson

- safeguarding_event.tutor_session_id: the lesson an event came from, for the reviewer (set null
  if the lesson is deleted; the event itself is kept, SPEC.md section 6.7).
- A trigger deletes a lesson's LangGraph checkpoints when its tutor_session row is deleted, so
  account deletion (which cascades to tutor_session) removes them too. The checkpoints hold the
  lesson's position, ids and the student's validated answers, never free text (ADR-0031).

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-09 09:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DELETE_CHECKPOINTS = """
CREATE FUNCTION delete_tutor_checkpoints() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM checkpoint_writes WHERE thread_id = OLD.id::text;
    DELETE FROM checkpoint_blobs WHERE thread_id = OLD.id::text;
    DELETE FROM checkpoints WHERE thread_id = OLD.id::text;
    RETURN OLD;
END
$$
"""
TRIGGER = """
CREATE TRIGGER tutor_session_delete_checkpoints AFTER DELETE ON tutor_session
FOR EACH ROW EXECUTE FUNCTION delete_tutor_checkpoints()
"""


def upgrade() -> None:
    op.add_column(
        "safeguarding_event",
        sa.Column("tutor_session_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        op.f("fk_safeguarding_event_tutor_session_id_tutor_session"),
        "safeguarding_event",
        "tutor_session",
        ["tutor_session_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        op.f("ix_safeguarding_event_tutor_session_id"),
        "safeguarding_event",
        ["tutor_session_id"],
    )
    op.execute(DELETE_CHECKPOINTS)
    op.execute(TRIGGER)


def downgrade() -> None:
    op.execute("DROP TRIGGER tutor_session_delete_checkpoints ON tutor_session")
    op.execute("DROP FUNCTION delete_tutor_checkpoints()")
    op.drop_index(op.f("ix_safeguarding_event_tutor_session_id"), table_name="safeguarding_event")
    op.drop_constraint(
        op.f("fk_safeguarding_event_tutor_session_id_tutor_session"),
        "safeguarding_event",
        type_="foreignkey",
    )
    op.drop_column("safeguarding_event", "tutor_session_id")
