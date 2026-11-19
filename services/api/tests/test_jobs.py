"""Privacy purges and safeguarding alerts (ADR-0032)."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from eddy_api import jobs
from eddy_api.config import Settings
from eddy_api.db.models import (
    ConcernReport,
    InviteCode,
    PendingSignup,
    SafeguardingEvent,
    TutorMessage,
    TutorSession,
    User,
    VerificationToken,
)


def test_purge_removes_what_has_expired_and_old_message_text(db_session: Session) -> None:
    now = datetime.now(UTC)
    db_session.add(InviteCode(code="X1", cohort="t", max_uses=1))
    db_session.add_all(
        [
            VerificationToken(identifier="a@e.test", token="t" * 20, expires=now - timedelta(1)),
            VerificationToken(identifier="b@e.test", token="u" * 20, expires=now + timedelta(1)),
        ]
    )
    db_session.flush()
    db_session.add(
        PendingSignup(
            email="p@e.test",
            invite_code="X1",
            birth_year=2010,
            birth_month=1,
            expires_at=now - timedelta(hours=1),
        )
    )
    user = User(email="s@e.test", role="student")
    db_session.add(user)
    db_session.flush()
    old = TutorSession(student_id=user.id, started_at=now - timedelta(days=100))
    new = TutorSession(student_id=user.id)
    db_session.add_all([old, new])
    db_session.flush()
    for lesson, age in ((old, 100), (new, 1)):
        db_session.add(
            TutorMessage(
                session_id=lesson.id,
                role="STUDENT",
                content="hello",
                state="REPLY",
                created_at=now - timedelta(days=age),
            )
        )
    db_session.execute(
        text(
            "INSERT INTO checkpoints"
            " (thread_id, checkpoint_ns, checkpoint_id, checkpoint, metadata)"
            " VALUES (:t, '', 'c1', '{}', '{}')"
        ),
        {"t": str(old.id)},
    )
    db_session.flush()

    report = jobs.purge(db_session, Settings())
    assert report.links == 1
    assert report.pending_signups == 1
    assert report.messages == 1
    assert report.checkpointed_lessons == 1
    texts = db_session.scalars(select(TutorMessage.content).order_by(TutorMessage.created_at))
    assert list(texts) == [None, "hello"]
    left = db_session.scalar(text("SELECT count(*) FROM checkpoints"))
    assert left == 0
    assert db_session.scalar(select(func.count()).select_from(VerificationToken)) == 1


def test_alerts_email_ids_never_words(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[tuple[str, str]] = []
    monkeypatch.setattr(jobs, "_send", lambda _s, subject, body: sent.append((subject, body)))
    user = User(email="s2@e.test", role="student")
    db_session.add(user)
    db_session.flush()
    db_session.add(
        SafeguardingEvent(
            student_id=user.id,
            category="self_harm",
            severity="IMMEDIATE",
            excerpt="private words",
            action_taken="script shown",
        )
    )
    db_session.add(ConcernReport(user_id=user.id, category="SAFETY", message="private too"))
    db_session.add(ConcernReport(user_id=user.id, category="CONTENT", message="a typo"))
    db_session.flush()

    assert jobs.alerts(db_session, Settings()) == 0  # no address: nothing sent
    settings = Settings(safeguarding_alert_email="lead@example.test")
    assert jobs.alerts(db_session, settings) == 2
    assert all("private" not in body for _, body in sent)
    assert jobs.alerts(db_session, settings) == 0  # each is notified once
