"""Tutor sessions and messages, and metadata for every model call (SPEC.md sections 6.5, 6.7)."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, Integer, Numeric, SmallInteger, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from eddy_api.db.base import Base, checked_enum, created_at, uuid_pk


class TutorSession(Base):
    __tablename__ = "tutor_session"

    id: Mapped[uuid.UUID] = uuid_pk()
    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    started_at: Mapped[datetime] = created_at()
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    end_reason: Mapped[str | None] = mapped_column(
        checked_enum("session_end_reason", "FINISHED", "PAUSED", "TIMED_OUT", "SAFEGUARDING")
    )


class TutorMessage(Base):
    """Raw content is deleted after the retention period (default 90 days); metadata stays."""

    __tablename__ = "tutor_message"

    id: Mapped[uuid.UUID] = uuid_pk()
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tutor_session.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(checked_enum("message_role", "STUDENT", "TUTOR", "SYSTEM"))
    content: Mapped[str | None] = mapped_column(Text)
    content_deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    state: Mapped[str] = mapped_column(String(32))
    hint_level: Mapped[int | None] = mapped_column(SmallInteger)
    model: Mapped[str | None] = mapped_column(String(64))
    prompt_version: Mapped[str | None] = mapped_column(String(32))
    tool_calls: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    safety_flags: Mapped[list[str]] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = created_at()


class LlmCall(Base):
    """One model call: metadata only, never the prompt or response text (ADR-0009)."""

    __tablename__ = "llm_call"
    # The Tier L cost guards sum the last 24 hours (ADR-0030).
    __table_args__ = (Index("ix_llm_call_created_at", "created_at"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    route: Mapped[str] = mapped_column(String(64))
    model: Mapped[str] = mapped_column(String(64))
    prompt_id: Mapped[str] = mapped_column(String(64))
    prompt_version: Mapped[str] = mapped_column(String(32))
    input_tokens: Mapped[int] = mapped_column(Integer)
    output_tokens: Mapped[int] = mapped_column(Integer)
    cache_read_tokens: Mapped[int] = mapped_column(Integer, default=0)
    latency_ms: Mapped[int] = mapped_column(Integer)
    cost_estimate_gbp: Mapped[float] = mapped_column(Numeric(10, 6))
    stop_reason: Mapped[str | None] = mapped_column(String(32))
    safety_flags: Mapped[list[str]] = mapped_column(JSONB, default=list)
    student_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    created_at: Mapped[datetime] = created_at()
