"""The desktop app's entry program (ADR-0036): set-up of an empty database, and where it finds
its files when there is no repository around it."""

from pathlib import Path

import pytest
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

    engine = create_engine(runtime)
    try:
        with engine.connect() as connection:
            # The runtime role can log in and read the seeded curriculum.
            assert connection.scalar(text("SELECT count(*) FROM curriculum_node")) > 0
            assert connection.scalar(text("SELECT count(*) FROM misconception")) > 0
            head = connection.scalar(text("SELECT version_num FROM alembic_version"))
            assert head == "0008"
            # And it still cannot change the schema (ADR-0024).
            with pytest.raises(Exception, match=r"permission denied|must be owner"):
                connection.execute(text("ALTER TABLE users ADD COLUMN nope int"))
    finally:
        engine.dispose()
