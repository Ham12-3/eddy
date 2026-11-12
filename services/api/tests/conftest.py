"""Database fixtures.

Tests that need Postgres skip when it is unreachable, unless EDDY_REQUIRE_DB=1 (set in CI), when
they fail instead. Each run migrates a throwaway database and drops it afterwards, so the local
`eddy` database is never touched.
"""

import os
import uuid
from collections.abc import Callable, Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

API_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = API_DIR.parents[1]
ADMIN_URL = os.environ.get(
    "EDDY_TEST_DATABASE_URL", "postgresql+psycopg://eddy:eddy@127.0.0.1:5442/eddy"
)


def alembic_config(url: str) -> Config:
    config = Config(str(API_DIR / "alembic.ini"))
    config.attributes["database_url"] = url
    config.attributes["skip_logging"] = True
    return config


@pytest.fixture(scope="session")
def make_alembic_config() -> Callable[[str], Config]:
    return alembic_config


@pytest.fixture(scope="session")
def admin_engine() -> Iterator[Engine]:
    engine = create_engine(
        ADMIN_URL, isolation_level="AUTOCOMMIT", connect_args={"connect_timeout": 3}
    )
    try:
        with engine.connect():
            pass
    except OperationalError as error:
        engine.dispose()
        if os.environ.get("EDDY_REQUIRE_DB") == "1":
            pytest.fail(f"EDDY_REQUIRE_DB=1 but Postgres is unreachable: {error}")
        pytest.skip("Postgres is not running (docker compose up -d --wait postgres)")
    yield engine
    engine.dispose()


def _create_database(admin_engine: Engine) -> tuple[str, str]:
    name = f"eddy_test_{uuid.uuid4().hex[:12]}"
    with admin_engine.connect() as connection:
        connection.execute(text(f'CREATE DATABASE "{name}"'))
    url = make_url(ADMIN_URL).set(database=name).render_as_string(hide_password=False)
    return name, url


def _drop_database(admin_engine: Engine, name: str) -> None:
    with admin_engine.connect() as connection:
        connection.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))


@pytest.fixture
def empty_database(admin_engine: Engine) -> Iterator[str]:
    """A new, empty database for one test. Yields its URL."""
    name, url = _create_database(admin_engine)
    try:
        yield url
    finally:
        _drop_database(admin_engine, name)


@pytest.fixture(scope="session")
def migrated_database(admin_engine: Engine) -> Iterator[str]:
    """One migrated database shared by the session. Tests must not commit to it."""
    name, url = _create_database(admin_engine)
    try:
        command.upgrade(alembic_config(url), "head")
        yield url
    finally:
        _drop_database(admin_engine, name)


@pytest.fixture
def db_session(migrated_database: str) -> Iterator[Session]:
    """A session inside a transaction that is always rolled back.

    session.rollback() and session.commit() only end a savepoint, so a test can roll back its
    own work (as a dry run does) without leaking anything to the next test.

    It runs as the runtime role the API connects as (ADR-0024), so every test proves the API
    needs no more than that role's rights.
    """
    engine = create_engine(migrated_database)
    with engine.connect() as connection:
        transaction = connection.begin()
        connection.execute(text("SET LOCAL ROLE eddy_app"))
        session = Session(bind=connection, join_transaction_mode="create_savepoint")
        try:
            yield session
        finally:
            session.close()
            transaction.rollback()
    engine.dispose()
