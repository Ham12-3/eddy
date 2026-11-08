"""Node mastery: status, aided attempts, prerequisite propagation and the two-failure rule.

SPEC.md 7.1, made precise in ADR-0026:

- SECURE needs p_mastery >= 0.95 and at least 3 correct, unaided attempts spread over at least
  2 sessions on at least 2 different days (UK dates, and at least 8 hours from the first to the
  last), and no open misconception on the node. A correct answer the student rated 1 out of 4
  for confidence ("I guessed") updates BKT but does not count towards the 3.
- Coverage: SECURE also needs, for each misconception an item on the node can reveal
  (`to_probe`, from probe_codes), at least 2 counted correct answers on items that could have
  revealed it, since it last showed itself. A misconception the items never tested cannot hide
  behind correct answers to other kinds of question. The codes are curriculum data, so callers
  pass them in rather than the state carrying them.
- A node only becomes SECURE on a counted correct answer (or when a misconception on it closes),
  never on a guess or with help.
- When a known misconception shows itself on a node, the node's run of counted correct answers
  starts again.
- A secured node (SECURE or NEEDS_REVIEW) becomes NEEDS_REVIEW when its review falls due, after
  2 wrong answers in a row in one session that no misconception explains (a lapse), when
  p_mastery drops below 0.80, or when a misconception on it opens. A review that has fallen
  due, or a lapse, stays owed until a counted correct answer. The node returns to SECURE by the
  same test as before.
- Aided attempts update BKT at half weight and never count towards the 3.
- Two failures in a row in one session, not explained by a misconception the answer matched,
  trigger a short prerequisite diagnostic, at most once per node per session.
- When a node becomes SECURE, each prerequisite not yet secured gets a prior boost in
  proportion to the edge strength, capped so that propagation alone never makes it SECURE.

Attempt times must be timezone-aware.
"""

from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from eddy_api.learner import bkt

Status = Literal["UNSEEN", "LEARNING", "SECURE", "NEEDS_REVIEW"]
SECURED: frozenset[Status] = frozenset({"SECURE", "NEEDS_REVIEW"})

SECURE_P = 0.95
# Hysteresis: a SECURE node only drops back once mastery falls well below the bar.
REVIEW_P = 0.80
UNAIDED_CORRECT_NEEDED = 3
SESSIONS_NEEDED = 2
DAYS_NEEDED = 2
# "Different days" means UK calendar dates, at least this far apart, so two sittings either
# side of midnight do not count as spacing.
UK = ZoneInfo("Europe/London")
MIN_SPREAD = timedelta(hours=8)
AIDED_WEIGHT = 0.5
# Confidence 1 out of 4 means "I guessed".
GUESSED = 1
FAILURES_FOR_DIAGNOSTIC = 2
PROPAGATION_RATE = 0.5
MAX_BOOST = 0.3
# Propagation never lifts a prerequisite above this: only its own evidence can make it SECURE.
PROPAGATION_CEILING = 0.9
PROBES_NEEDED = 2


@dataclass(frozen=True)
class Attempt:
    """What the learner model needs from one attempt (the `attempt` table holds the rest)."""

    node: str
    correct: bool
    at: datetime
    session: str
    aided: bool = False
    # Answers to choose from on a choice item; None for a free answer.
    options: int | None = None
    # Self-rated confidence, 1 to 4, given before the answer is marked.
    confidence: int | None = None
    # A wrong answer that matched a misconception strongly enough to open it (not a weak first
    # choice, see misconceptions.restarts_run): remediation deals with it, so it does not count
    # towards the prerequisite diagnostic or a lapse.
    explained: bool = False
    # Misconception codes this item could have revealed: the misconceptions of the generated
    # item's own distractors (a template drops a rule that gives no distinct wrong answer for
    # the numbers drawn), plus the template's structure codes. The same test decides whether a
    # correct answer is a clean re-check.
    could_reveal: tuple[str, ...] = ()


