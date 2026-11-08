"""The learner model: attempts, BKT mastery, misconception states and FSRS review cards."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from eddy_api.db.base import Base, checked_enum, created_at, uuid_pk

MASTERY_STATUSES = ("UNSEEN", "LEARNING", "SECURE", "NEEDS_REVIEW")
MISCONCEPTION_STATUSES = ("SUSPECTED", "CONFIRMED", "REMEDIATED", "RECHECKED_OK", "RECURRED")


class Attempt(Base):
    __tablename__ = "attempt"
    __table_args__ = (
        CheckConstraint(
            "confidence_self_report IS NULL OR confidence_self_report BETWEEN 1 AND 4",
            name="confidence",
        ),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("item.id"))
    session_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tutor_session.id"))
    response_raw: Mapped[str] = mapped_column(Text)
    response_mathjson: Mapped[Any | None] = mapped_column(JSONB)
    response_parsed: Mapped[str | None] = mapped_column(Text)
    correct: Mapped[bool] = mapped_column(Boolean)
    detected_misconception_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("misconception.id")
    )
    confidence_self_report: Mapped[int | None] = mapped_column(SmallInteger)
    hints_used: Mapped[int] = mapped_column(SmallInteger, default=0)
    # A hint was used or a scene watched before answering; counts for less in BKT (SPEC 7.1).
    aided: Mapped[bool] = mapped_column(Boolean, default=False)
    is_diagnostic: Mapped[bool] = mapped_column(Boolean, default=False)
    time_ms: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = created_at()


class MasteryState(Base):
    __tablename__ = "mastery_state"
    __table_args__ = (
        CheckConstraint("p_mastery BETWEEN 0 AND 1", name="p_mastery"),
        CheckConstraint("p_learn BETWEEN 0 AND 1", name="p_learn"),
        CheckConstraint("p_guess BETWEEN 0 AND 1", name="p_guess"),
        CheckConstraint("p_slip BETWEEN 0 AND 1", name="p_slip"),
    )

    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    node_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("curriculum_node.id"), primary_key=True)
    p_mastery: Mapped[float] = mapped_column(Float)
    p_learn: Mapped[float] = mapped_column(Float)
    p_guess: Mapped[float] = mapped_column(Float)
    p_slip: Mapped[float] = mapped_column(Float)
    evidence_count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(checked_enum("mastery_status", *MASTERY_STATUSES))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class MisconceptionState(Base):
    __tablename__ = "misconception_state"

    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    misconception_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("misconception.id"), primary_key=True
    )
    status: Mapped[str] = mapped_column(
        checked_enum("misconception_status", *MISCONCEPTION_STATUSES)
    )
    evidence_attempt_ids: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(UUID(as_uuid=True)), default=list
    )
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ReviewCard(Base):
    """An FSRS card for one node or one item family (exactly one of the two)."""

    __tablename__ = "review_card"
    __table_args__ = (
        CheckConstraint(
            "(node_id IS NULL) <> (item_family_id IS NULL)", name="node_xor_item_family"
        ),
        CheckConstraint("target_retention > 0 AND target_retention < 1", name="retention"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    node_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("curriculum_node.id"))
    item_family_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("item_family.id"))
    fsrs_state: Mapped[str] = mapped_column(String(16))
    difficulty: Mapped[float] = mapped_column(Float)
    stability: Mapped[float] = mapped_column(Float)
    retrievability: Mapped[float] = mapped_column(Float)
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    last_review_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lapses: Mapped[int] = mapped_column(Integer, default=0)
    target_retention: Mapped[float] = mapped_column(Float, default=0.9)
