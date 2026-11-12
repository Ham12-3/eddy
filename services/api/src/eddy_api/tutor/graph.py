"""Loop 1 as a LangGraph graph with a Postgres checkpointer (SPEC.md section 7.1, ADR-0031).

Each state is a node; states that wait for the student pause with `interrupt()` and resume with
the student's input, so a lesson survives refreshes and device switches (the checkpoint is keyed
by the tutor session id). Code decides every transition; Claude only writes the words, through
the safety pipeline in turn.py.

The checkpointer runs on the request's own database connection (routes/tutor.py), so a turn's
checkpoint, attempts, learner model updates and messages commit or roll back together.

The checkpoint holds the lesson's position, ids, items and the student's validated answers
(MathJSON maths-core could read), never free text: a message reaches the graph as the id of its
`tutor_message` row (90-day retention). Each run adds what the student should see next to
`outbox`, tagged with the turn, and the route returns the latest turn's entries: tutor messages,
items (never their answers), scenes, the confidence question, the safeguarding script and the end.

Inputs: {"kind": "continue" | "answer" | "confidence" | "message" | "help" | "watched" | "pause",
"mathjson"?, "value"?, "message_id"?}.
"""

import json
import os
import random
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated, Any, Literal, TypedDict

from langgraph.graph import START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.runtime import Runtime
from langgraph.types import Command, interrupt
from sqlalchemy import select
from sqlalchemy.orm import Session

from eddy_api.db.models import (
    Attempt,
    CurriculumNode,
    Item,
    Misconception,
    TutorSession,
)
from eddy_api.db.models import (
    TutorMessage as TutorMessageRow,
)
from eddy_api.learner import planner
from eddy_api.learner.mastery import SECURED
from eddy_api.llm.client import LlmClient, LlmUnavailableError
from eddy_api.scenes.services import MathsCoreClient, SceneCheckClient, SceneServiceError
from eddy_api.scenes.variants import serve_now
from eddy_api.tutor import learner_store, safeguarding
from eddy_api.tutor.states import ITEMS_PER_SESSION, State, next_hint_level
from eddy_api.tutor.turn import (
    ItemContext,
    Purpose,
    Screened,
    TurnRequest,
    TurnResult,
    fallback,
    generate,
    screen,
)

# Lesson state must never leave Eddy's processors (SPEC.md section 12): LangGraph would send it
# to LangSmith if tracing were switched on in the environment.
for _name in ("LANGSMITH_TRACING", "LANGCHAIN_TRACING_V2", "LANGCHAIN_TRACING"):
    os.environ[_name] = "false"
for _name in ("LANGSMITH_API_KEY", "LANGCHAIN_API_KEY"):
    os.environ.pop(_name, None)

HISTORY_MESSAGES = 8
EARLIER_MESSAGES = 2
#: Student messages whose text never goes back to the tutor model in the conversation history.
HIDDEN_FLAGS = frozenset(
    {"unscreened", "classifier_unavailable", "prompt_injection", "harmful_request", "tripwire"}
)
#: When nothing can read a message (Claude off, or the classifier down; the tripwires still
#: run), it gets this, never a model reply.
UNREAD_MESSAGE = (
    "I can't read messages just now. You can still answer the question or ask for a hint. "
    "If something is worrying you, Childline is free on 0800 1111, any time."
)
UNREADABLE_ANSWER = "I could not read that answer. Check how it is written, then send it again."


class ModelConcernError(Exception):
    """The tutor model flagged a possible safeguarding concern in the student's message."""


@dataclass
class Deps:
    """Services a run needs; never checkpointed."""

    session: Session
    maths_core: MathsCoreClient
    scene_check: SceneCheckClient | None
    #: None when Claude is off or over its cost guard: messages are templated and only the
    #: tripwires screen input.
    llm: LlmClient | None
    target_grade: int = 4
    now: Callable[[], datetime] = lambda: datetime.now(UTC)
    #: Opens a separate session, so a safeguarding event is committed even if the turn fails.
    durable: Callable[[], Session] | None = None
    _templates: list[dict[str, Any]] | None = None

    def templates(self) -> list[dict[str, Any]]:
        """maths-core's item templates, fetched once a turn."""
        if self._templates is None:
            self._templates = self.maths_core.templates()
        return self._templates

    def practisable(self) -> set[str]:
        return {t["node"] for t in self.templates()}


def keep_latest(
    old: list[dict[str, Any]] | None, new: list[dict[str, Any]] | None
) -> list[dict[str, Any]]:
    """Keeps only the newest turn's outbox entries."""
    merged = [*(old or []), *(new or [])]
    if not merged:
        return []
    latest = max(entry["turn"] for entry in merged)
    return [entry for entry in merged if entry["turn"] == latest]


class Lesson(TypedDict, total=False):
    turn: int
    outbox: Annotated[list[dict[str, Any]], keep_latest]
    state: State
    lesson: str
    student: str
    node_override: str | None
    #: The session plan (SPEC.md section 7.1): steps still to run, each {"node", "mode",
    #: "misconception"}; mode is learn, review, recheck, remediate or diagnostic.
    queue: list[dict[str, Any]] | None
    step: dict[str, Any] | None
    taught: list[str]
    node: str | None
    template: str | None
    item: dict[str, Any] | None
    parallel: dict[str, Any] | None
    hint_level: int
    hints_used: int
    aided: bool
    answer: Any
    check: dict[str, Any] | None
    confidence: int | None
    correct: bool | None
    attempt_id: str | None
    applied: str | None
    misconception: str | None
    scene_shown: bool
    recheck: bool
    started_ms: int
    items_done: int
    ended: str | None


