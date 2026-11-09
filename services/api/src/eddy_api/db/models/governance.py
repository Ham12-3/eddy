"""Safeguarding, the append-only audit log and data rights requests (SPEC.md sections 6.5, 12)."""

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Identity, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from eddy_api.db.base import Base, checked_enum, created_at, uuid_pk


class SafeguardingEvent(Base):
    __tablename__ = "safeguarding_event"

    id: Mapped[uuid.UUID] = uuid_pk()
    # RESTRICT: deleting an account never silently removes a safeguarding record. The deletion
    # job must handle these as the DPIA decides (SPEC.md section 6.7, an open question).
    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    # The lesson it came from, for the reviewer (ADR-0031).
    tutor_session_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tutor_session.id", ondelete="SET NULL"), index=True
    )
    category: Mapped[str] = mapped_column(String(64))
    severity: Mapped[str] = mapped_column(
        checked_enum("safeguarding_severity", "LOW", "MEDIUM", "HIGH", "IMMEDIATE")
    )
    # Minimised: only as much of the student's words as the reviewer needs.
    excerpt: Mapped[str] = mapped_column(Text)
    action_taken: Mapped[str] = mapped_column(Text)
    notified_party: Mapped[str | None] = mapped_column(String(128))
    created_at: Mapped[datetime] = created_at()
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )


class AuditLog(Base):
    """Who did what. Rows can be added but never changed or removed (a trigger enforces it)."""

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    actor_role: Mapped[str] = mapped_column(String(32))
    action: Mapped[str] = mapped_column(String(64))
    target_type: Mapped[str] = mapped_column(String(64))
    target_id: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = created_at()


class DataRequest(Base):
    __tablename__ = "data_request"

    id: Mapped[uuid.UUID] = uuid_pk()
    # Kept after the account is deleted (SET NULL): the record of an erasure request is itself
    # needed to show the request was met (UK GDPR accountability).
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    kind: Mapped[str] = mapped_column(checked_enum("data_request_kind", "EXPORT", "DELETE"))
    status: Mapped[str] = mapped_column(
        checked_enum("data_request_status", "RECEIVED", "IN_PROGRESS", "COMPLETED", "REJECTED")
    )
    requested_at: Mapped[datetime] = created_at()
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
