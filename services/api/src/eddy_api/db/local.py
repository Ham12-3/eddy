"""Local database helpers for development and E2E: never point these at a shared database.

`python -m eddy_api.db.local` creates the database DATABASE_URL names if it does not exist yet,
so E2E can run against its own `eddy_e2e` instead of the developer's `eddy`.
"""

import sys

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from eddy_api.config import get_settings

LOCAL_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})


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


def main() -> int:
    url = get_settings().database_url.get_secret_value()
    created = ensure_database(url)
    print(f"database {make_url(url).database} {'created' if created else 'already exists'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
