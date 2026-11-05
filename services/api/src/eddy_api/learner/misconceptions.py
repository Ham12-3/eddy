"""The misconception state machine (SPEC.md 7.1) and the remediation queue.

SUSPECTED (one match, or the classifier) -> CONFIRMED (a second match) -> REMEDIATED (scene and
follow-up done) -> RECHECKED_OK, or RECURRED when the same mistake comes back. A recurrence is
remediated with a different scene variant. A match in a diagnostic only suspects a
misconception it has not seen before (SPEC.md 4.1); it confirms one already suspected.

How strong the evidence is (ADR-0026):

- A free answer that equals the misconception's wrong answer is a `rule_match`.
- Picking the distractor on a choice item is a `choice_match` unless the student was confident
  (3 or 4 out of 4). With two options every wrong answer is the distractor, so one unsure pick
  is a slip as often as a misconception. When it is the first sign of that misconception it
  leaves only a weak suspicion: not open, not queued for a scene, and the node's run of correct
  answers carries on. From then on a choice match counts like a rule match.
- The classifier (Haiku fallback) can only ever make a misconception SUSPECTED; it never
  confirms one or reopens one. On a weak suspicion it is the second sign, so the suspicion
  becomes a real one.
- Matches other than the classifier's confirm, reopen and restart the node's run of correct
  answers (`restarts_run`).

Closing a misconception takes evidence: 3 clean re-checks (correct answers on items that could
have revealed it, or on its re-check family when no item can) since the last match, 2 more for
each further match, up to 9, and at least one of them in a later session than the scene. A
student who makes the mistake only some of the time therefore cannot close it with a lucky
answer or two, nor straight after watching the scene.

A misconception that is SUSPECTED (not weak), CONFIRMED, REMEDIATED (not yet rechecked) or
RECURRED is open, and an open misconception keeps its node from SECURE.
"""

from collections.abc import Iterable
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Literal

Status = Literal["SUSPECTED", "CONFIRMED", "REMEDIATED", "RECHECKED_OK", "RECURRED"]
Event = Literal[
    "rule_match", "choice_match", "classifier", "diagnostic_match", "remediated", "recheck_passed"
]

OPEN: frozenset[Status] = frozenset({"SUSPECTED", "CONFIRMED", "REMEDIATED", "RECURRED"})
MATCHES: frozenset[Event] = frozenset(
    {"rule_match", "choice_match", "classifier", "diagnostic_match"}
)
# Matches that count towards CONFIRMED and RECURRED (a weak first choice match aside).
COUNTED: frozenset[Event] = frozenset({"rule_match", "choice_match", "diagnostic_match"})
FIRST_RECHECKS = 3
RECHECK_GROWTH = 2
MAX_RECHECKS = 9
SURE = 3  # confidence 3 or 4 out of 4


class InvalidTransitionError(ValueError):
    """The event cannot happen in the current state; the tutor loop has a bug."""


@dataclass(frozen=True)
class Track:
    code: str
    node: str
    status: Status
    evidence: tuple[str, ...] = ()
    last_seen: datetime | None = None
    # How many times a scene has been shown for it: the next scene uses a different variant.
    remediations: int = 0
    # Wrong while confident (3 or 4 out of 4): goes to the front of the remediation queue
    # until the misconception is closed.
    confident_wrong: bool = False
    # Rule or diagnostic matches so far, and clean re-checks since the last match of any kind.
    matches: int = 0
    clean_rechecks: int = 0
    # Only an unsure choice so far: noted, but not open and not queued.
    weak: bool = False
    # The session the last scene was shown in, and whether a clean re-check has come since in
    # a later session.
    remediated_in: str | None = None
    rechecked_later: bool = False


def match_event(*, options: int | None, confidence: int | None, diagnostic: bool = False) -> Event:
    """The event for an answer that matched a misconception rule."""
    if options is not None and (confidence is None or confidence < SURE):
        return "choice_match"
    return "diagnostic_match" if diagnostic else "rule_match"


def restarts_run(event: Event, track: Track) -> bool:
    """Whether the node's run of counted correct answers starts again after this event
    (mastery.misconception_seen). `track` is the track after the event."""
    return event in COUNTED and not track.weak


def rechecks_needed(track: Track) -> int:
    """Clean re-checks that close the misconception: 3, then 5, 7 and 9."""
    return min(MAX_RECHECKS, FIRST_RECHECKS + RECHECK_GROWTH * max(0, track.matches - 1))


