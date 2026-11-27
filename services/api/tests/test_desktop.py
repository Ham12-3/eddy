"""The desktop app's entry program (ADR-0036): set-up of an empty database, and where it finds
its files when there is no repository around it."""

import os
import subprocess
import sys
from pathlib import Path

import pytest
from alembic.script import ScriptDirectory
from pydantic import SecretStr
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from eddy_api import desktop
from eddy_api.config import Settings
from eddy_api.llm.config import REPO_ROOT


def test_migrations_are_found_in_the_repository_and_in_the_packaged_app(tmp_path: Path) -> None:
    assert desktop.migrations_dir() == REPO_ROOT / "services" / "api" / "migrations"
    assert (desktop.migrations_dir() / "env.py").is_file()
    # The packaged app keeps them beside config/ and curriculum/, in the folder EDDY_HOME names.
    (tmp_path / "migrations").mkdir()
    assert desktop.migrations_dir(tmp_path) == tmp_path / "migrations"
    config = desktop.migrations_config("postgresql+psycopg://x/y", tmp_path)
    assert config.get_main_option("script_location") == str(tmp_path / "migrations")
    assert config.config_file_name is None
    assert config.attributes["database_url"] == "postgresql+psycopg://x/y"


def test_the_home_folder_can_be_named_by_the_desktop_app(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from eddy_api.llm import config

    monkeypatch.setenv("EDDY_HOME", str(tmp_path))
    assert config._home() == tmp_path.resolve()
    monkeypatch.delenv("EDDY_HOME")
    assert config._home() == REPO_ROOT
    assert (REPO_ROOT / "config" / "models.yaml").is_file()


def test_an_older_eddy_says_plainly_that_the_data_is_newer(
    empty_database: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    owner = make_url(empty_database)
    runtime = owner.set(username="eddy_app", password="eddy_app")
    settings = Settings(
        database_url=SecretStr(owner.render_as_string(hide_password=False)),
        runtime_database_url=SecretStr(runtime.render_as_string(hide_password=False)),
    )
    desktop.setup(settings)
    # As if a later version of Eddy had migrated this database further than this one knows.
    engine = create_engine(owner)
    try:
        with engine.begin() as connection:
            connection.execute(text("UPDATE alembic_version SET version_num = '9999'"))
    finally:
        engine.dispose()
    monkeypatch.setattr(desktop, "get_settings", lambda: settings)
    assert desktop.main(["setup"]) == desktop.NEWER_DATABASE
    assert "older than the one that last used this data" in capsys.readouterr().err


WATCHER = """
import sys, time
from eddy_api.desktop import exit_with_parent
exit_with_parent(before=lambda: print("stopping the database", flush=True))
print("started", flush=True)
time.sleep(60)
print("still here", flush=True)
"""


def _watched(env_value: str | None) -> subprocess.Popen[str]:
    env = {key: value for key, value in os.environ.items() if key != "EDDY_EXIT_WITH_PARENT"}
    if env_value is not None:
        env["EDDY_EXIT_WITH_PARENT"] = env_value
    # A fixed script run with this very interpreter: nothing here comes from outside the test.
    return subprocess.Popen(  # noqa: S603
        [sys.executable, "-c", WATCHER],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
        env=env,
    )


def test_a_program_ends_when_the_shell_that_started_it_goes() -> None:
    child = _watched("1")
    assert child.stdout is not None
    assert child.stdin is not None
    try:
        assert child.stdout.readline().strip() == "started"
        # The shell goes: its end of the pipe closes, as it does when a process is killed.
        child.stdin.close()
        assert child.wait(timeout=20) == 0
        # What must happen first did happen, and the program did not carry on.
        assert child.stdout.read().split() == ["stopping", "the", "database"]
    finally:
        child.kill()


def test_a_program_started_by_hand_is_left_alone() -> None:
    child = _watched(None)
    assert child.stdout is not None
    assert child.stdin is not None
    try:
        assert child.stdout.readline().strip() == "started"
        child.stdin.close()
        with pytest.raises(subprocess.TimeoutExpired):
            child.wait(timeout=3)
    finally:
        child.kill()


def test_stopping_the_database_needs_to_be_told_where_it_is(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    ran: list[list[str]] = []
    monkeypatch.setattr(subprocess, "run", lambda args, **_: ran.append(args))
    monkeypatch.delenv("EDDY_PG_CTL", raising=False)
    monkeypatch.delenv("EDDY_PG_DATA", raising=False)
    desktop.stop_database()
    assert ran == []
    monkeypatch.setenv("EDDY_PG_CTL", "pg_ctl.exe")
    monkeypatch.setenv("EDDY_PG_DATA", str(tmp_path))
    monkeypatch.setenv("EDDY_PG_PORT", "50123")
    desktop.stop_database()  # no postmaster.pid: no database is running there
    assert ran == []
    # The file PostgreSQL keeps while it runs: its process, folder, start time, then its port.
    running = tmp_path / "postmaster.pid"
    running.write_bytes(b"1234\nC:/data\n1795720000\n50999\n")
    desktop.stop_database()  # a newer launch's database, on another port: left alone
    assert ran == []
    running.write_bytes(b"1234\n")
    desktop.stop_database()  # still being written: nothing to go on
    assert ran == []
    running.write_bytes(b"1234\nC:/data\n1795720000\n50123\n")
    desktop.stop_database()
    assert ran == [["pg_ctl.exe", "stop", "-D", str(tmp_path), "-m", "fast", "-w", "-t", "30"]]


def test_packaged_it_runs_only_the_launcher_shipped_beside_it(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    program = tmp_path / "python" / "eddy-api" / "eddy-api.exe"
    program.parent.mkdir(parents=True)
    program.write_bytes(b"")
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", str(program))
    # Whatever the environment names is ignored: the program must not run just anything.
    monkeypatch.setenv("EDDY_PG_CTL", str(tmp_path / "another-program.exe"))
    assert desktop.shipped_pg_ctl() is None
    shipped = tmp_path / "postgres" / "bin" / "pg_ctl.exe"
    shipped.parent.mkdir(parents=True)
    shipped.write_bytes(b"")
    assert desktop.shipped_pg_ctl() == str(shipped.resolve())


def test_the_database_watcher_is_only_for_the_shell(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.delenv("EDDY_EXIT_WITH_PARENT", raising=False)
    # Started by hand it would wait for ever and stop nothing, so it says so and ends.
    assert desktop.main(["watch-database"]) == 2
    assert "started by the desktop shell" in capsys.readouterr().err


def test_the_commands_need_what_they_need() -> None:
    with pytest.raises(SystemExit):
        desktop.main([])
    with pytest.raises(SystemExit):
        desktop.main(["serve"])  # no port: it never guesses one
    with pytest.raises(SystemExit):
        desktop.main(["serve", "--port", "not-a-number"])


def test_set_up_prepares_an_empty_database_and_can_be_run_again(empty_database: str) -> None:
    owner = make_url(empty_database)
    # The runtime role as the development server already has it, so nothing shared changes.
    runtime = owner.set(username="eddy_app", password="eddy_app")
    settings = Settings(
        database_url=SecretStr(owner.render_as_string(hide_password=False)),
        runtime_database_url=SecretStr(runtime.render_as_string(hide_password=False)),
    )
    desktop.setup(settings)
    desktop.setup(settings)  # every start of the desktop app runs it
    config = desktop.migrations_config(owner.render_as_string(hide_password=False))

    engine = create_engine(runtime)
    try:
        with engine.connect() as connection:
            # The runtime role can log in and read the seeded curriculum.
            assert connection.scalar(text("SELECT count(*) FROM curriculum_node")) > 0
            assert connection.scalar(text("SELECT count(*) FROM misconception")) > 0
            head = connection.scalar(text("SELECT version_num FROM alembic_version"))
            assert head == ScriptDirectory.from_config(config).get_current_head()
            # And it still cannot change the schema (ADR-0024).
            with pytest.raises(Exception, match=r"permission denied|must be owner"):
                connection.execute(text("ALTER TABLE users ADD COLUMN nope int"))
    finally:
        engine.dispose()
