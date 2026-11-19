"""Privacy and safeguarding jobs (SPEC.md section 6.7, ADR-0032).

`python -m eddy_api.jobs purge` deletes what has expired:
- sign-in links, pending sign-ups and sessions past their expiry;
- tutor message text older than TUTOR_MESSAGE_DAYS (the row stays, with its text removed and
  `content_deleted_at` set), and the LangGraph checkpoints of lessons that old.

`python -m eddy_api.jobs alerts` emails the safeguarding lead about each safeguarding event and
SAFETY concern not yet notified. The email carries ids, severity and time only, never
the student's words: the reviewer reads those in Eddy.

`python -m eddy_api.jobs all` runs both. They run as the runtime role and are safe to repeat.
The retention of safeguarding events and the audit log waits for the DPIA (ADR-0024), so
neither is purged here.
"""

import argparse
import logging
import smtplib
import sys
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from urllib.parse import urlparse

from sqlalchemy import delete, select, text, update
from sqlalchemy.orm import Session

from eddy_api.config import Settings, get_settings
from eddy_api.db.models import (
    ConcernReport,
    PendingSignup,
    SafeguardingEvent,
    TutorMessage,
    TutorSession,
    VerificationToken,
)
from eddy_api.db.models import Session as SessionRow
from eddy_api.db.session import session_factory

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PurgeReport:
    links: int
    pending_signups: int
    sessions: int
    messages: int
    checkpointed_lessons: int


def _count(result: object) -> int:
    return int(getattr(result, "rowcount", 0) or 0)


def purge(session: Session, settings: Settings, now: datetime | None = None) -> PurgeReport:
    now = now or datetime.now(UTC)
    links = session.execute(delete(VerificationToken).where(VerificationToken.expires < now))
    pending = session.execute(delete(PendingSignup).where(PendingSignup.expires_at < now))
    sessions = session.execute(delete(SessionRow).where(SessionRow.expires < now))
    cutoff = now - timedelta(days=settings.tutor_message_days)
    messages = session.execute(
        update(TutorMessage)
        .where(TutorMessage.created_at < cutoff, TutorMessage.content.is_not(None))
        .values(content=None, content_deleted_at=now)
    )
    old = [
        str(lesson)
        for lesson in session.scalars(
            select(TutorSession.id).where(TutorSession.started_at < cutoff)
        )
    ]
    # Only lessons that still have checkpoints count, so the report does not grow for ever.
    lessons = 0
    for table in ("checkpoint_writes", "checkpoint_blobs", "checkpoints"):
        if old:
            result = session.execute(
                text(f"DELETE FROM {table} WHERE thread_id = ANY(:ids) RETURNING thread_id"),  # noqa: S608 (fixed names)
                {"ids": old},
            )
            if table == "checkpoints":
                lessons = len({row[0] for row in result})
    session.commit()
    return PurgeReport(
        links=_count(links),
        pending_signups=_count(pending),
        sessions=_count(sessions),
        messages=_count(messages),
        checkpointed_lessons=lessons,
    )


def _send(settings: Settings, subject: str, body: str) -> None:
    url = urlparse(settings.smtp_url)
    message = EmailMessage()
    message["From"] = settings.mail_from
    message["To"] = settings.safeguarding_alert_email
    message["Subject"] = subject
    message.set_content(body)
    host = url.hostname or "127.0.0.1"
    if url.scheme == "smtps":
        # Implicit TLS (port 465).
        with smtplib.SMTP_SSL(host, url.port or 465, timeout=10) as smtp:
            if url.username:
                smtp.login(url.username, url.password or "")
            smtp.send_message(message)
        return
    with smtplib.SMTP(host, url.port or 25, timeout=10) as smtp:
        if url.username:
            # Credentials only ever travel over TLS.
            smtp.starttls()
            smtp.login(url.username, url.password or "")
        smtp.send_message(message)


def alerts(session: Session, settings: Settings) -> int:
    """Emails one alert per unnotified event or SAFETY concern. Returns how many were sent."""
    if not settings.safeguarding_alert_email:
        logger.warning("SAFEGUARDING_ALERT_EMAIL is not set: no safeguarding alerts were sent")
        return 0
    sent = 0
    party = f"email:{settings.safeguarding_alert_email}"[:128]
    for event in session.scalars(
        select(SafeguardingEvent).where(SafeguardingEvent.notified_party.is_(None))
    ):
        _send(
            settings,
            f"Eddy safeguarding: {event.severity} event to review",
            "A safeguarding event needs review in Eddy.\n\n"
            f"Event: {event.id}\nSeverity: {event.severity}\n"
            f"Raised: {event.created_at:%d %B %Y %H:%M} UTC\n\n"
            "The student's words are in Eddy's safeguarding queue, not in this email.\n",
        )
        event.notified_party = party
        session.commit()
        sent += 1
    for concern in session.scalars(
        select(ConcernReport).where(
            ConcernReport.notified_party.is_(None), ConcernReport.category == "SAFETY"
        )
    ):
        _send(
            settings,
            "Eddy safeguarding: a student reported a safety concern",
            "A student reported a safety concern in Eddy.\n\n"
            f"Report: {concern.id}\nReported: {concern.created_at:%d %B %Y %H:%M} UTC\n\n"
            "Read it in Eddy's safeguarding queue.\n",
        )
        concern.notified_party = party
        session.commit()
        sent += 1
    return sent


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m eddy_api.jobs", description=__doc__)
    parser.add_argument("job", choices=["purge", "alerts", "all"])
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO)
    settings = get_settings()
    with session_factory()() as session:
        if args.job in ("purge", "all"):
            print(purge(session, settings))
        if args.job in ("alerts", "all"):
            print(f"alerts sent: {alerts(session, settings)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
