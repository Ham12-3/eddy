"""The desktop app's one program for everything services/api does (ADR-0036).

The desktop shell starts a private Postgres and then runs this, packaged as one executable:

- `setup`: make the database if it is not there, let the runtime role log in, bring the schema
  up to date and seed the curriculum. Safe to run at every start.
- `serve --port N`: the API, on 127.0.0.1 only.
- `worker`: the privacy jobs (the 90-day message purge and profile erasure), every 15 minutes.

Settings come from the environment, as everywhere else. `EDDY_HOME` names the folder that holds
`config/`, `prompts/`, `curriculum/` and `migrations/`; in the repository it is not needed.
"""

import argparse
import sys
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.util import CommandError
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError

from eddy_api.config import Settings, get_settings
from eddy_api.db.local import ensure_database, ensure_runtime_login
from eddy_api.llm.config import REPO_ROOT
from eddy_api.seed.__main__ import owner_session
from eddy_api.seed.curriculum import load
from eddy_api.seed.upsert import seed

HOST = "127.0.0.1"
#: The exit code of `setup` when the data belongs to a newer Eddy: the shell says so in words.
NEWER_DATABASE = 3


def migrations_dir(home: Path = REPO_ROOT) -> Path:
    """Beside the other data in the packaged app; under services/api in the repository."""
    packaged = home / "migrations"
    return packaged if packaged.is_dir() else home / "services" / "api" / "migrations"


def migrations_config(url: str, home: Path = REPO_ROOT) -> Config:
    """Alembic's settings without an ini file: the packaged app does not carry one."""
    config = Config()
    config.set_main_option("script_location", str(migrations_dir(home)))
    config.set_main_option("path_separator", "os")
    config.attributes["database_url"] = url
    config.attributes["skip_logging"] = True
    return config


class NewerDatabaseError(Exception):
    """The database was last opened by a later version of Eddy than this one."""


def can_log_in(url: str) -> bool:
    """Whether the role in `url` can already connect with its password."""
    engine = create_engine(url, hide_parameters=True)
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return True
    except SQLAlchemyError:
        return False
    finally:
        engine.dispose()


def setup(settings: Settings, home: Path = REPO_ROOT) -> None:
    """Everything the API needs in its database before it starts. Each step is safe to repeat."""
    owner = settings.database_url.get_secret_value()
    runtime = settings.runtime_database_url.get_secret_value()
    created = ensure_database(owner)
    print(f"database {'created' if created else 'ready'}", flush=True)
    # Before the migrations: 0006 grants the runtime role its rights, and makes it only if it
    # is not there. Here it is made with its login, as `pnpm db:local` does in development.
    # Only when needed: the statement carries the password, so it is not run at every start.
    if created or not can_log_in(runtime):
        ensure_runtime_login(owner, runtime)
    try:
        command.upgrade(migrations_config(owner, home), "head")
    except CommandError as error:
        if "Can't locate revision" in str(error):
            raise NewerDatabaseError from error
        raise
    print("schema up to date", flush=True)
    curriculum = load(home / "curriculum")
    with owner_session(owner) as session:
        report = seed(session, curriculum)
        session.commit()
    print(report.render(verbose=False), flush=True)


def serve(port: int) -> None:
    import uvicorn

    from eddy_api.main import app

    # Never anything but this computer: the desktop app has no other caller.
    uvicorn.run(app, host=HOST, port=port, log_level="warning")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="eddy-api", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("setup", help="prepare the database (safe to repeat)")
    serving = commands.add_parser("serve", help="run the API on this computer")
    serving.add_argument("--port", type=int, required=True)
    commands.add_parser("worker", help="run the privacy jobs")
    args = parser.parse_args(argv)
    if args.command == "setup":
        try:
            setup(get_settings())
        except NewerDatabaseError:
            print(
                "This copy of Eddy is older than the one that last used this data. "
                "Install the newer Eddy to open it.",
                file=sys.stderr,
            )
            return NEWER_DATABASE
        return 0
    if args.command == "serve":
        serve(args.port)
        return 0
    from eddy_api import worker

    return worker.main([])


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
