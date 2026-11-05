"""Synthetic students with hidden mastery and hidden misconceptions (PLAN.md M4).

Each simulated student has a true state the model cannot see: whether they know the node, how
quickly practice teaches them, how often they slip or guess, and optionally a misconception
that produces its own wrong answer on a share of items. The run feeds their answers through the
real learner model, exactly as the tutor loop will, and reports when (if ever) the model called
the node SECURE and whether that was true.

Limits (ADR-0026): one node with one misconception, every item either a free answer or a
choice with the same number of options, 5 items a day every day, no forgetting, no confidence
ratings (so every choice match is an unsure one), and no planner or prerequisites.
"""

import random
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from eddy_api.learner import mastery, misconceptions
from eddy_api.learner.mastery import Attempt, NodeMastery

START = datetime(2026, 9, 7, 16, 0, tzinfo=UTC)
NODE = "S1"
CODE = "SIM_MISCONCEPTION"


@dataclass(frozen=True)
class Student:
    learn: float  # true chance that one attempt teaches the node
    slip: float = 0.1
    guess: float = 0.2
    knows: bool = False
    # Chance the hidden misconception produces its wrong answer on an item that can show it
    # (0 for none), and the share of items that can show it at all (its rule gives a distinct
    # wrong answer for that item's numbers).
    misconception: float = 0.0
    applicable: float = 1.0
    # Chance that one remediation (scene and follow-up) cures the misconception for good.
    cure: float = 0.0
    # Chance that any other wrong answer, on an item that can show the misconception, happens
    # to equal its wrong answer (a slip that looks like the misconception), so the model sees a
    # match the student does not have.
    wrong_matches: float = 0.0
    # Choice items with this many options (None for free answers). With two options every
    # wrong answer is the distractor, so pass wrong_matches=1.0 too.
    options: int | None = None


@dataclass(frozen=True)
class Run:
    attempts: int
    secured_after: int | None
    knew_when_secured: bool
    misconception_when_secured: bool
    diagnostics: int
    scenes: int

    @property
    def false_secure(self) -> bool:
        return self.secured_after is not None and (
            not self.knew_when_secured or self.misconception_when_secured
        )


def run(
    student: Student,
    rng: random.Random,
    *,
    max_attempts: int = 60,
    attempts_per_session: int = 5,
) -> Run:
    """Practise one node until the model calls it SECURE or the budget runs out.

    One session a day, `attempts_per_session` items per session. A misconception that shows
    itself is remediated straight away; items that could show it then serve as re-checks.
    """
    state = NodeMastery(node=NODE)
    to_probe = (CODE,)
    track: misconceptions.Track | None = None
    knows = student.knows
    has_misconception = student.misconception > 0
    diagnostics = 0
    guess = max(student.guess, 1 / student.options) if student.options else student.guess
    event = misconceptions.match_event(options=student.options, confidence=None)
    for index in range(max_attempts):
        day = index // attempts_per_session
        session = f"day{day}"
        at = START + timedelta(days=day, minutes=index % attempts_per_session)
        applies = rng.random() < student.applicable
        fired = has_misconception and applies and rng.random() < student.misconception
        if fired:
            correct = False
        elif knows:
            correct = rng.random() >= student.slip
        else:
            correct = rng.random() < guess
        strong = False
        matched = fired or (
            not correct
            and applies
            and student.wrong_matches > 0
            and rng.random() < student.wrong_matches
        )
        attempt_id = f"a{index}"
        if matched:
            track = misconceptions.apply(
                track, event, code=CODE, node=NODE, at=at, session=session, attempt=attempt_id
            )
            strong = misconceptions.restarts_run(event, track)
            if strong:
                state = mastery.misconception_seen(state, CODE)
        elif correct and applies and track is not None and track.status == "REMEDIATED":
            # Only an item that could have shown the misconception counts as a clean re-check.
            track = misconceptions.apply(
                track,
                "recheck_passed",
                code=CODE,
                node=NODE,
                at=at,
                session=session,
                attempt=attempt_id,
            )
        state = mastery.record(
            state,
            Attempt(
                node=NODE,
                correct=correct,
                at=at,
                session=session,
                options=student.options,
                explained=strong,
                could_reveal=(CODE,) if applies else (),
            ),
            to_probe=to_probe,
            open_misconception=misconceptions.is_open(track),
        )
        scenes = track.remediations if track else 0
        if state.status == "SECURE":
            return Run(index + 1, index + 1, knows, has_misconception, diagnostics, scenes)
        if mastery.needs_prerequisite_diagnostic(state):
            diagnostics += 1
            state = mastery.start_diagnostic(state)
        if track is not None and matched and misconceptions.remediation_queue([track]):
            # A scene for anything queued: not for a weak suspicion, nor while a re-check waits.
            track = misconceptions.apply(
                track, "remediated", code=CODE, node=NODE, at=at, session=session
            )
            if fired and rng.random() < student.cure:
                has_misconception = False
        if not knows and rng.random() < student.learn:
            knows = True
    scenes = track.remediations if track else 0
    return Run(max_attempts, None, knows, has_misconception, diagnostics, scenes)
