"""English data model only in the MVP (SPEC.md section 6.6). All wording is our own."""

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from eddy_api.db.base import Base, checked_enum, uuid_pk
from eddy_api.db.models.curriculum import BOARDS

SET_TEXT_CATEGORIES = (
    "SHAKESPEARE",
    "NINETEENTH_CENTURY_NOVEL",
    "MODERN_TEXT",
    "POETRY_ANTHOLOGY",
    "UNSEEN_POETRY",
)


class SetText(Base):
    __tablename__ = "set_text"
    __table_args__ = (UniqueConstraint("board", "title"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    board: Mapped[str] = mapped_column(checked_enum("set_text_board", *BOARDS))
    title: Mapped[str] = mapped_column(String(255))
    author: Mapped[str] = mapped_column(String(255))
    category: Mapped[str] = mapped_column(checked_enum("set_text_category", *SET_TEXT_CATEGORIES))
    copyright_status: Mapped[str] = mapped_column(
        checked_enum("copyright_status", "PUBLIC_DOMAIN", "IN_COPYRIGHT")
    )
    # FULL_TEXT only for public-domain texts; in-copyright texts are referenced, never reproduced.
    display_policy: Mapped[str] = mapped_column(
        checked_enum("display_policy", "FULL_TEXT", "QUOTATIONS_ONLY", "REFERENCE_ONLY")
    )
    notes: Mapped[str | None] = mapped_column(Text)
    retired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class QuestionType(Base):
    __tablename__ = "question_type"
    __table_args__ = (
        UniqueConstraint("spec_id", "paper", "number"),
        CheckConstraint("marks > 0", name="marks"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    spec_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("curriculum_spec.id"))
    paper: Mapped[int] = mapped_column(SmallInteger)
    number: Mapped[str] = mapped_column(String(8))
    marks: Mapped[int] = mapped_column(SmallInteger)
    aos: Mapped[list[str]] = mapped_column(ARRAY(String(8)))
    suggested_minutes: Mapped[int] = mapped_column(SmallInteger)
    task_summary_own_words: Mapped[str] = mapped_column(Text)


class LevelDescriptor(Base):
    """Paraphrased, never copied from an exam board (SPEC.md section 6.6)."""

    __tablename__ = "level_descriptor"
    __table_args__ = (
        UniqueConstraint("question_type_id", "level"),
        # English Language reading questions use four levels; Literature uses six.
        CheckConstraint("level BETWEEN 1 AND 6", name="level"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    question_type_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("question_type.id", ondelete="CASCADE")
    )
    level: Mapped[int] = mapped_column(SmallInteger)
    summary_own_words: Mapped[str] = mapped_column(Text)
