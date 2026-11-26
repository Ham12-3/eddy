"""Engine and session factory, built from RUNTIME_DATABASE_URL: the runtime role, which cannot
change the schema or the audit log (ADR-0024). Migrations and the seed use DATABASE_URL."""

from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from eddy_api.config import get_settings


@lru_cache
def get_engine() -> Engine:
    return create_engine(
        get_settings().runtime_database_url.get_secret_value(),
        pool_pre_ping=True,
        # An error's message never carries a statement's values (names, answers, PIN hashes):
        # in the desktop app it would be written to a log file on the family's computer.
        hide_parameters=True,
    )


def session_factory() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), expire_on_commit=False)


def get_session() -> Iterator[Session]:
    """FastAPI dependency: one session per request."""
    with session_factory()() as session:
        yield session
