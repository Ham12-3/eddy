"""Alembic environment. The URL comes from settings, or from config.attributes["database_url"]
(the migration tests use that to point at a throwaway database)."""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

import eddy_api.db.models  # noqa: F401  (registers every table on Base.metadata)
from eddy_api.config import get_settings
from eddy_api.db.base import Base, include_object

config = context.config
if config.config_file_name is not None and not config.attributes.get("skip_logging"):
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def database_url() -> str:
    url = config.attributes.get("database_url")
    return str(url) if url else get_settings().database_url.get_secret_value()


def run_migrations_offline() -> None:
    context.configure(
        url=database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        include_object=include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(database_url(), poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            include_object=include_object,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
