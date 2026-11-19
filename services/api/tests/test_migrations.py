"""Migrations run both ways, match the models, and keep audit_log append-only."""

from collections.abc import Callable
from typing import Any

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import Connection, create_engine, inspect, text
from sqlalchemy.exc import DBAPIError

import eddy_api.db.models  # noqa: F401  (registers every table on Base.metadata)
from eddy_api.db.base import Base, include_object


def test_upgrade_downgrade_upgrade(
    empty_database: str, make_alembic_config: Callable[[str], Config]
) -> None:
    config = make_alembic_config(empty_database)
    engine = create_engine(empty_database)
    try:
        command.upgrade(config, "head")
        tables = set(inspect(engine).get_table_names())
        assert set(Base.metadata.tables) <= tables
        command.downgrade(config, "base")
        assert set(inspect(engine).get_table_names()) <= {"alembic_version"}
        command.upgrade(config, "head")
        assert set(Base.metadata.tables) <= set(inspect(engine).get_table_names())
    finally:
        engine.dispose()


def test_the_models_match_the_migrations(migrated_database: str) -> None:
    engine = create_engine(migrated_database)
    try:
        with engine.connect() as connection:
            context = MigrationContext.configure(
                connection, opts={"compare_type": True, "include_object": include_object}
            )
            assert compare_metadata(context, Base.metadata) == []
    finally:
        engine.dispose()


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE audit_log SET action = 'changed'",
        "DELETE FROM audit_log",
        "TRUNCATE audit_log",
    ],
)
def test_audit_log_is_append_only(migrated_database: str, statement: str) -> None:
    engine = create_engine(migrated_database)
    try:
        with engine.connect() as connection:
            connection.execute(
                text(
                    "INSERT INTO audit_log (actor_role, action, target_type) "
                    "VALUES ('system', 'test.write', 'none')"
                )
            )
            with pytest.raises(DBAPIError, match="audit_log is append-only"):
                connection.execute(text(statement))
            connection.rollback()
    finally:
        engine.dispose()


def _user(connection: Connection, email: str, role: str = "student") -> Any:
    return connection.scalar(
        text("INSERT INTO users (email, role) VALUES (:email, :role) RETURNING id"),
        {"email": email, "role": role},
    )


def test_deleting_an_account_keeps_safeguarding_and_erasure_records(migrated_database: str) -> None:
    engine = create_engine(migrated_database)
    try:
        with engine.connect() as connection:
            user = _user(connection, "s@example.test")
            connection.execute(
                text(
                    "INSERT INTO safeguarding_event (student_id, category, severity, excerpt, "
                    "action_taken) VALUES (:user, 'test', 'LOW', 'x', 'none')"
                ),
                {"user": user},
            )
            with pytest.raises(DBAPIError, match="safeguarding_event"):
                connection.execute(text("DELETE FROM users WHERE id = :user"), {"user": user})
            connection.rollback()

            user = _user(connection, "t@example.test")
            connection.execute(
                text(
                    "INSERT INTO data_request (user_id, kind, status) "
                    "VALUES (:user, 'DELETE', 'RECEIVED')"
                ),
                {"user": user},
            )
            connection.execute(text("DELETE FROM users WHERE id = :user"), {"user": user})
            kept = connection.scalar(
                text("SELECT count(*) FROM data_request WHERE user_id IS NULL")
            )
            assert kept == 1
            connection.rollback()
    finally:
        engine.dispose()


def test_a_parent_link_cannot_point_at_itself(migrated_database: str) -> None:
    engine = create_engine(migrated_database)
    try:
        with engine.connect() as connection:
            user = _user(connection, "p@example.test", "parent")
            with pytest.raises(DBAPIError, match="not_self"):
                connection.execute(
                    text(
                        "INSERT INTO parent_link"
                        " (student_id, parent_user_id, status, requested_by) "
                        "VALUES (:u, :u, 'REQUESTED', 'STUDENT')"
                    ),
                    {"u": user},
                )
            connection.rollback()
    finally:
        engine.dispose()