Runtimes = Runtime[Deps]


def _out(state: Lesson, entry_type: str, **payload: Any) -> dict[str, Any]:
    return {"turn": state.get("turn", 0), "type": entry_type, **payload}


def _item(state: Lesson) -> dict[str, Any]:
    item = state.get("item")
    if item is None:
        raise RuntimeError("No item in this lesson state")
    return item


def _node_row(deps: Deps, code: str) -> CurriculumNode:
    row = deps.session.scalar(select(CurriculumNode).where(CurriculumNode.code == code))
    if row is None:
        raise LookupError(f"No curriculum node {code}")
    return row


def _misconception(deps: Deps, code: str | None) -> Misconception | None:
    if not code:
        return None
    return deps.session.scalar(select(Misconception).where(Misconception.code == code))


def _student_rows(deps: Deps, lesson: str, limit: int) -> list[TutorMessageRow]:
    rows = deps.session.scalars(
        select(TutorMessageRow)
        .where(
            TutorMessageRow.session_id == uuid.UUID(lesson), TutorMessageRow.content.is_not(None)
        )
        .order_by(TutorMessageRow.created_at.desc())
        .limit(limit)
    )
    return list(reversed(list(rows)))


def _history(deps: Deps, lesson: str) -> list[tuple[str, str]]:
    """The conversation for the tutor model. Unscreened and flagged student messages are left
    out (their text never goes back to the model)."""
    history = []
    for row in _student_rows(deps, lesson, HISTORY_MESSAGES):
        if row.role == "TUTOR":
            history.append(("tutor", row.content or ""))
        elif row.role == "STUDENT":
            hidden = HIDDEN_FLAGS & set(row.safety_flags or [])
            history.append(("student", "(message not shown)" if hidden else row.content or ""))
    return history


def _context(item: dict[str, Any] | None) -> ItemContext | None:
    if item is None:
        return None
    return ItemContext(
        template_id=item["template_id"],
        seed=item["seed"],
        node=item["node"],
        node_title=item["node_title"],
        stem=item["stem"],
        answer=item["answer"],
        command_word=item.get("command_word", ""),
        marks=item.get("marks", 1),
        calculator=item.get("calculator", True),
        choice=item.get("choice", False),
    )


def _record_message(
    deps: Deps,
    state: Lesson,
    role: str,
    text: str,
    *,
    result: TurnResult | None = None,
    flags: list[str] | None = None,
) -> None:
    deps.session.add(
        TutorMessageRow(
            session_id=uuid.UUID(state["lesson"]),
            role=role,
            content=text,
            state=state.get("state", "PLAN"),
            hint_level=result.message.hint_level if result else None,
            model=result.model if result else None,
            prompt_version=result.prompt_version if result else None,
            safety_flags=[
                *(flags or []),
                *(["fallback"] if result and result.source == "fallback" else []),
            ],
            # The clock, not the transaction's start: messages in one turn keep their order.
            created_at=datetime.now(UTC),
        )
    )
    deps.session.flush()


def _say(
    deps: Deps,
    state: Lesson,
    purpose: Purpose,
    *,
    misconception: str | None = None,
    student_message: str | None = None,
) -> dict[str, Any]:
    """Writes one tutor message through the pipeline and returns its outbox entry. Raises
    ModelConcernError when the tutor model flags the student's message."""
    item = _context(state.get("item"))
    if item is None:
        raise RuntimeError("No item to talk about")
    request = TurnRequest(
        purpose=purpose,
        item=item,
        hint_level=state.get("hint_level", 0),
        parallel=_context(state.get("parallel")),
        attempts=[(state["answer"], bool(state.get("correct")))]
        if state.get("answer") is not None
        else [],
        misconception=misconception,
        history=_history(deps, state["lesson"]),
        student_message=student_message,
        hints_used=state.get("hints_used", 0),
        confidence=state.get("confidence"),
        student_id=uuid.UUID(state["student"]),
    )
    templated = TurnResult(
        message=fallback(purpose, request.hint_level, hints_used=request.hints_used),
        source="fallback",
    )
    if deps.llm is None:
        result = templated
    else:
        try:
            result = generate(request, llm=deps.llm, maths_core=deps.maths_core)
        except LlmUnavailableError:
            result = templated
    if result.concern:
        raise ModelConcernError
    _record_message(deps, state, "TUTOR", result.message.text, result=result)
    return _out(
        state,
        "tutor",
        text=result.message.text,
        kind=result.message.kind,
        hint_level=result.message.hint_level,
        source=result.source,
    )


def _seed(state: Lesson, purpose: str) -> int:
    key = f"{state['lesson']}:{state.get('items_done', 0)}:{purpose}"
    return random.Random(key).randrange(1, 2**31 - 1)  # noqa: S311 (item variety, not security)


def _templates(deps: Deps, node: str) -> list[dict[str, Any]]:
    return [t for t in deps.templates() if t["node"] == node]


def _choose_template(
    deps: Deps, state: Lesson, node: str, purpose: str, *, reveals: str | None = None
) -> str:
    templates = _templates(deps, node)
    if not templates:
        raise LookupError(f"No item template for {node}")
    if reveals:
        templates = [t for t in templates if reveals in t["misconceptions"]] or templates
    chosen: str = templates[_seed(state, purpose + ":template") % len(templates)]["id"]
    return chosen


