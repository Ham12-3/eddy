"""Local database helpers for development and E2E: never point these at a shared database.

`python -m eddy_api.db.local` creates the database DATABASE_URL names if it does not exist yet,
so E2E can run against its own `eddy_e2e` instead of the developer's `eddy`. It also lets the
runtime role in RUNTIME_DATABASE_URL log in with that URL's password (ADR-0024): migration 0006
creates the role without a login, and elsewhere the infrastructure sets its password.
"""

import re
import sys

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from eddy_api.config import get_settings

LOCAL_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
ROLE_NAME = re.compile(r"[a-z_][a-z0-9_]{0,62}")


def is_local(url: str) -> bool:
    return make_url(url).host in LOCAL_HOSTS


def ensure_database(url: str) -> bool:
    """Create the database in `url` on a local server. True if it was created."""
    target = make_url(url)
    if target.host not in LOCAL_HOSTS:
        raise ValueError(f"refusing to create a database on {target.host}: not a local host")
    name = target.database or ""
    if not name.replace("_", "").isalnum():
        raise ValueError("the database name may only hold letters, digits and underscores")
    engine = create_engine(target.set(database="postgres"), isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as connection:
            exists = connection.scalar(
                text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": name}
            )
            if not exists:
                connection.execute(text(f'CREATE DATABASE "{name}"'))
            return not exists
    finally:
        engine.dispose()


def ensure_runtime_login(owner_url: str, runtime_url: str) -> str:
    """Create the runtime role if needed and let it log in with the runtime URL's password, on a
    local server only. Returns the role's name."""
    owner, runtime = make_url(owner_url), make_url(runtime_url)
    for url in (owner, runtime):
        if url.host not in LOCAL_HOSTS:
            raise ValueError(f"refusing to change a role on {url.host}: not a local host")
    role = runtime.username or ""
    if not ROLE_NAME.fullmatch(role) or role == owner.username:
        raise ValueError("the runtime role must be its own lower-case role, not the owner")
    password = runtime.password or ""
    engine = create_engine(owner.set(database="postgres"), isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as connection:
            exists = connection.scalar(
                text("SELECT 1 FROM pg_roles WHERE rolname = :role"), {"role": role}
            )
            verb = "ALTER" if exists else "CREATE"
            # The password is quoted by Postgres itself; the name was checked above.
            quoted = connection.scalar(text("SELECT quote_literal(:p)"), {"p": str(password)})
            connection.execute(text(f"{verb} ROLE {role} WITH LOGIN PASSWORD {quoted}"))
    finally:
        engine.dispose()
    return role


def main() -> int:
    settings = get_settings()
    url = settings.database_url.get_secret_value()
    created = ensure_database(url)
    print(f"database {make_url(url).database} {'created' if created else 'already exists'}")
    role = ensure_runtime_login(url, settings.runtime_database_url.get_secret_value())
    print(f"runtime role {role} can log in")
    return 0


if __name__ == "__main__":
    sys.exit(main())
