"""The desktop app's one program for everything services/api does (ADR-0036).

The desktop shell starts a private Postgres and then runs this, packaged as one executable:

- `setup`: make the database if it is not there, let the runtime role log in, bring the schema
  up to date and seed the curriculum. Safe to run at every start.
- `serve --port N`: the API, on 127.0.0.1 only.
- `worker`: the privacy jobs (the 90-day message purge and profile erasure), every 15 minutes.

Settings come from the environment, as everywhere else. `EDDY_HOME` names the folder that holds
`config/`, `prompts/`, `curriculum/` and `migrations/`; in the repository it is not needed.

- `watch-database`: does nothing until the shell that started it goes, then stops the database.
  Windows ends the shell's own programs with it, but PostgreSQL is started through its own
  launcher and would run on, holding the student's data open. The shell starts this one apart
  from itself, so it is still there to stop the database when the shell has been ended.

With `EDDY_EXIT_WITH_PARENT=1` a long-running command ends when the shell that started it goes,
however it goes (`exit_with_parent`).
"""

import argparse
import os
import subprocess
import sys
import threading
from collections.abc import Callable
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


def exit_with_parent(before: Callable[[], None] | None = None) -> None:
    """End this process when the one that started it goes.

    The shell gives each program a pipe as its input and never writes to it. While the shell is
    alive a read from that pipe waits; when the shell exits, crashes or is ended from Task
    Manager, the pipe closes and the read returns. Nothing of Eddy is then left running on the
    computer. Only with EDDY_EXIT_WITH_PARENT=1: started by hand, a closed input means nothing.
    """
    if os.environ.get("EDDY_EXIT_WITH_PARENT") != "1":
        return

    def wait() -> None:
        try:
            sys.stdin.buffer.read()
        except (OSError, ValueError, AttributeError):
            pass  # No usable input, or none at all, is treated like a closed one.
        try:
            if before is not None:
                before()
        finally:
            os._exit(0)

    threading.Thread(target=wait, name="exit-with-parent", daemon=True).start()


def shipped_pg_ctl() -> str | None:
    """The PostgreSQL launcher to stop the database with.

    Packaged, it is always the one shipped beside this program
    (`<resources>/python/eddy-api/` and `<resources>/postgres/bin/`), whatever the environment
    says: this program must never be a way to run some other program. From source there is no
    such folder, so the shell names it (EDDY_PG_CTL).
    """
    if getattr(sys, "frozen", False):
        shipped = Path(sys.executable).resolve().parents[2] / "postgres" / "bin" / "pg_ctl.exe"
        return str(shipped) if shipped.is_file() else None
    return os.environ.get("EDDY_PG_CTL") or None


def stop_database() -> None:
    """Stops the desktop app's PostgreSQL, when the shell could not (EDDY_PG_DATA, EDDY_PG_PORT).

    The database is not this program's child, so it would otherwise run on, holding the
    student's data open, until the computer was signed out of. Only the database this launch
    started is stopped: if Eddy has been opened again since, the one running in the folder now
    belongs to the newer launch, on another port, and is left alone.
    """
    pg_ctl, data = shipped_pg_ctl(), os.environ.get("EDDY_PG_DATA")
    port = os.environ.get("EDDY_PG_PORT")
    if not pg_ctl or not data or not port:
        return
    try:
        # PostgreSQL writes its port on the fourth line of the file that says it is running.
        running = Path(data, "postmaster.pid").read_text(encoding="utf-8").splitlines()
    except OSError:
        return  # No such file: no database is running there.
    if len(running) < 4 or running[3].strip() != port:
        return
    # The data folder comes from the shell that started this program, not from anyone's input.
    subprocess.run(  # noqa: S603
        [pg_ctl, "stop", "-D", data, "-m", "fast", "-w", "-t", "30"],
        check=False,
        capture_output=True,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


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
    commands.add_parser("watch-database", help="stop the database when the shell has gone")
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
        exit_with_parent()
        serve(args.port)
        return 0
    if args.command == "watch-database":
        if os.environ.get("EDDY_EXIT_WITH_PARENT") != "1":
            print("watch-database is started by the desktop shell, not by hand.", file=sys.stderr)
            return 2
        exit_with_parent(before=stop_database)
        threading.Event().wait()  # until the shell goes, or ends this program itself
        return 0
    from eddy_api import worker

    exit_with_parent()
    return worker.main([])


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