def _new_item(
    deps: Deps,
    state: Lesson,
    node: str,
    purpose: str,
    template_id: str,
    *,
    unlike: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Generates an item with maths-core, stores it in the bank, and returns its private record.
    `unlike` is an item this one must differ from (a parallel problem is never the question)."""
    seed = _seed(state, purpose)
    generated = deps.maths_core.item(template_id, seed)
    for extra in range(1, 6):
        if unlike is None or (
            generated["params"] != unlike.get("params")
            and generated["answer"]["mathjson"] != unlike["answer"]
        ):
            break
        seed = _seed(state, f"{purpose}:{extra}")
        generated = deps.maths_core.item(template_id, seed)
    template = next((t for t in _templates(deps, node) if t["id"] == template_id), None)
    structures = template.get("structures", []) if template else []
    node_row = _node_row(deps, node)
    row = Item(
        node_id=node_row.id,
        template_id=generated["template_id"],
        seed=seed,
        params=generated["params"],
        stem_markdown=generated["stem_markdown"],
        answer_canonical=json.dumps(generated["answer"]["mathjson"]),
        answer_format=generated["answer_format"],
        calculator_allowed=generated["calculator"],
        command_word=generated["command_word"],
        marks=generated["marks"],
        distractors=[
            {"value": d["value"]["mathjson"], "misconception_code": d["misconception"]}
            for d in generated["distractors"]
        ],
        provenance="TEMPLATE",
        cas_verified_at=deps.now(),
    )
    deps.session.add(row)
    deps.session.flush()
    return {
        "id": str(row.id),
        "template_id": row.template_id,
        "seed": seed,
        "node": node,
        "node_title": node_row.title,
        "stem": row.stem_markdown,
        "answer": generated["answer"]["mathjson"],
        "params": generated["params"],
        "command_word": generated["command_word"],
        "marks": generated["marks"],
        "calculator": generated["calculator"],
        "choice": bool(generated.get("choice", False)),
        # Value rules this draw can show, and the template's structure rules (ADR-0022).
        "could_reveal": sorted(
            {d["misconception"] for d in generated["distractors"]} | set(structures)
        ),
    }


def _parallel_for(deps: Deps, state: Lesson, item: dict[str, Any]) -> dict[str, Any]:
    """A parallel problem on the item's own template, reused while it matches."""
    parallel = state.get("parallel")
    if parallel is not None and parallel["template_id"] == item["template_id"]:
        return parallel
    return _new_item(
        deps, state, item["node"], f"parallel:{item['id']}", item["template_id"], unlike=item
    )


def _item_entry(state: Lesson, item: dict[str, Any], *, faded: bool) -> dict[str, Any]:
    # Never the answer.
    return _out(
        state, "item", item_id=item["id"], stem=item["stem"], node=item["node"], faded=faded
    )


def _end(deps: Deps, state: Lesson, reason: Literal["FINISHED", "PAUSED"]) -> Command[Any]:
    row = deps.session.get(TutorSession, uuid.UUID(state["lesson"]))
    if row is not None and row.ended_at is None:
        row.ended_at = deps.now()
        row.end_reason = reason
    return Command(
        goto="__end__",
        update={"state": "ENDED", "ended": reason, "outbox": [_out(state, "end", reason=reason)]},
    )


def _safeguarding_end(
    deps: Deps,
    state: Lesson,
    concern: safeguarding.Tripwire,
    text: str,
    source: safeguarding.Source,
) -> Command[Any]:
    row = deps.session.get(TutorSession, uuid.UUID(state["lesson"]))
    if row is not None:
        safeguarding.raise_concern(
            deps.session,
            tutor_session=row,
            concern=concern,
            text=text,
            source=source,
            durable=deps.durable,
        )
    _record_message(deps, state, "SYSTEM", safeguarding.SCRIPT, flags=["safeguarding_script"])
    return Command(
        goto="__end__",
        update={
            "state": "ENDED",
            "ended": "SAFEGUARDING",
            "outbox": [
                _out(state, "script", text=safeguarding.SCRIPT, version=safeguarding.SCRIPT_VERSION)
            ],
        },
    )


def _unread(state: Lesson) -> dict[str, Any]:
    return _out(
        state, "tutor", text=UNREAD_MESSAGE, kind="redirect", hint_level=0, source="fallback"
    )


def _hint(deps: Deps, state: Lesson, here: str, *, demanded: bool = False) -> Command[Any]:
    """Climbs the hint ladder (an answer demand goes straight to the parallel worked example).
    Either way the attempt is aided."""
    item = _item(state)
    level = next_hint_level(
        state.get("hint_level", 0), choice=bool(item.get("choice")), demanded=demanded
    )
    updated: Lesson = {
        **state,
        "hint_level": level,
        "hints_used": state.get("hints_used", 0) + 1,
        "aided": True,
    }
    if level == 4:
        updated["parallel"] = _parallel_for(deps, state, item)
    entry = _say(deps, updated, "answer_demand" if demanded else "hint")
    return Command(
        goto=here,
        update={
            "hint_level": level,
            "hints_used": updated["hints_used"],
            "aided": True,
            "parallel": updated.get("parallel"),
            "outbox": [entry],
        },
    )


def _message_text(deps: Deps, state: Lesson, value: dict[str, Any]) -> TutorMessageRow | None:
    try:
        row = deps.session.get(TutorMessageRow, uuid.UUID(str(value.get("message_id"))))
    except ValueError:
        return None
    if row is None or row.role != "STUDENT" or str(row.session_id) != state["lesson"]:
        return None
    return row


def _screen(deps: Deps, state: Lesson, row: TutorMessageRow) -> Screened:
    text = row.content or ""
    if deps.llm is None:
        hit = safeguarding.tripwire(text)
        return Screened(None, ["tripwire"] if hit else ["classifier_unavailable"], hit)
    earlier = [
        r.content or ""
        for r in _student_rows(deps, state["lesson"], HISTORY_MESSAGES)
        if r.role == "STUDENT" and r.id != row.id
    ][-EARLIER_MESSAGES:]
    return screen(text, deps.llm, uuid.UUID(state["student"]), earlier)


def _handle_common(
    deps: Deps, state: Lesson, value: dict[str, Any], here: str
) -> Command[Any] | None:
    """Pause, messages and help, from any waiting state. None means the caller handles it (a
    reply to the Socratic question in FOLLOW_UP)."""
    kind = value.get("kind")
    if kind == "pause":
        return _end(deps, state, "PAUSED")
    if kind == "help":
        if state.get("item") is None:
            return Command(goto=here, update={"outbox": []})
        return _hint(deps, state, here)
    if kind != "message":
        return None
    row = _message_text(deps, state, value)
    if row is None:
        return Command(goto=here, update={"outbox": []})
    text = row.content or ""
    screened = _screen(deps, state, row)
    row.safety_flags = screened.flags
    deps.session.flush()
    if screened.concern is not None:
        source: safeguarding.Source = "tripwire"
        if "classifier_refusal" in screened.flags:
            source = "classifier_refusal"
        elif "classifier_safeguarding" in screened.flags:
            source = "classifier"
        return _safeguarding_end(deps, state, screened.concern, text, source)
    if "classifier_unavailable" in screened.flags or screened.purpose is None:
        # Nothing has read the message, so the tutor model never sees it. A reply to the
        # Socratic question still moves the lesson on.
        goto = here
        if here == "wait_follow_up":
            goto = "update" if state.get("recheck") else "recheck"
        return Command(goto=goto, update={"outbox": [_unread(state)]})
    if state.get("item") is None:
        templated = fallback(screened.purpose, 0)
        entry = _out(
            state, "tutor", text=templated.text, kind="redirect", hint_level=0, source="fallback"
        )
        return Command(goto=here, update={"outbox": [entry]})
    try:
        if screened.purpose == "hint":
            return _hint(deps, state, here)
        if screened.purpose == "answer_demand":
            return _hint(deps, state, here, demanded=True)
        if screened.purpose == "reply" and here == "wait_follow_up":
            return None  # the student's answer to the Socratic question
        entry = _say(deps, state, screened.purpose, student_message=text)
    except ModelConcernError:
        concern = safeguarding.Tripwire("other", "MEDIUM", "(tutor model)")
        return _safeguarding_end(deps, state, concern, text, "tutor")
    return Command(goto=here, update={"outbox": [entry]})


def _begin_turn(state: Lesson) -> Lesson:
    return {**state, "turn": state.get("turn", 0) + 1}


def _with_turn(command: Command[Any], lesson: Lesson) -> Command[Any]:
    update = dict(command.update or {}) if isinstance(command.update, dict) else {}
    update.setdefault("turn", lesson["turn"])
    return Command(goto=command.goto, update=update)


def _stay(here: str, lesson: Lesson) -> Command[Any]:
    """An input this state does not take: nothing changes."""
    return Command(goto=here, update={"turn": lesson["turn"], "outbox": []})


def _ms() -> int:
    return int(time.time() * 1000)


# Answers.


def _read_answer(
    deps: Deps, state: Lesson, value: dict[str, Any], here: str
) -> tuple[dict[str, Any] | None, Command[Any] | None]:
    """Checks an answer with maths-core before anything is stored. Returns the check, or the
    command to run instead (safeguarding for text hidden in it, or an unreadable answer)."""
    response = value.get("mathjson")
    for text in safeguarding.strings_in(response):
        hit = safeguarding.tripwire(text)
        if hit:
            return None, _safeguarding_end(deps, state, hit, text, "tripwire")
    item = _item(state)
    result = deps.maths_core.check_answer(item["template_id"], item["seed"], response)
    if result.get("unreadable"):
        issues = [i["message"] for i in result.get("format_issues", [])][:2]
        entry = _out(state, "unreadable", text=UNREADABLE_ANSWER, issues=issues)
        return None, Command(goto=here, update={"outbox": [entry]})
    return {
        "correct": bool(result["correct"]),
        "codes": list(result.get("misconceptions", [])),
    }, None


def _store_attempt(deps: Deps, state: Lesson, response: Any, check: dict[str, Any]) -> str:
    item = _item(state)
    correct, codes = check["correct"], check["codes"]
    misconception = _misconception(deps, codes[0]) if codes and not correct else None
    row = Attempt(
        student_id=uuid.UUID(state["student"]),
        item_id=uuid.UUID(item["id"]),
        session_id=uuid.UUID(state["lesson"]),
        response_raw="",
        response_mathjson=response,
        correct=correct,
        detected_misconception_id=misconception.id if misconception else None,
        confidence_self_report=state.get("confidence"),
        hints_used=state.get("hints_used", 0),
        aided=state.get("aided", False),
        time_ms=max(0, _ms() - state.get("started_ms", _ms())),
    )
    deps.session.add(row)
    deps.session.flush()
    return str(row.id)


def _apply(deps: Deps, state: Lesson, codes: list[str]) -> str | None:
    """One answer through the learner model, once per attempt. Returns the applied attempt."""
    item = state.get("item")
    node = state.get("node")
    attempt = state.get("attempt_id")
    if item is None or node is None or attempt is None or state.get("applied") == attempt:
        return state.get("applied")
    node_row = _node_row(deps, node)
    misconception = _misconception(deps, codes[0]) if codes and not state.get("correct") else None
    node_codes = tuple(
        deps.session.scalars(select(Misconception.code).where(Misconception.node_id == node_row.id))
    )
    practisable = deps.practisable()
    info = next(
        (i for i in learner_store.node_infos(deps.session, practisable) if i.code == node), None
    )
    learner_store.apply_answer(
        deps.session,
        student=uuid.UUID(state["student"]),
        node=node_row,
        attempt_id=uuid.UUID(attempt),
        lesson=state["lesson"],
        correct=bool(state.get("correct")),
        misconception=misconception,
        confidence=state.get("confidence"),
        hints=state.get("hints_used", 0),
        aided=state.get("aided", False),
        time_ms=max(0, _ms() - state.get("started_ms", _ms())),
        could_reveal=tuple(item.get("could_reveal", [])),
        node_codes=node_codes,
        now=deps.now(),
        template_codes=tuple(tuple(t["misconceptions"]) for t in _templates(deps, node)),
        prerequisites=info.prerequisites if info else (),
    )
    return attempt


# Nodes.

ITEM_RESET: dict[str, Any] = {
    "hint_level": 0,
    "hints_used": 0,
    "aided": False,
    "answer": None,
    "check": None,
    "correct": None,
    "confidence": None,
    "attempt_id": None,
    "misconception": None,
    "scene_shown": False,
}


def _session_queue(deps: Deps, state: Lesson) -> list[dict[str, Any]]:
    """The session plan: a due re-check, then remediation, the first review, new learning, and
    the other reviews (SPEC.md section 7.1)."""
    override = state.get("node_override")
    if override:
        return [{"node": override, "mode": "learn", "misconception": None}]
    student = uuid.UUID(state["student"])
    practisable = deps.practisable()
    infos = learner_store.node_infos(deps.session, practisable)
    model = learner_store.student_model(deps.session, student, [i.code for i in infos])
    plan = planner.plan_session(
        infos,
        model,
        learner_store.student_cards(deps.session, student),
        learner_store.student_tracks(deps.session, student),
        deps.now(),
        target_grade=deps.target_grade,
    )
    queue: list[dict[str, Any]] = []
    for code, mode in ((plan.recheck, "recheck"), (plan.remediation, "remediate")):
        misconception = _misconception(deps, code)
        if misconception is not None:
            node = deps.session.get(CurriculumNode, misconception.node_id)
            if node is not None and node.code in practisable:
                queue.append({"node": node.code, "mode": mode, "misconception": code})
    reviews = [{"node": r, "mode": "review", "misconception": None} for r in plan.reviews]
    learn = [{"node": plan.node, "mode": "learn", "misconception": None}] if plan.node else []
    return queue + reviews[:1] + learn + reviews[1:]


def _next_learning(deps: Deps, state: Lesson) -> dict[str, Any] | None:
    override = state.get("node_override")
    if override:
        # A lesson on a chosen node stays on it.
        return {"node": override, "mode": "learn", "misconception": None}
    student = uuid.UUID(state["student"])
    practisable = deps.practisable()
    infos = learner_store.node_infos(deps.session, practisable)
    model = learner_store.student_model(deps.session, student, [i.code for i in infos])
    node = planner.choose_node(infos, model, deps.target_grade)
    return {"node": node, "mode": "learn", "misconception": None} if node else None


def plan(state: Lesson, runtime: Runtimes) -> Command[Any]:
    deps = runtime.context
    queue = state.get("queue")
    if queue is None:
        queue = _session_queue(deps, state)
    queue = list(queue)
    step = queue.pop(0) if queue else _next_learning(deps, state)
    if step is None:
        return _end(deps, state, "FINISHED")
    node = step["node"]
    update: dict[str, Any] = {
        **ITEM_RESET,
        "state": "PLAN",
        "queue": queue,
        "step": step,
        "node": node,
        "recheck": False,
        "item": None,
        "parallel": None,
    }
    lesson: Lesson = {**state, **update}  # type: ignore[typeddict-item]
    if step["mode"] in ("recheck", "remediate"):
        update["template"] = _choose_template(
            deps, lesson, node, "planned", reveals=step["misconception"]
        )
        return Command(goto="independent", update=update)
    taught = list(state.get("taught", []))
    if step["mode"] != "learn" or node in taught:
        update["template"] = _choose_template(deps, lesson, node, "practice")
        return Command(goto="independent", update=update)
    student = uuid.UUID(state["student"])
    known = learner_store.load_node(deps.session, student, _node_row(deps, node))
    template = _choose_template(deps, lesson, node, "practice")
    update["template"] = template
    update["taught"] = [*taught, node]
    if known.status in SECURED:
        # Expertise reversal: a secured node needs practice, not a worked example.
        return Command(goto="independent", update=update)
    practice = _new_item(deps, lesson, node, "practice", template)
    update["item"] = practice
    update["parallel"] = _new_item(deps, lesson, node, "parallel", template, unlike=practice)
    return Command(goto="teach", update=update)


def teach(state: Lesson, runtime: Runtimes) -> Command[Any]:
    deps = runtime.context
    lesson: Lesson = {**state, "state": "TEACH_WORKED"}
    return Command(
        goto="wait_teach",
        update={"state": "TEACH_WORKED", "outbox": [_say(deps, lesson, "worked_example")]},
    )


def wait_teach(state: Lesson, runtime: Runtimes) -> Command[Any]:
    value = interrupt({"waiting_for": ["continue", "message", "help", "pause"]})
    lesson = _begin_turn(state)
    handled = _handle_common(runtime.context, lesson, value, "wait_teach")
    if handled is not None:
        return _with_turn(handled, lesson)
    if value.get("kind") != "continue":
        return _stay("wait_teach", lesson)
    # A faded step on a question with options would point at the answer: practise it instead.
    goto = "independent" if _item(state).get("choice") else "faded"
    return Command(goto=goto, update={"turn": lesson["turn"]})


def faded(state: Lesson, runtime: Runtimes) -> Command[Any]:
    deps = runtime.context
    lesson: Lesson = {**state, "state": "PRACTISE_FADED", "hint_level": 3}
    item = _item(state)
    entries = [_item_entry(lesson, item, faded=True), _say(deps, lesson, "faded_step")]
    return Command(
        goto="wait_faded",
        update={
            "state": "PRACTISE_FADED",
            "outbox": entries,
            "hint_level": 3,
            "aided": True,
            "started_ms": _ms(),
        },
    )


def wait_faded(state: Lesson, runtime: Runtimes) -> Command[Any]:
    deps = runtime.context
    value = interrupt({"waiting_for": ["answer", "message", "help", "pause"]})
    lesson = _begin_turn(state)
    handled = _handle_common(deps, lesson, value, "wait_faded")
    if handled is not None:
        return _with_turn(handled, lesson)
    if value.get("kind") != "answer":
        return _stay("wait_faded", lesson)
    check, instead = _read_answer(deps, lesson, value, "wait_faded")
    if instead is not None or check is None:
        return _with_turn(instead or _stay("wait_faded", lesson), lesson)
    attempt = _store_attempt(deps, lesson, value.get("mathjson"), check)
    marked: Lesson = {
        **lesson,
        "answer": value.get("mathjson"),
        "check": check,
        "correct": check["correct"],
        "attempt_id": attempt,
    }
    update: dict[str, Any] = {
        "turn": lesson["turn"],
        "answer": value.get("mathjson"),
        "check": check,
        "correct": check["correct"],
        "attempt_id": attempt,
    }
    if not check["correct"]:
        # Every wrong answer is diagnosed and explained.
        codes = check["codes"]
        return Command(
            goto="diagnose",
            update={
                **update,
                "misconception": codes[0] if codes else None,
                "outbox": [_out(lesson, "marked", correct=False)],
            },
        )
    update["applied"] = _apply(deps, marked, [])
    entries = [_out(lesson, "marked", correct=True), _say(deps, marked, "feedback_correct")]
    return Command(goto="independent", update={**update, "outbox": entries, "item": None})


def independent(state: Lesson, runtime: Runtimes) -> Command[Any]:
    deps = runtime.context
    item = state.get("item")
    lesson: Lesson = {**state, "state": "PRACTISE_INDEPENDENT"}
    node = state.get("node") or ""
    if item is None or state.get("answer") is not None:
        template = state.get("template") or _choose_template(deps, lesson, node, "independent")
        item = _new_item(deps, lesson, node, f"independent:{state.get('items_done', 0)}", template)
    return Command(
        goto="wait_independent",
        update={
            **ITEM_RESET,
            "state": "PRACTISE_INDEPENDENT",
            "item": item,
            "started_ms": _ms(),
            # Entries from earlier nodes in this turn (feedback) are kept by the reducer.
            "outbox": [_item_entry(lesson, item, faded=False)],
        },
    )


def wait_independent(state: Lesson, runtime: Runtimes) -> Command[Any]:
    deps = runtime.context
    value = interrupt({"waiting_for": ["answer", "message", "help", "pause"]})
    lesson = _begin_turn(state)
    handled = _handle_common(deps, lesson, value, "wait_independent")
    if handled is not None:
        return _with_turn(handled, lesson)
    if value.get("kind") != "answer":
        return _stay("wait_independent", lesson)
    check, instead = _read_answer(deps, lesson, value, "wait_independent")
    if instead is not None or check is None:
        return _with_turn(instead or _stay("wait_independent", lesson), lesson)
    # Confidence is asked before correctness is revealed.
    return Command(
        goto="wait_confidence",
        update={
            "turn": lesson["turn"],
            "state": "CONFIDENCE",
            "answer": value.get("mathjson"),
            "check": check,
            "outbox": [_out(lesson, "ask_confidence", scale=[1, 2, 3, 4])],
        },
    )


def wait_confidence(state: Lesson, runtime: Runtimes) -> Command[Any]:
    deps = runtime.context
    value = interrupt({"waiting_for": ["confidence", "message", "pause"]})
    lesson = _begin_turn(state)
    if value.get("kind") in ("pause", "message"):
        # A message here is screened like any other (a disclosure ends the lesson).
        handled = _handle_common(deps, lesson, value, "wait_confidence")
        if handled is not None:
            return _with_turn(handled, lesson)
    confidence = value.get("value")
    if value.get("kind") != "confidence" or confidence not in (1, 2, 3, 4):
        return _stay("wait_confidence", lesson)
    return Command(goto="mark", update={"turn": lesson["turn"], "confidence": confidence})


def mark(state: Lesson, runtime: Runtimes) -> Command[Any]:
    deps = runtime.context
    check = state.get("check") or {"correct": False, "codes": []}
    attempt = _store_attempt(deps, state, state.get("answer"), check)
    correct = check["correct"]
    marked: Lesson = {**state, "state": "MARK", "correct": correct, "attempt_id": attempt}
    entries = [_out(state, "marked", correct=correct)]
    update: dict[str, Any] = {"state": "MARK", "correct": correct, "attempt_id": attempt}
    if correct:
        entries.append(_say(deps, marked, "feedback_correct"))
        return Command(goto="update", update={**update, "outbox": entries, "misconception": None})
    codes = check["codes"]
    return Command(
        goto="diagnose",
        update={**update, "outbox": entries, "misconception": codes[0] if codes else None},
    )


def _scene(deps: Deps, state: Lesson, misconception: Misconception) -> dict[str, Any] | None:
    """The Tier D scene for this slip, narrating the answer the misconception predicts (never
    the student's own input, ADR-0030), or None when there is none for this answer."""
    if not misconception.remediation_template or deps.scene_check is None:
        return None
    item = _item(state)
    template = misconception.remediation_template
    try:
        context = deps.scene_check.context(template, item.get("params", {}), state.get("answer"))
        if context["misconception"] != misconception.code:
            return None
        predicted = context["predicted"]
        if not deps.maths_core.equivalent(state.get("answer"), predicted):
            return None
        tier_d = deps.scene_check.context(template, item.get("params", {}), predicted)["tierD"]
    except SceneServiceError:
        return None
    attempt = state.get("attempt_id")
    served = serve_now(
        deps.session,
        student_id=uuid.UUID(state["student"]),
        attempt_id=uuid.UUID(attempt) if attempt else None,
        tier_d=tier_d,
    )
    # With the attempt id, the app can ask for another way of seeing it (Tier L, ADR-0030).
    return _out(
        state,
        "scene",
        scene_spec_id=str(served.scene_spec_id),
        spec=served.spec,
        attempt_id=attempt,
    )


def diagnose(state: Lesson, runtime: Runtimes) -> Command[Any]:
    deps = runtime.context
    code = state.get("misconception")
    misconception = _misconception(deps, code)
    lesson: Lesson = {**state, "state": "DIAGNOSE"}
    # The learner model hears about the wrong answer now; remediation follows the scene.
    applied = _apply(deps, lesson, [code] if code else [])
    scene = _scene(deps, lesson, misconception) if misconception is not None else None
    slip = misconception.student_facing_description if misconception else None
    if scene is not None:
        entries = [_say(deps, lesson, "feedback_wrong"), scene]
        return Command(
            goto="wait_explain",
            update={"state": "EXPLAIN", "outbox": entries, "applied": applied, "scene_shown": True},
        )
    entry = _say(deps, {**lesson, "state": "FOLLOW_UP"}, "wrong_question", misconception=slip)
    return Command(
        goto="wait_follow_up",
        update={"state": "FOLLOW_UP", "outbox": [entry], "applied": applied, "scene_shown": False},
    )


def wait_explain(state: Lesson, runtime: Runtimes) -> Command[Any]:
    deps = runtime.context
    value = interrupt({"waiting_for": ["watched", "message", "help", "pause"]})
    lesson = _begin_turn(state)
    handled = _handle_common(deps, lesson, value, "wait_explain")
    if handled is not None:
        return _with_turn(handled, lesson)
    if value.get("kind") != "watched":
        return _stay("wait_explain", lesson)
    misconception = _misconception(deps, state.get("misconception"))
    if misconception is not None and state.get("node"):
        learner_store.apply_remediated(
            deps.session,
            student=uuid.UUID(state["student"]),
            misconception=misconception,
            node=_node_row(deps, state["node"] or ""),
            lesson=state["lesson"],
            now=deps.now(),
        )
    return Command(goto="follow_up", update={"turn": lesson["turn"], "aided": True})


def follow_up(state: Lesson, runtime: Runtimes) -> Command[Any]:
    deps = runtime.context
    misconception = _misconception(deps, state.get("misconception"))
    lesson: Lesson = {**state, "state": "FOLLOW_UP"}
    entry = _say(
        deps,
        lesson,
        "follow_up",
        misconception=misconception.student_facing_description if misconception else None,
    )
    return Command(goto="wait_follow_up", update={"state": "FOLLOW_UP", "outbox": [entry]})


def wait_follow_up(state: Lesson, runtime: Runtimes) -> Command[Any]:
    deps = runtime.context
    value = interrupt({"waiting_for": ["message", "continue", "help", "pause"]})
    lesson = _begin_turn(state)
    handled = _handle_common(deps, lesson, value, "wait_follow_up")
    if handled is not None:
        return _with_turn(handled, lesson)
    if value.get("kind") not in ("message", "continue"):
        return _stay("wait_follow_up", lesson)
    # A re-check that went wrong again is explained once, then the lesson moves on.
    goto = "update" if state.get("recheck") else "recheck"
    entries: list[dict[str, Any]] = []
    if value.get("kind") == "message":
        row = _message_text(deps, lesson, value)
        if row is not None:
            misconception = _misconception(deps, state.get("misconception"))
            try:
                entries.append(
                    _say(
                        deps,
                        lesson,
                        "follow_up_reply",
                        misconception=misconception.student_facing_description
                        if misconception
                        else None,
                        student_message=row.content or "",
                    )
                )
            except ModelConcernError:
                concern = safeguarding.Tripwire("other", "MEDIUM", "(tutor model)")
                return _with_turn(
                    _safeguarding_end(deps, lesson, concern, row.content or "", "tutor"), lesson
                )
    return Command(goto=goto, update={"turn": lesson["turn"], "outbox": entries})


def recheck(state: Lesson, runtime: Runtimes) -> Command[Any]:
    deps = runtime.context
    lesson: Lesson = {**state, "state": "RECHECK"}
    node = state.get("node") or ""
    code = state.get("misconception")
    # A different question that can show the same slip.
    template = (
        _choose_template(deps, lesson, node, "recheck", reveals=code)
        if code
        else state.get("template") or _choose_template(deps, lesson, node, "recheck")
    )
    item = _new_item(
        deps,
        lesson,
        node,
        f"recheck:{state.get('items_done', 0)}",
        template,
        unlike=state.get("item"),
    )
    return Command(
        goto="wait_recheck",
        update={
            **ITEM_RESET,
            "misconception": code,
            "state": "RECHECK",
            "item": item,
            "recheck": True,
            "started_ms": _ms(),
            "outbox": [_item_entry(lesson, item, faded=False)],
        },
    )


def wait_recheck(state: Lesson, runtime: Runtimes) -> Command[Any]:
    deps = runtime.context
    value = interrupt({"waiting_for": ["answer", "message", "help", "pause"]})
    lesson = _begin_turn(state)
    handled = _handle_common(deps, lesson, value, "wait_recheck")
    if handled is not None:
        return _with_turn(handled, lesson)
    if value.get("kind") != "answer":
        return _stay("wait_recheck", lesson)
    check, instead = _read_answer(deps, lesson, value, "wait_recheck")
    if instead is not None or check is None:
        return _with_turn(instead or _stay("wait_recheck", lesson), lesson)
    attempt = _store_attempt(deps, lesson, value.get("mathjson"), check)
    correct = check["correct"]
    marked: Lesson = {
        **lesson,
        "answer": value.get("mathjson"),
        "check": check,
        "correct": correct,
        "attempt_id": attempt,
    }
    update: dict[str, Any] = {
        "turn": lesson["turn"],
        "answer": value.get("mathjson"),
        "check": check,
        "correct": correct,
        "attempt_id": attempt,
    }
    if not correct:
        codes = check["codes"]
        return Command(
            goto="diagnose",
            update={
                **update,
                "misconception": codes[0] if codes else state.get("misconception"),
                "outbox": [_out(lesson, "marked", correct=False)],
            },
        )
    entries = [_out(lesson, "marked", correct=True), _say(deps, marked, "feedback_correct")]
    return Command(goto="update", update={**update, "outbox": entries, "misconception": None})


def update(state: Lesson, runtime: Runtimes) -> Command[Any]:
    deps = runtime.context
    # Wrong answers were applied in DIAGNOSE; a correct one is applied here, once.
    applied = state.get("applied")
    if state.get("correct"):
        applied = _apply(deps, {**state, "state": "UPDATE"}, [])
    queue = list(state.get("queue") or [])
    node = state.get("node")
    if node and not state.get("correct"):
        # Two failures on a node: probe its prerequisites first (SPEC.md section 7.1).
        practisable = deps.practisable()
        info = next(
            (i for i in learner_store.node_infos(deps.session, practisable) if i.code == node),
            None,
        )
        if info is not None and info.prerequisites:
            probe = learner_store.prerequisite_to_probe(
                deps.session,
                student=uuid.UUID(state["student"]),
                node=_node_row(deps, node),
                prerequisites=info.prerequisites,
                practisable=practisable,
            )
            if probe is not None:
                queue.insert(0, {"node": probe, "mode": "diagnostic", "misconception": None})
    return Command(goto="schedule", update={"state": "UPDATE", "applied": applied, "queue": queue})


def schedule(state: Lesson, runtime: Runtimes) -> Command[Any]:
    # The FSRS review card was updated with the learner model (learner_store.apply_answer);
    # reviews that fall due join a later session's plan.
    return Command(goto="next_step", update={"state": "SCHEDULE"})


def next_step(state: Lesson, runtime: Runtimes) -> Command[Any]:
    done = state.get("items_done", 0) + 1
    if done >= ITEMS_PER_SESSION:
        return _end(runtime.context, {**state, "items_done": done}, "FINISHED")
    return Command(goto="plan", update={"state": "NEXT", "items_done": done})


NODES: dict[str, Callable[..., Command[Any]]] = {
    "plan": plan,
    "teach": teach,
    "wait_teach": wait_teach,
    "faded": faded,
    "wait_faded": wait_faded,
    "independent": independent,
    "wait_independent": wait_independent,
    "wait_confidence": wait_confidence,
    "mark": mark,
    "diagnose": diagnose,
    "wait_explain": wait_explain,
    "follow_up": follow_up,
    "wait_follow_up": wait_follow_up,
    "recheck": recheck,
    "wait_recheck": wait_recheck,
    "update": update,
    "schedule": schedule,
    "next_step": next_step,
}


def builder() -> StateGraph[Any, Any, Any, Any]:
    graph: StateGraph[Any, Any, Any, Any] = StateGraph(Lesson, context_schema=Deps)
    for name, node in NODES.items():
        graph.add_node(name, node)
    graph.add_edge(START, "plan")
    return graph


BUILDER = builder()


def build(checkpointer: Any) -> CompiledStateGraph[Any, Any, Any, Any]:
    return BUILDER.compile(checkpointer=checkpointer)
