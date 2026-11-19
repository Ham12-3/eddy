"""Safeguarding (SPEC.md sections 9.1 and 9.2, steps 2 and 4).

A tripwire phrase, the input classifier finding a concern (or refusing to classify), or the tutor
model flagging a concern stops tutoring for the session. The student sees a static script, never
model-written text, with UK support lines, and a `safeguarding_event` is recorded for Eddy's named
safeguarding lead. Parents are not told automatically, because a parent may be the source of risk.

The phrase list (config/safeguarding/tripwires.yaml) and the script below are DRAFTS. They must be
approved by Eddy's named safeguarding lead before any real student uses the tutor (PLAN.md
approval gate). `SCRIPT_APPROVED` records that; until it is True the tutor runs only in
development and test (routes/tutor.py). Events wait in the table for review;
the alerts job (`eddy_api.jobs.alerts`, run by the worker every 15 minutes) emails the lead an
alert with ids only and sets `notified_party` (ADR-0032, ADR-0034).
"""

import logging
import re
import unicodedata
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import lru_cache
from typing import Any, Literal

import yaml
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from eddy_api.db.models import SafeguardingEvent, TutorSession
from eddy_api.llm.config import REPO_ROOT

logger = logging.getLogger(__name__)
TRIPWIRES = REPO_ROOT / "config" / "safeguarding" / "tripwires.yaml"
Severity = Literal["LOW", "MEDIUM", "HIGH", "IMMEDIATE"]
Source = Literal["tripwire", "classifier", "classifier_refusal", "tutor", "after_script"]
SEVERITY_ORDER: dict[str, int] = {"IMMEDIATE": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}

#: Set to True only when Eddy's named safeguarding lead has approved this exact text.
SCRIPT_APPROVED = False
SCRIPT_VERSION = "draft-1"
SCRIPT = (
    "I am going to stop the maths here, because what you have said matters more. "
    "I am an AI, so I cannot help with this myself, but people can, right now.\n\n"
    "Childline: call 0800 1111 for free, any time, or talk to them online at childline.org.uk.\n"
    "Shout: text SHOUT to 85258 for free, any time.\n"
    "If you are in danger or hurt, call 999.\n\n"
    "You could also talk to a teacher, your school nurse or another adult you trust. "
    "You did the right thing by saying something."
)
MAX_EXCERPT = 280

# Letters from other alphabets that look like Latin ones, folded before matching (Cyrillic and
# Greek); NFKC already folds full-width and styled letters.
CONFUSABLES = {
    0x0430: "a", 0x0435: "e", 0x043E: "o", 0x0440: "p", 0x0441: "c", 0x0443: "y", 0x0445: "x",
    0x0456: "i", 0x0458: "j", 0x0455: "s", 0x04BB: "h", 0x0501: "d", 0x0410: "a", 0x0415: "e",
    0x041E: "o", 0x0420: "p", 0x0421: "c", 0x0425: "x", 0x0406: "i", 0x0405: "s", 0x03BF: "o",
    0x03B1: "a", 0x03B9: "i", 0x03BD: "v", 0x03C1: "p", 0x03C4: "t", 0x03BA: "k", 0x039F: "o",
}  # fmt: skip
SPACED_LETTERS = re.compile(r"\b(?:[a-z0-9] ){2,}[a-z0-9]\b")
SELF = re.compile(r"\b(my|your|him|her|them|our) (self|selves)\b")


@dataclass(frozen=True)
class Tripwire:
    category: str
    severity: Severity
    phrase: str


def normalise(text: str) -> str:
    """Text as the tripwires read it: NFKC, no invisible characters, look-alike letters folded,
    lower case, no punctuation or apostrophes, single spaces, spaced-out letters joined."""
    folded = unicodedata.normalize("NFKC", text)
    folded = "".join(c for c in folded if unicodedata.category(c) != "Cf")
    folded = folded.translate(CONFUSABLES).lower().replace(chr(0x2019), "'").replace("'", "")
    clean = re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", folded)).strip()
    clean = SPACED_LETTERS.sub(lambda m: m.group().replace(" ", ""), clean)
    return SELF.sub(lambda m: m.group(1) + m.group(2), clean)


