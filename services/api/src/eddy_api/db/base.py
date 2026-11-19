"""Declarative base and column helpers shared by every model (SPEC.md section 6).

Alembic is the only schema source (ADR-0010). Enums are stored as checked strings rather than
Postgres enum types, so adding a value is a one-line migration.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, MetaData, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def checked_enum(name: str, *values: str) -> Enum:
    """A string column limited to `values` by a CHECK constraint."""
    return Enum(*values, name=name, native_enum=False, create_constraint=True, length=32)


def uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )


def created_at() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


#: LangGraph's checkpoint tables (migration 0004): created by Alembic, used through LangGraph's
#: own checkpointer, so they have no models here and the model comparison leaves them out.
CHECKPOINT_TABLES = frozenset(
    {"checkpoints", "checkpoint_blobs", "checkpoint_writes", "checkpoint_migrations"}
)


def include_object(
    obj: object, name: str | None, type_: str, reflected: bool, compare_to: object
) -> bool:
    """Alembic's filter: skip the checkpoint tables and their indexes."""
    table = getattr(obj, "table", None)
    table_name = name if type_ == "table" else getattr(table, "name", None)
    return table_name not in CHECKPOINT_TABLES
