"""M7 tutor: LangGraph's checkpoint tables, learner model snapshots and item seeds

- The four tables LangGraph's Postgres checkpointer uses (langgraph-checkpoint-postgres 3.2), as
  a frozen copy of its own migrations 0 to 9, with those versions recorded in
  checkpoint_migrations so its setup() finds nothing to do. Alembic stays the only schema source
  (ADR-0010); the checkpoints hold the lesson's position, ids and validated answers, never
  free text (ADR-0031).
- mastery_state.model and misconception_state.track: the learner model's full state for a node or
  a misconception (eddy_api.learner, ADR-0026), which the existing columns summarise.
- item.seed: maths-core regenerates an item from its template and seed, so the tutor can verify
  claims and check answers against it.

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-08 10:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CHECKPOINT_TABLES = """
CREATE TABLE checkpoint_migrations (v INTEGER PRIMARY KEY);
CREATE TABLE checkpoints (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    checkpoint_id TEXT NOT NULL,
    parent_checkpoint_id TEXT,
    type TEXT,
    checkpoint JSONB NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);
CREATE TABLE checkpoint_blobs (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    channel TEXT NOT NULL,
    version TEXT NOT NULL,
    type TEXT NOT NULL,
    blob BYTEA,
    PRIMARY KEY (thread_id, checkpoint_ns, channel, version)
);
CREATE TABLE checkpoint_writes (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    checkpoint_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    channel TEXT NOT NULL,
    type TEXT,
    blob BYTEA NOT NULL,
    task_path TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);
CREATE INDEX checkpoints_thread_id_idx ON checkpoints(thread_id);
CREATE INDEX checkpoint_blobs_thread_id_idx ON checkpoint_blobs(thread_id);
CREATE INDEX checkpoint_writes_thread_id_idx ON checkpoint_writes(thread_id);
INSERT INTO checkpoint_migrations (v) VALUES (0), (1), (2), (3), (4), (5), (6), (7), (8), (9);
"""


def upgrade() -> None:
    for statement in CHECKPOINT_TABLES.split(";"):
        if statement.strip():
            op.execute(statement)
    op.add_column(
        "mastery_state",
        sa.Column(
            "model",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )
    op.add_column(
        "misconception_state",
        sa.Column(
            "track",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )
    op.add_column("item", sa.Column("seed", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("item", "seed")
    op.drop_column("misconception_state", "track")
    op.drop_column("mastery_state", "model")
    for table in ("checkpoint_writes", "checkpoint_blobs", "checkpoints", "checkpoint_migrations"):
        op.drop_table(table)