@lru_cache
def _patterns() -> tuple[tuple[re.Pattern[str], str, Severity, str], ...]:
    raw = yaml.safe_load(TRIPWIRES.read_bytes())
    patterns = []
    for category, spec in raw["categories"].items():
        for phrase in spec["phrases"]:
            # "im in danger !of": the words after "!" must not follow ("in danger of failing").
            text, *excluded = str(phrase).split(" !")
            wildcard = text.endswith("*")
            words = normalise(text.rstrip("*"))
            ending = r"\w*\b" if wildcard else r"\b"
            not_followed = "".join(rf"(?! {re.escape(normalise(w))}\b)" for w in excluded)
            pattern = re.compile(rf"\b{re.escape(words)}{ending}{not_followed}")
            patterns.append((pattern, category, spec["severity"], text))
    return tuple(patterns)


def tripwire(text: str) -> Tripwire | None:
    """The most severe phrase the text contains, or None."""
    clean = normalise(text)
    hits = [
        Tripwire(category, severity, phrase)
        for pattern, category, severity, phrase in _patterns()
        if pattern.search(clean)
    ]
    return min(hits, key=lambda hit: SEVERITY_ORDER[hit.severity]) if hits else None


def strings_in(value: Any) -> list[str]:
    """Every string inside a JSON value (an answer's MathJSON can carry text too)."""
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [s for v in value for s in strings_in(v)]
    if isinstance(value, dict):
        return [s for v in value.values() for s in strings_in(v)]
    return []


def more_severe(first: Tripwire, second: Tripwire | None) -> Tripwire:
    if second is None:
        return first
    return min((first, second), key=lambda hit: SEVERITY_ORDER[hit.severity])


def excerpt(text: str, phrase: str | None = None) -> str:
    """Only as much of the student's words as the reviewer needs, centred on what matched."""
    flat = " ".join(text.split())
    if len(flat) <= MAX_EXCERPT:
        return flat
    at = flat.lower().find(phrase.rstrip("*").lower()) if phrase else -1
    start = 0 if at < 0 else max(0, min(at - MAX_EXCERPT // 2, len(flat) - MAX_EXCERPT + 3))
    cut = flat[start : start + MAX_EXCERPT - 3]
    return ("..." if start else "") + cut + ("..." if start + len(cut) < len(flat) else "")


def record_event(
    session: Session,
    *,
    student_id: uuid.UUID,
    tutor_session_id: uuid.UUID | None,
    concern: Tripwire,
    text: str,
    source: Source,
) -> SafeguardingEvent:
    event = SafeguardingEvent(
        student_id=student_id,
        tutor_session_id=tutor_session_id,
        category=concern.category,
        severity=concern.severity,
        excerpt=excerpt(text, concern.phrase if source == "tripwire" else None),
        action_taken=(
            f"Tutoring stopped; safeguarding script {SCRIPT_VERSION} shown ({source}). "
            "Awaiting review by the safeguarding lead."
        ),
        # Set by the alerts job once an alert has really been sent (eddy_api.jobs).
        notified_party=None,
    )
    session.add(event)
    session.flush()
    return event


def raise_concern(
    session: Session,
    *,
    tutor_session: TutorSession,
    concern: Tripwire,
    text: str,
    source: Source,
    durable: Callable[[], Session] | None = None,
) -> None:
    """Records the event and ends the tutor session. The caller shows `SCRIPT`.

    With `durable`, the event is written and committed in its own transaction first, so it
    survives even if the rest of the turn fails.
    """
    written = False
    if durable is not None:
        try:
            with durable() as own:
                record_event(
                    own,
                    student_id=tutor_session.student_id,
                    tutor_session_id=tutor_session.id,
                    concern=concern,
                    text=text,
                    source=source,
                )
                own.commit()
            written = True
        except SQLAlchemyError:
            # The lesson or student is not committed yet (or the database is busy): record it
            # with the rest of the turn instead.
            logger.warning("Safeguarding event written with the turn, not on its own")
    if not written:
        record_event(
            session,
            student_id=tutor_session.student_id,
            tutor_session_id=tutor_session.id,
            concern=concern,
            text=text,
            source=source,
        )
    if tutor_session.ended_at is None:
        tutor_session.ended_at = datetime.now(UTC)
    tutor_session.end_reason = "SAFEGUARDING"
    session.flush()


def classifier_severity(level: str) -> Severity:
    return "IMMEDIATE" if level == "immediate" else "HIGH"


__all__ = [
    "SCRIPT",
    "SCRIPT_APPROVED",
    "SCRIPT_VERSION",
    "Tripwire",
    "classifier_severity",
    "excerpt",
    "more_severe",
    "normalise",
    "raise_concern",
    "record_event",
    "strings_in",
    "tripwire",
]
