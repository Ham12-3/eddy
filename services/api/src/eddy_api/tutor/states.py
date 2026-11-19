"""Loop 1's states and transitions (SPEC.md section 7.1): code decides, the model speaks.

    PLAN -> TEACH_WORKED -> PRACTISE_FADED -> PRACTISE_INDEPENDENT -> CONFIDENCE -> MARK
    MARK (correct) -> UPDATE -> SCHEDULE -> NEXT
    MARK (wrong)   -> DIAGNOSE -> EXPLAIN (scene) -> FOLLOW_UP (Socratic) -> RECHECK -> UPDATE
                      -> SCHEDULE -> NEXT
    Interrupts from any state: HELP (hint ladder), OFF_TOPIC (redirect), SAFEGUARDING (ends
    tutoring), PAUSE

Every transition is a pure function of the state and what just happened. Claude writes the words
inside a state and never chooses the next one. The LangGraph graph (graph.py) wires these.
"""

from dataclasses import dataclass
from typing import Literal

State = Literal[
    "PLAN",
    "TEACH_WORKED",
    "PRACTISE_FADED",
    "PRACTISE_INDEPENDENT",
    "CONFIDENCE",
    "MARK",
    "UPDATE",
    "SCHEDULE",
    "NEXT",
    "DIAGNOSE",
    "EXPLAIN",
    "FOLLOW_UP",
    "RECHECK",
    "ENDED",
]
STATES: tuple[State, ...] = (
    "PLAN",
    "TEACH_WORKED",
    "PRACTISE_FADED",
    "PRACTISE_INDEPENDENT",
    "CONFIDENCE",
    "MARK",
    "UPDATE",
    "SCHEDULE",
    "NEXT",
    "DIAGNOSE",
    "EXPLAIN",
    "FOLLOW_UP",
    "RECHECK",
    "ENDED",
)
#: States that wait for the student; the rest run straight through.
WAITING: frozenset[State] = frozenset(
    {
        "TEACH_WORKED",
        "PRACTISE_FADED",
        "PRACTISE_INDEPENDENT",
        "CONFIDENCE",
        "EXPLAIN",
        "FOLLOW_UP",
        "RECHECK",
    }
)
#: States where the student is working on an item, so a hint can be asked for.
ANSWERING: frozenset[State] = frozenset({"PRACTISE_FADED", "PRACTISE_INDEPENDENT", "RECHECK"})

Interrupt = Literal["HELP", "OFF_TOPIC", "SAFEGUARDING", "PAUSE"]
EventKind = Literal[
    "start",
    "continue",
    "answer",
    "confidence",
    "marked",
    "diagnosed",
    "watched",
    "replied",
    "updated",
    "scheduled",
    "next",
    "help",
    "off_topic",
    "safeguarding",
    "pause",
]

#: Hint ladder (SPEC.md section 9.1): 0 none, 1 nudge, 2 pointed question, 3 partial worked step,
#: 4 worked example of a different but parallel problem. Never the answer itself.
HINT_LADDER = (
    "none",
    "nudge",
    "pointed question",
    "partial worked step",
    "parallel worked example",
)
MAX_HINT_LEVEL = len(HINT_LADDER) - 1
#: Items a session works through before it ends by itself.
ITEMS_PER_SESSION = 6


@dataclass(frozen=True)
class Event:
    kind: EventKind
    correct: bool | None = None
    #: For "next": whether the session plan still has items.
    more: bool = True


class TransitionError(ValueError):
    pass


def next_hint_level(level: int, *, choice: bool = False, demanded: bool = False) -> int:
    """The next rung of the hint ladder. Demanding the answer goes straight to the parallel
    worked example (4), and a question with options skips the partial step (3), which would
    point at the answer."""
    if demanded:
        return MAX_HINT_LEVEL
    following = min(level + 1, MAX_HINT_LEVEL)
    return MAX_HINT_LEVEL if choice and following == 3 else following


def transition(state: State, event: Event) -> State:
    """The next state. Interrupts keep the state (HELP, OFF_TOPIC) or end the session."""
    if event.kind in ("safeguarding", "pause"):
        return "ENDED"
    if event.kind in ("help", "off_topic"):
        if state == "ENDED":
            raise TransitionError("The session has ended")
        return state
    match (state, event.kind):
        case ("PLAN", "start" | "next"):
            return "TEACH_WORKED"
        case ("TEACH_WORKED", "continue"):
            return "PRACTISE_FADED"
        case ("PRACTISE_FADED", "answer"):
            # The faded item is practice with a step shown: either way, try one alone next.
            return "PRACTISE_INDEPENDENT"
        case ("PRACTISE_INDEPENDENT", "answer"):
            # Confidence is asked before correctness is revealed.
            return "CONFIDENCE"
        case ("CONFIDENCE", "confidence"):
            return "MARK"
        case ("MARK", "marked"):
            if event.correct is None:
                raise TransitionError("MARK needs a correct or wrong answer")
            return "UPDATE" if event.correct else "DIAGNOSE"
        case ("DIAGNOSE", "diagnosed"):
            return "EXPLAIN"
        case ("EXPLAIN", "watched"):
            return "FOLLOW_UP"
        case ("FOLLOW_UP", "replied"):
            return "RECHECK"
        case ("RECHECK", "answer"):
            return "UPDATE"
        case ("UPDATE", "updated"):
            return "SCHEDULE"
        case ("SCHEDULE", "scheduled"):
            return "NEXT"
        case ("NEXT", "next"):
            return "PLAN" if event.more else "ENDED"
    raise TransitionError(f"No transition from {state} on {event.kind}")
