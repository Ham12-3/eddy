"""Accounts and access. Auth.js's user, account, session and verification token models, in our
schema with UUID ids and snake_case columns; M8 adds an Auth.js adapter for it (ADR-0023).
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from eddy_api.db.base import Base, checked_enum, created_at, uuid_pk
from eddy_api.db.models.curriculum import BOARDS, TIERS

USER_ROLES = ("student", "parent", "admin")


class User(Base):
    __tablename__ = "users"
    __table_args__ = (Index("uq_users_email_lower", func.lower(text("email")), unique=True),)

    id: Mapped[uuid.UUID] = uuid_pk()
    email: Mapped[str] = mapped_column(String(320))
    email_verified: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # A first name only, optional; never sent to any model (SPEC.md section 10).
    name: Mapped[str | None] = mapped_column(String(80))
    role: Mapped[str] = mapped_column(checked_enum("user_role", *USER_ROLES))
    created_at: Mapped[datetime] = created_at()
    deactivated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Account(Base):
    __tablename__ = "accounts"
    __table_args__ = (UniqueConstraint("provider", "provider_account_id"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    type: Mapped[str] = mapped_column(String(32))
    provider: Mapped[str] = mapped_column(String(64))
    provider_account_id: Mapped[str] = mapped_column(String(255))
    # Sign-in is by email link only, so no OAuth access, refresh or id tokens are ever stored.
    expires_at: Mapped[int | None] = mapped_column(Integer)
    token_type: Mapped[str | None] = mapped_column(String(32))
    scope: Mapped[str | None] = mapped_column(Text)
    session_state: Mapped[str | None] = mapped_column(Text)


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = uuid_pk()
    # SHA-256 of the session token, never the token itself (the M8 adapter hashes it).
    session_token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    expires: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class VerificationToken(Base):
    __tablename__ = "verification_token"

    identifier: Mapped[str] = mapped_column(String(320), primary_key=True)
    token: Mapped[str] = mapped_column(String(255), primary_key=True)
    expires: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class StudentProfile(Base):
    """Only what the tutor needs: birth month and year (not the day), board, tier and goals.

    The row is made with the account, from the age check (ADR-0032); board, tier and target grade
    arrive at set-up, which `setup_completed_at` marks.
    """

    __tablename__ = "student_profile"
    __table_args__ = (
        CheckConstraint("birth_month BETWEEN 1 AND 12", name="birth_month"),
        CheckConstraint("target_grade BETWEEN 1 AND 9", name="target_grade"),
        CheckConstraint("board IS NULL OR board <> 'DFE'", name="board_not_dfe"),
        CheckConstraint(
            "setup_completed_at IS NULL"
            " OR (board IS NOT NULL AND tier IS NOT NULL AND target_grade IS NOT NULL)",
            name="setup_complete",
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    birth_year: Mapped[int] = mapped_column(SmallInteger)
    birth_month: Mapped[int] = mapped_column(SmallInteger)
    board: Mapped[str | None] = mapped_column(checked_enum("profile_board", *BOARDS))
    tier: Mapped[str | None] = mapped_column(checked_enum("profile_tier", *TIERS))
    exam_series: Mapped[str | None] = mapped_column(String(32))
    target_grade: Mapped[int | None] = mapped_column(SmallInteger)
    is_resitter: Mapped[bool] = mapped_column(Boolean, default=False)
    preferences: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    setup_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    diagnostic_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class PendingSignup(Base):
    """Someone who passed the age check and asked for a sign-up link (ADR-0032).

    Nothing is stored for anyone under 13. The row is hard-deleted when the account is made, and
    the purge job deletes it once it expires, so an email that never signs up is not kept.
    """

    __tablename__ = "pending_signup"
    __table_args__ = (
        Index("uq_pending_signup_email_lower", func.lower(text("email")), unique=True),
        CheckConstraint("birth_month BETWEEN 1 AND 12", name="birth_month"),
        # A student comes with an invite and an age check; a parent with a child's link code
        # (ADR-0033).
        CheckConstraint(
            "(role = 'student' AND invite_code IS NOT NULL AND birth_year IS NOT NULL"
            " AND birth_month IS NOT NULL)"
            " OR (role = 'parent' AND link_code_id IS NOT NULL)",
            name="role_needs",
        ),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    email: Mapped[str] = mapped_column(String(320))
    role: Mapped[str] = mapped_column(
        checked_enum("pending_role", "student", "parent"), server_default="student"
    )
    invite_code: Mapped[str | None] = mapped_column(
        ForeignKey("invite_code.code", ondelete="CASCADE"), index=True
    )
    link_code_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("parent_link_code.id", ondelete="CASCADE"), index=True
    )
    birth_year: Mapped[int | None] = mapped_column(SmallInteger)
    birth_month: Mapped[int | None] = mapped_column(SmallInteger)
    created_at: Mapped[datetime] = created_at()
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class ParentLinkCode(Base):
    """A code a student gives a parent, as a link or typed in (ADR-0033). Only its hash is kept;
    it lasts 7 days and works once. A new code replaces the student's old one."""

    __tablename__ = "parent_link_code"

    id: Mapped[uuid.UUID] = uuid_pk()
    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True
    )
    code_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = created_at()
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class InviteRedemption(Base):
    """Which invite an account came in by (a closed beta or a school pilot cohort)."""

    __tablename__ = "invite_redemption"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    invite_code: Mapped[str] = mapped_column(ForeignKey("invite_code.code"), index=True)
    redeemed_at: Mapped[datetime] = created_at()


class InviteCode(Base):
    __tablename__ = "invite_code"
    __table_args__ = (
        CheckConstraint("used_count <= max_uses", name="uses"),
        CheckConstraint("used_count >= 0", name="used_count"),
        CheckConstraint("max_uses >= 1", name="max_uses"),
    )

    code: Mapped[str] = mapped_column(String(32), primary_key=True)
    cohort: Mapped[str] = mapped_column(String(64))
    max_uses: Mapped[int] = mapped_column(Integer)
    used_count: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created_at()


class ParentLink(Base):
    """A parent's view of a student's progress, only ever with the student's agreement."""

    __tablename__ = "parent_link"
    __table_args__ = (
        Index(
            "uq_parent_link_active",
            "student_id",
            "parent_user_id",
            unique=True,
            postgresql_where=text("status <> 'ENDED'"),
        ),
        CheckConstraint("student_id <> parent_user_id", name="not_self"),
        # The timestamps must agree with the status.
        CheckConstraint(
            "(status <> 'REQUESTED' OR accepted_at IS NULL)"
            " AND (status <> 'ACTIVE' OR accepted_at IS NOT NULL)"
            " AND (status <> 'ENDED' OR (ended_at IS NOT NULL AND ended_by IS NOT NULL))",
            name="status_timestamps",
        ),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    parent_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(
        checked_enum("parent_link_status", "REQUESTED", "ACTIVE", "ENDED")
    )
    requested_by: Mapped[str] = mapped_column(
        checked_enum("parent_link_requester", "STUDENT", "PARENT")
    )
    created_at: Mapped[datetime] = created_at()
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_by: Mapped[str | None] = mapped_column(
        checked_enum("parent_link_ender", "STUDENT", "PARENT", "ADMIN")
    )
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class NoticeAcknowledgement(Base):
    __tablename__ = "notice_acknowledgement"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    notice_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    version: Mapped[str] = mapped_column(String(16), primary_key=True)
    acknowledged_at: Mapped[datetime] = created_at()