@dataclass(frozen=True)
class NodeMastery:
    node: str
    p_mastery: float = bkt.DEFAULT.p_init
    params: bkt.BktParams = bkt.DEFAULT
    status: Status = "UNSEEN"
    evidence_count: int = 0
    # (session, time) of each counted correct answer: unaided, and not a guess.
    unaided_correct: tuple[tuple[str, datetime], ...] = ()
    # Failures in a row in the current session that no misconception explains.
    consecutive_failures: int = 0
    last_session: str | None = None
    # The session in which the prerequisite diagnostic last ran for this node.
    diagnosed_in: str | None = None
    # A review fell due, or the node lapsed: owed until a counted correct answer.
    review_pending: bool = False
    # How often each misconception has been passed since it last showed itself: a counted
    # correct answer on an item that could have revealed it.
    probes: tuple[tuple[str, int], ...] = ()

    def probe_count(self, code: str) -> int:
        return dict(self.probes).get(code, 0)

    @property
    def recent_correct(self) -> tuple[tuple[str, datetime], ...]:
        """The last 3 counted correct answers: the spacing test applies to these, not to every
        correct answer ever given, so old lucky guesses cannot supply the spacing."""
        return self.unaided_correct[-UNAIDED_CORRECT_NEEDED:]

    @property
    def unaided_spread(self) -> tuple[int, int, int]:
        """(recent counted correct answers, distinct sessions, distinct UK dates)."""
        recent = self.recent_correct
        sessions = {session for session, _ in recent}
        days = {at.astimezone(UK).date() for _, at in recent}
        return len(recent), len(sessions), len(days)

    @property
    def unaided_span(self) -> timedelta:
        times = [at for _, at in self.recent_correct]
        return max(times) - min(times) if times else timedelta(0)


def probe_codes(
    node_codes: Iterable[str], template_codes: Iterable[Iterable[str]]
) -> tuple[str, ...]:
    """The node's misconceptions that SECURE must test: those some item template on the node
    can reveal. A misconception only the classifier can spot has no such item, so it cannot
    block SECURE; correct answers on its re-check family close it instead."""
    revealable = {code for codes in template_codes for code in codes}
    return tuple(sorted(set(node_codes) & revealable))


def meets_secure_bar(
    state: NodeMastery, open_misconception: bool, to_probe: Collection[str]
) -> bool:
    count, sessions, days = state.unaided_spread
    return (
        state.p_mastery >= SECURE_P
        and count >= UNAIDED_CORRECT_NEEDED
        and sessions >= SESSIONS_NEEDED
        and days >= DAYS_NEEDED
        and state.unaided_span >= MIN_SPREAD
        and not open_misconception
        and all(state.probe_count(code) >= PROBES_NEEDED for code in to_probe)
    )


def _status(state: NodeMastery, open_misconception: bool, to_probe: Collection[str]) -> Status:
    if state.evidence_count == 0:
        return "UNSEEN"
    secured = state.status in SECURED
    if secured and (state.review_pending or open_misconception):
        return "NEEDS_REVIEW"
    if meets_secure_bar(state, open_misconception, to_probe):
        return "SECURE"
    if state.status == "SECURE" and state.p_mastery >= REVIEW_P:
        return "SECURE"  # still above the lower bar: one slip does not undo it
    return "NEEDS_REVIEW" if secured else "LEARNING"


def _counts(attempt: Attempt) -> bool:
    return attempt.correct and not attempt.aided and attempt.confidence != GUESSED


def record(
    state: NodeMastery,
    attempt: Attempt,
    *,
    to_probe: Collection[str],
    open_misconception: bool = False,
) -> NodeMastery:
    """The node's mastery after one attempt on it. `to_probe` is the node's probe_codes."""
    if attempt.node != state.node:
        raise ValueError(f"attempt on {attempt.node} recorded against {state.node}")
    if attempt.at.tzinfo is None:
        raise ValueError("attempt times must be timezone-aware")
    if attempt.confidence is not None and not 1 <= attempt.confidence <= 4:
        raise ValueError("confidence runs from 1 to 4")
    p = bkt.update(
        state.p_mastery,
        attempt.correct,
        state.params,
        weight=AIDED_WEIGHT if attempt.aided else 1.0,
        options=attempt.options,
    )
    counted = _counts(attempt)
    unaided = state.unaided_correct
    probes = dict(state.probes)
    if counted:
        unaided = (*unaided, (attempt.session, attempt.at))
        for code in attempt.could_reveal:
            probes[code] = probes.get(code, 0) + 1
    failures = state.consecutive_failures if attempt.session == state.last_session else 0
    if attempt.correct:
        failures = 0
    elif not attempt.explained:
        failures += 1
    lapsed = state.status in SECURED and failures >= FAILURES_FOR_DIAGNOSTIC
    updated = replace(
        state,
        p_mastery=p,
        evidence_count=state.evidence_count + 1,
        unaided_correct=unaided,
        probes=tuple(sorted(probes.items())),
        consecutive_failures=failures,
        last_session=attempt.session,
        review_pending=(state.review_pending and not counted) or lapsed,
    )
    status = _status(updated, open_misconception, to_probe)
    if status == "SECURE" and state.status != "SECURE" and not counted:
        status = state.status  # a guess or a helped answer never secures a node
    return replace(updated, status=status)


