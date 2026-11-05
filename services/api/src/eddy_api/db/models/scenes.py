"""Scene specs, what students watched, and cached narration (SPEC.md section 7.2)."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from eddy_api.db.base import Base, checked_enum, created_at, uuid_pk


class AudioAsset(Base):
    __tablename__ = "audio_asset"
    __table_args__ = (UniqueConstraint("provider", "voice_id", "provider_model", "text_hash"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    provider: Mapped[str] = mapped_column(String(32))
    voice_id: Mapped[str] = mapped_column(String(64))
    provider_model: Mapped[str] = mapped_column(String(64))
    text_hash: Mapped[str] = mapped_column(String(64))
    s3_key: Mapped[str] = mapped_column(String(255))
    word_timings: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    duration_ms: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = created_at()


class SceneSpec(Base):
    __tablename__ = "scene_spec"

    id: Mapped[uuid.UUID] = uuid_pk()
    template_key: Mapped[str] = mapped_column(String(128))
    template_version: Mapped[str] = mapped_column(String(16))
    spec: Mapped[dict[str, Any]] = mapped_column(JSONB)
    # hash(template@version, misconception, params, narration): the cache key.
    hash: Mapped[str] = mapped_column(String(64), unique=True)
    tier: Mapped[str] = mapped_column(checked_enum("scene_tier", "DETERMINISTIC", "LLM"))
    verification_report: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    render_status: Mapped[str] = mapped_column(
        checked_enum("render_status", "PENDING", "PASSED", "FAILED")
    )
    audio_asset_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("audio_asset.id"))
    created_by: Mapped[str] = mapped_column(
        checked_enum("scene_author", "TEMPLATE", "LLM", "HUMAN")
    )
    prompt_version: Mapped[str | None] = mapped_column(String(32))
    model: Mapped[str | None] = mapped_column(String(64))
    approved: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = created_at()


class SceneInstance(Base):
    __tablename__ = "scene_instance"

    id: Mapped[uuid.UUID] = uuid_pk()
    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    attempt_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("attempt.id"))
    scene_spec_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("scene_spec.id"))
    watched_ms: Mapped[int] = mapped_column(Integer, default=0)
    completed: Mapped[bool] = mapped_column(Boolean, default=False)
    replays: Mapped[int] = mapped_column(Integer, default=0)
    step_backs: Mapped[int] = mapped_column(Integer, default=0)
    recheck_result: Mapped[str | None] = mapped_column(
        checked_enum("recheck_result", "CORRECT", "INCORRECT")
    )
    created_at: Mapped[datetime] = created_at()