_TRANSITIONS: dict[Status | None, dict[Event, Status]] = {
    None: {
        "rule_match": "SUSPECTED",
        "choice_match": "SUSPECTED",
        "classifier": "SUSPECTED",
        "diagnostic_match": "SUSPECTED",
    },
    "SUSPECTED": {
        "rule_match": "CONFIRMED",
        "diagnostic_match": "CONFIRMED",
        "choice_match": "CONFIRMED",
        "classifier": "SUSPECTED",
        "remediated": "REMEDIATED",
    },
    "CONFIRMED": {
        "rule_match": "CONFIRMED",
        "diagnostic_match": "CONFIRMED",
        "choice_match": "CONFIRMED",
        "classifier": "CONFIRMED",
        "remediated": "REMEDIATED",
    },
    "REMEDIATED": {
        "recheck_passed": "RECHECKED_OK",
        "rule_match": "RECURRED",
        "diagnostic_match": "RECURRED",
        "choice_match": "RECURRED",
        "classifier": "REMEDIATED",
    },
    "RECHECKED_OK": {
        "rule_match": "RECURRED",
        "diagnostic_match": "RECURRED",
        "choice_match": "RECURRED",
        "classifier": "RECHECKED_OK",
    },
    "RECURRED": {
        "rule_match": "RECURRED",
        "diagnostic_match": "RECURRED",
        "choice_match": "RECURRED",
        "classifier": "RECURRED",
        "remediated": "REMEDIATED",
    },
}


def apply(
    track: Track | None,
    event: Event,
    *,
    code: str,
    node: str,
    at: datetime,
    session: str,
    attempt: str | None = None,
    confident: bool = False,
) -> Track:
    """The misconception's track after one event."""
    if track is not None and (track.code, track.node) != (code, node):
        raise ValueError(f"event for {code} on {node} applied to {track.code} on {track.node}")
    current = track.status if track else None
    following = _TRANSITIONS[current].get(event)
    if following is None:
        raise InvalidTransitionError(f"{event} cannot happen to {code} in state {current}")
    base = track or Track(code=code, node=node, status=following)
    matched = event in MATCHES
    weak = track is None and event == "choice_match"
    clean = 0 if matched else base.clean_rechecks + (1 if event == "recheck_passed" else 0)
    remediated_in: str | None = session if event == "remediated" else base.remediated_in
    if event == "remediated":
        later = False
    else:
        later = not matched and (
            base.rechecked_later or (event == "recheck_passed" and session != remediated_in)
        )
    updated = replace(
        base,
        status=following,
        evidence=(*base.evidence, attempt) if attempt else base.evidence,
        last_seen=at if matched else base.last_seen,
        remediations=base.remediations + (1 if event == "remediated" else 0),
        confident_wrong=(base.confident_wrong or confident) if matched else base.confident_wrong,
        matches=base.matches + (1 if event in COUNTED and not weak else 0),
        clean_rechecks=clean,
        weak=weak,
        remediated_in=remediated_in,
        rechecked_later=later,
    )
    if event == "recheck_passed":
        if clean < rechecks_needed(updated) or not later:
            return replace(updated, status="REMEDIATED")  # not enough evidence yet
        return replace(updated, confident_wrong=False)
    return updated


def is_open(track: Track | None) -> bool:
    return track is not None and track.status in OPEN and not track.weak


def node_has_open(tracks: Iterable[Track], node: str) -> bool:
    return any(t.node == node and is_open(t) for t in tracks)


def scene_variant(track: Track) -> int:
    """0 for the first scene, then a different variant after each recurrence."""
    return track.remediations


def remediation_queue(tracks: Iterable[Track], node: str | None = None) -> list[Track]:
    """Misconceptions to work on now: confident and wrong first, then those on the node the
    student is working on, then the firmest evidence, then the most recent."""
    waiting = [
        t for t in tracks if t.status in ("SUSPECTED", "CONFIRMED", "RECURRED") and not t.weak
    ]
    strength = {"RECURRED": 0, "CONFIRMED": 1, "SUSPECTED": 2}
    return sorted(
        waiting,
        key=lambda t: (
            not t.confident_wrong,
            node is not None and t.node != node,
            strength[t.status],
            -(t.last_seen.timestamp() if t.last_seen else 0.0),
            t.code,
        ),
    )


def awaiting_recheck(tracks: Iterable[Track]) -> list[Track]:
    return [t for t in tracks if t.status == "REMEDIATED"]
