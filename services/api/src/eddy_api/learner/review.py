"""Review scheduling with FSRS (the open-source `fsrs` package), one card per node.

Target retention is 0.9. Cards schedule in days, not the minutes a flashcard app uses for its
learning steps, without fuzzing so a schedule can be reproduced, and never more than 120 days
apart, so nothing goes unseen for most of a school year (ADR-0026). The rating comes from
correctness, confidence, help used and time taken. Times must be timezone-aware; they are
handled in UTC.
"""

from datetime import UTC, datetime

from fsrs import Card, Rating, Scheduler

TARGET_RETENTION = 0.9
MAX_INTERVAL_DAYS = 120
# Seconds per mark a GCSE paper allows, roughly: the yardstick for "quick" and "slow".
SECONDS_PER_MARK = 72

SCHEDULER = Scheduler(
    desired_retention=TARGET_RETENTION,
    learning_steps=(),
    relearning_steps=(),
    maximum_interval=MAX_INTERVAL_DAYS,
    enable_fuzzing=False,
)


def _utc(moment: datetime) -> datetime:
    if moment.tzinfo is None:
        raise ValueError("review times must be timezone-aware")
    return moment.astimezone(UTC)


def rating(
    *,
    correct: bool,
    confidence: int | None,
    hints: int,
    aided: bool,
    time_ms: int,
    marks: int = 1,
    extra_time: float = 1.0,
) -> Rating:
    """Again when wrong, or right but guessed (confidence 1); Hard when help, low confidence
    or a long time was needed; Easy when quick and sure; Good otherwise.

    `extra_time` is the student's exam access arrangement (1.25 for 25% extra time). Time
    should exclude the confidence prompt and time with the tab hidden.
    """
    if not correct or confidence == 1:
        return Rating.Again
    allowed_ms = marks * SECONDS_PER_MARK * 1000 * extra_time
    if aided or hints > 0 or confidence == 2 or time_ms > 2 * allowed_ms:
        return Rating.Hard
    if confidence == 4 and time_ms <= allowed_ms / 2:
        return Rating.Easy
    return Rating.Good


def start_card(grade: Rating, now: datetime) -> Card:
    """A node's card, made when the node becomes SECURE. The answer that secured it is the
    card's first review, so the next review is days away rather than due at once."""
    return review(Card(due=_utc(now)), grade, now)


def review(card: Card, grade: Rating, now: datetime) -> Card:
    updated, _log = SCHEDULER.review_card(card, grade, review_datetime=_utc(now))
    return updated


def retrievability(card: Card, now: datetime) -> float:
    return float(SCHEDULER.get_card_retrievability(card, current_datetime=_utc(now)))


def is_due(card: Card, now: datetime) -> bool:
    return card.due <= _utc(now)