def refresh(
    state: NodeMastery, *, to_probe: Collection[str], open_misconception: bool
) -> NodeMastery:
    """Re-test the status when a misconception on the node opens or closes."""
    return replace(state, status=_status(state, open_misconception, to_probe))


def misconception_seen(state: NodeMastery, code: str) -> NodeMastery:
    """A known misconception showed itself on this node (see misconceptions.restarts_run).
    The run of counted correct answers, and that misconception's
    probes, start again, so a few lucky answers between slips cannot add up to SECURE."""
    probes = {k: v for k, v in state.probes if k != code}
    return replace(state, unaided_correct=(), probes=tuple(sorted(probes.items())))


def review_due(state: NodeMastery) -> NodeMastery:
    """A secured node whose FSRS review has fallen due needs review until it is answered
    correctly without help."""
    if state.status in SECURED:
        return replace(state, status="NEEDS_REVIEW", review_pending=True)
    return state


def needs_prerequisite_diagnostic(state: NodeMastery) -> bool:
    return (
        state.consecutive_failures >= FAILURES_FOR_DIAGNOSTIC
        and state.diagnosed_in != state.last_session
    )


def prerequisite_diagnostic(
    model: Mapping[str, NodeMastery],
    prerequisites: Sequence[tuple[str, float]],
    *,
    retrievability: Mapping[str, float] | None = None,
    practisable: Iterable[str] | None = None,
) -> list[str]:
    """The node's direct prerequisites to probe after two failures, in order.

    Those not yet secured come first, lowest mastery first (SPEC.md 7.1); then secured ones,
    the least likely to be remembered first (FSRS retrievability where given, else mastery).
    Ties go to the stronger edge. Prerequisites with no items cannot be probed and are left
    out. The diagnostic walks up one level at a time: if the student fails a prerequisite, the
    tutor loop runs it again from there.
    """
    recall = retrievability or {}
    allowed = None if practisable is None else set(practisable)
    rows: list[tuple[int, float, float, str]] = []
    for code, strength in prerequisites:
        if allowed is not None and code not in allowed:
            continue
        state = model.get(code) or NodeMastery(node=code)
        if state.status in SECURED:
            rows.append((1, recall.get(code, state.p_mastery), -strength, code))
        else:
            rows.append((0, state.p_mastery, -strength, code))
    return [row[-1] for row in sorted(rows)]


def start_diagnostic(state: NodeMastery) -> NodeMastery:
    """The diagnostic has been offered: it will not be offered again for this node this
    session."""
    return replace(state, consecutive_failures=0, diagnosed_in=state.last_session)


def boost_prerequisites(
    model: Mapping[str, NodeMastery],
    prerequisites: Sequence[tuple[str, float]],
) -> dict[str, NodeMastery]:
    """Raise the prior of each prerequisite not yet secured, after a node becomes SECURE."""
    boosted = dict(model)
    for code, strength in prerequisites:
        state = boosted.get(code, NodeMastery(node=code))
        if state.status in SECURED or state.p_mastery >= PROPAGATION_CEILING:
            continue
        gain = min(MAX_BOOST, PROPAGATION_RATE * strength) * (1 - state.p_mastery)
        boosted[code] = replace(state, p_mastery=min(PROPAGATION_CEILING, state.p_mastery + gain))
    return boosted
