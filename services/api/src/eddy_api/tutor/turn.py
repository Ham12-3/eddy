"""One tutor turn, through the whole safety pipeline (SPEC.md section 9.2, ADR-0031).

For a student message:

1. Limits: a length cap (the per-student rate limit and cost guards are in the route).
2. Deterministic safeguarding tripwires.
3. The input classifier (Haiku 4.5), which also runs after a tripwire hit so the more severe
   reading is kept: safeguarding, harmful request, off topic, prompt injection, answer demand,
   help request. A refusal to classify is treated as a concern; any other failure leaves the
   message unread (a static reply), never tutored.
4. Safeguarding: stop tutoring, show the static script, record a `safeguarding_event`.
5. Generate the step's message with Opus 4.8. Student text is delimited data.
6. Output checks: the TutorMessage model, word limit and hint level, UK English and tone, one
   question at a time, no confirming a guess, no links or contact details, every number traced
   to the question or to a verified claim, maths verification and the answer-leak check
   (maths-core), the item's answer in the text, and the output classifier (Haiku 4.5) for
   safety, tone and giving the answer away. The model can also flag a concern (step 4).
7. On failure, regenerate (at most 2 times), then a templated message at the same ladder level.

Steps the code starts with no student message (a worked example, a faded step, feedback) run
steps 5 to 7.
"""

import re
import unicodedata
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from fractions import Fraction
from typing import Any, Literal

from eddy_api.llm.client import (
    LlmClient,
    LlmError,
    LlmRefusalError,
    LlmRequestError,
    LlmUnavailableError,
)
from eddy_api.llm.io import InputVerdict, OutputVerdict, TutorMessage
from eddy_api.llm.prompts import load_prompt
from eddy_api.llm.structured import output_schema, parse
from eddy_api.scenes.generate import data
from eddy_api.scenes.narration import (
    DASHES,
    EMAIL,
    IZE_ALLOWED,
    PHONE,
    TONE,
    US_SPELLINGS,
    WEB,
    WORD,
    words,
)
from eddy_api.scenes.services import MathsCoreClient, SceneServiceError
from eddy_api.tutor import safeguarding
from eddy_api.tutor.states import HINT_LADDER

MAX_STUDENT_CHARS = 1000
MAX_WORDS = 60
MAX_WORKED_EXAMPLE_WORDS = 150
MAX_REGENERATIONS = 2
HISTORY_TURNS = 6
EARLIER_MESSAGES = 2

Purpose = Literal[
    "worked_example",
    "faded_step",
    "hint",
    "reply",
    "feedback_correct",
    "feedback_wrong",
    "wrong_question",
    "follow_up",
    "follow_up_reply",
    "redirect",
    "answer_demand",
    "refuse",
]

#: What each step asks Claude for: the message kind, and the instruction.
STEPS: dict[Purpose, tuple[str, str]] = {
    "worked_example": (
        "worked_example_parallel",
        "Show a short worked example of the parallel problem, step by step, before they try "
        "the question themselves. Use the parallel problem's numbers, never the question's.",
    ),
    "faded_step": (
        "hint",
        "Show only the first line of working for the question (one operation and its result), "
        "then ask them to finish it. Do not describe or show any later step, and never the "
        "answer.",
    ),
    "hint": (
        "hint",
        "Write a hint at the level given, for the question. At level 4, show a short worked "
        "example of the parallel problem (its numbers, not the question's), then ask them to "
        "use the same steps on the question.",
    ),
    "reply": (
        "question",
        "Reply to what they just said (in student_message), starting from their words. If it "
        "is a question you can answer without giving the answer away, answer it in one or two "
        "sentences; if they ask what you are, say you are an AI tutor. Then ask one question "
        "that brings them back to the maths.",
    ),
    "feedback_correct": (
        "feedback",
        "They answered correctly. Say so plainly. Praise only what is true: their_effort says "
        "how many hints they used and how sure they felt. No question.",
    ),
    "feedback_wrong": (
        "feedback",
        "Their answer is not right yet. Say so kindly in one sentence, without giving the "
        "answer. A short animation of their slip comes next, so do not explain it here. No "
        "question.",
    ),
    "wrong_question": (
        "question",
        "Their answer is not right yet. Say so kindly, without giving the answer, then ask one "
        "Socratic question that helps them find the slip in their answer themselves. If "
        "their_slip is given, aim the question at it without naming it outright. Leave the "
        "working to them: do not set up the calculation in the question.",
    ),
    "follow_up": (
        "question",
        "They have just watched a short animation of their slip (their_slip). Ask one Socratic "
        "question that checks they now see why their method did not work. Do not give the "
        "answer.",
    ),
    "follow_up_reply": (
        "feedback",
        "They have answered your question (in student_message). Respond in one or two "
        "sentences: say what they now see, or give the smallest correction to their idea. Do "
        "not describe the remaining steps of the method, and never give the answer. No "
        "question: a fresh question comes next.",
    ),
    "redirect": (
        "redirect",
        "Their message (in student_message) was off topic. Bring them back to the question "
        "warmly, in one or two sentences.",
    ),
    "answer_demand": (
        "worked_example_parallel",
        "They asked for the answer, or for a guess to be confirmed. Say kindly, in one "
        "sentence, why you will not give it or say whether a guess is right, then show a short "
        "worked example of the parallel problem (its numbers, not the question's).",
    ),
    "refuse": (
        "redirect",
        "Their message asked for something you cannot help with. Say so briefly and kindly, "
        "then bring them back to the question.",
    ),
}

#: Templated messages when every generated version fails (step 7), or Claude is off: safe,
#: generic, never the answer. Hints keep the ladder level they were asked for.
FALLBACK_HINTS = {
    1: "Take another look at the question. What exactly is it asking you to find?",
    2: "Which piece of information in the question do you need to use first?",
    3: (
        "Look back at the worked example. Find the step that matches where you are stuck, and "
        "do the same with these numbers."
    ),
    4: (
        "Write down the first line of your working and send it to me. I can help with the next "
        "step from there."
    ),
}
FALLBACKS: dict[Purpose, str] = {
    "worked_example": (
        "Have a go at this question. If you get stuck, ask for a hint and we will take it one "
        "step at a time."
    ),
    "faded_step": (
        "Start with the first line of your working. Ask for a hint if you are not sure what it is."
    ),
    "reply": "Thanks. Let's keep going with the question. Ask for a hint any time you are stuck.",
    "feedback_correct": "That is right.",
    "feedback_wrong": "Not quite yet. This short animation shows what happened.",
    "wrong_question": "Not quite yet. Look at your answer again. Which step would you change?",
    "follow_up": "Look at your answer again. Which step would you change?",
    "follow_up_reply": "Thank you. Keep that in mind on the next question.",
    "redirect": "Let's get back to the maths. Have another look at the question.",
    "answer_demand": (
        "I won't give you the answer, because working it out yourself is what makes it stick. "
        "Ask for a hint and I will take you through it one step at a time."
    ),
    "refuse": "I can't help with that here. Let's get back to the maths.",
}


@dataclass(frozen=True)
class ItemContext:
    template_id: str
    seed: int
    node: str
    node_title: str
    stem: str
    answer: Any
    command_word: str = ""
    marks: int = 1
    calculator: bool = True
    #: A choice between values the question lists: naming the answer gives it away.
    choice: bool = False


@dataclass(frozen=True)
class TurnRequest:
    purpose: Purpose
    item: ItemContext
    hint_level: int = 0
    #: The parallel problem for a worked example (same template, another seed).
    parallel: ItemContext | None = None
    #: The student's previous answers on this item (MathJSON) and whether each was correct.
    attempts: Sequence[tuple[Any, bool]] = ()
    #: The misconception, in the plain words students see, once diagnosed.
    misconception: str | None = None
    #: The conversation so far, oldest first: ("student" or "tutor", text).
    history: Sequence[tuple[str, str]] = ()
    #: The student's message this step answers, when there is one.
    student_message: str | None = None
    hints_used: int = 0
    confidence: int | None = None
    student_id: uuid.UUID | None = None


@dataclass
class TurnResult:
    message: TutorMessage
    source: Literal["model", "fallback", "safeguarding"]
    flags: list[str] = field(default_factory=list)
    attempts: list[list[str]] = field(default_factory=list)
    #: Each generated draft as the model wrote it, for the eval's report.
    drafts: list[str] = field(default_factory=list)
    cost_gbp: float = 0.0
    model: str | None = None
    prompt_version: str | None = None
    #: The tutor model flagged a possible safeguarding concern in the student's message.
    concern: bool = False


@dataclass(frozen=True)
class Screened:
    """What steps 1 to 3 decided about a student message."""

    purpose: Purpose | None
    flags: list[str]
    concern: safeguarding.Tripwire | None = None


def expected(request: TurnRequest) -> tuple[str, int]:
    """The message kind and hint level a step must have."""
    kind, _ = STEPS[request.purpose]
    if request.purpose == "answer_demand":
        return "worked_example_parallel", 4
    if request.purpose == "hint" and request.hint_level >= 4:
        return "worked_example_parallel", 4
    return kind, request.hint_level if kind == "hint" else 0


def fallback(purpose: Purpose, hint_level: int, *, hints_used: int | None = None) -> TutorMessage:
    kind, _ = STEPS[purpose]
    if purpose == "hint":
        level = max(1, min(hint_level, 4))
        text, kind = FALLBACK_HINTS[level], "hint"
    else:
        level = hint_level if kind == "hint" else 0
        text = FALLBACKS[purpose]
    if purpose == "feedback_correct" and hints_used == 0:
        text = "That is right, and you did it without a hint."
    # A templated worked example has no worked steps, so it is sent as a plain message.
    if kind == "worked_example_parallel":
        kind, level = "redirect", 0
    return TutorMessage(
        text=text,
        kind=kind,
        hint_level=level if kind == "hint" else 0,
        maths=[],
        concern=False,
    )


def script_message() -> TutorMessage:
    return TutorMessage(
        text=safeguarding.SCRIPT, kind="redirect", hint_level=0, maths=[], concern=False
    )


# Steps 1 to 3: limits, tripwires and the input classifier.


def screen(
    text: str,
    llm: LlmClient,
    student_id: uuid.UUID | None = None,
    earlier: Sequence[str] = (),
) -> Screened:
    """Classifies a student message. Never raises: when the classifier cannot run, the message
    is marked unread (`classifier_unavailable`), unless a tripwire already caught it."""
    text = text[:MAX_STUDENT_CHARS]
    hit = safeguarding.tripwire(text)
    flags = ["tripwire"] if hit else []
    content = f"<student_message>{data(text)}</student_message>"
    if earlier:
        recent = [m[:MAX_STUDENT_CHARS] for m in earlier[-EARLIER_MESSAGES:]]
        content = f"<earlier_messages>{data(recent)}</earlier_messages>\n{content}"
    try:
        result = llm.structured(
            prompt=load_prompt("safety-input"),
            context=[],
            messages=[{"role": "user", "content": content}],
            schema=output_schema(InputVerdict),
            student_id=student_id,
            max_tokens=1024,
        )
        verdict = parse(InputVerdict, result)
    except LlmRefusalError:
        # A classifier that will not read a message is treated as a concern.
        refused = safeguarding.Tripwire("other", "HIGH", "(classifier refused)")
        return Screened(
            None, [*flags, "classifier_refusal"], safeguarding.more_severe(refused, hit)
        )
    except LlmError:
        if hit:
            return Screened(None, flags, hit)
        return Screened(None, ["classifier_unavailable"])
    flags += [
        name
        for name in ("harmful_request", "off_topic", "prompt_injection", "answer_demand")
        if getattr(verdict, name)
    ]
    if verdict.safeguarding != "none":
        category = (
            verdict.safeguarding_category if verdict.safeguarding_category != "none" else "other"
        )
        found = safeguarding.Tripwire(
            category=category,
            severity=safeguarding.classifier_severity(verdict.safeguarding),
            phrase="(classifier)",
        )
        concern = found if hit is None else safeguarding.more_severe(hit, found)
        return Screened(None, [*flags, "classifier_safeguarding"], concern)
    if hit:
        return Screened(None, flags, hit)
    if verdict.harmful_request:
        return Screened("refuse", flags)
    if verdict.answer_demand:
        return Screened("answer_demand", flags)
    if verdict.off_topic:
        return Screened("redirect", flags)
    if verdict.help_request:
        return Screened("hint", flags)
    # Anything else, an attempted prompt injection included, is replied to as data.
    return Screened("reply", flags)


# Step 5: generate.


def _item_block(item: ItemContext) -> dict[str, Any]:
    block: dict[str, Any] = {
        "node": item.node,
        "topic": item.node_title,
        "question": item.stem,
        "command_word": item.command_word,
        "marks": item.marks,
        "calculator_allowed": item.calculator,
    }
    if item.choice:
        block["has_options"] = "Never say which option is right, and do not list them as given."
    return block


def user_message(request: TurnRequest) -> str:
    kind, instruction = STEPS[request.purpose]
    kind, level = expected(request)
    parts = [
        f"<step>{data({'kind': kind, 'hint_level': level, 'ladder': HINT_LADDER[level]})}</step>",
        f"<what_to_write>{data(instruction)}</what_to_write>",
        f"<question>{data(_item_block(request.item))}</question>",
    ]
    if request.parallel is not None and kind == "worked_example_parallel":
        parallel = {**_item_block(request.parallel), "answer": request.parallel.answer}
        parts.append(f"<parallel_problem>{data(parallel)}</parallel_problem>")
    if request.attempts:
        tried = [{"answer_mathjson": a, "correct": c} for a, c in request.attempts]
        parts.append(f"<their_answers>{data(tried)}</their_answers>")
    if request.purpose == "feedback_correct":
        effort = {"hints_used": request.hints_used, "how_sure_1_to_4": request.confidence}
        parts.append(f"<their_effort>{data(effort)}</their_effort>")
    if request.misconception:
        parts.append(f"<their_slip>{data(request.misconception)}</their_slip>")
    if request.history:
        recent = [{"from": who, "text": text} for who, text in request.history[-HISTORY_TURNS:]]
        parts.append(f"<conversation>{data(recent)}</conversation>")
    if request.student_message is not None:
        message = request.student_message[:MAX_STUDENT_CHARS]
        parts.append(f"<student_message>{data(message)}</student_message>")
    return "\n".join(parts)


# Step 6: output checks.

# A number, and a full stop after it ends a sentence (only ".5" continues a number).
NUMBER = re.compile(r"(?<![\w.])(-?\d+(?:\.\d+)?)(?:/(\d+))?(?!\w|\.\d)")
LATEX_FRACTION = re.compile(r"\\d?frac\{\s*(-?\d+)\s*\}\{\s*(\d+)\s*\}")
# Saying what a value is: "x = 12", "the answer is 12", "it equals 12".
STATES_VALUE = re.compile(
    r"(?:=|\bequals\b|\bis\b|\bbe\b|\bgives\b|\bmakes\b|\bget\b)\s*"
    r"(-?\d+(?:\.\d+)?(?:/\d+)?)(?!\w|\.\d|\s*[-+*/x\u00d7\u00f7^]\s*\d)",
    re.IGNORECASE,
)
# Numbers that label steps ("Step 2") are not maths.
STEP_LABEL = re.compile(r"\bstep\s+\d+\b", re.IGNORECASE)
# Confirming or ruling out a guess at the final answer.
CONFIRMS = re.compile(
    r"^\W*(yes|yeah|yep|yup|no|nope|correct|right|exactly|spot on|that'?s it|not quite|close|"
    r"nearly)\b",
    re.IGNORECASE,
)
WARMER = re.compile(
    r"\b(warmer|colder|you'?re close|you are close|getting close|so close|nearly there|"
    r"too high|too low|go higher|go lower)\b",
    re.IGNORECASE,
)
# Steps where an opening "yes" or "no" can only be about a guess ("reply" may answer "are you
# a person?" with "No, I am an AI tutor").
CONFIRM_PURPOSES = frozenset({"hint", "redirect", "answer_demand", "refuse"})
WARMER_PURPOSES = CONFIRM_PURPOSES | {"reply"}


def _as_fraction(value: Any) -> Fraction | None:
    """A numeric answer as an exact fraction, or None when the answer is not a single number."""
    try:
        if isinstance(value, bool):
            return None
        if isinstance(value, int | float):
            return Fraction(str(value))
        if isinstance(value, dict) and isinstance(value.get("num"), str):
            return Fraction(value["num"])
        if isinstance(value, list) and len(value) == 3 and value[0] == "Rational":
            return Fraction(int(value[1]), int(value[2]))
        if isinstance(value, list) and len(value) == 2 and value[0] == "Negate":
            inner = _as_fraction(value[1])
            return -inner if inner is not None else None
    except (ValueError, TypeError, ZeroDivisionError):
        return None
    return None


def _clean(text: str) -> str:
    text = LATEX_FRACTION.sub(lambda m: f"{m.group(1)}/{m.group(2)}", text)
    return text.replace(chr(0x2212), "-").replace(",", "")


def numbers_in(text: str) -> set[Fraction]:
    found: set[Fraction] = set()
    for whole, denominator in NUMBER.findall(_clean(text)):
        try:
            found.add(Fraction(whole) / int(denominator) if denominator else Fraction(whole))
        except (ValueError, ZeroDivisionError):
            continue
    return found


def numbers_in_json(value: Any) -> set[Fraction]:
    """Every number a MathJSON expression holds, parts of fractions included."""
    found: set[Fraction] = set()
    single = _as_fraction(value)
    if single is not None:
        found.add(single)
    if isinstance(value, list):
        for part in value:
            found |= numbers_in_json(part)
    elif isinstance(value, dict):
        for part in value.values():
            found |= numbers_in_json(part)
    elif isinstance(value, str):
        found |= numbers_in(value)
    return found


def answer_in_text(text: str, item: ItemContext) -> bool:
    """Whether the text writes the item's numeric answer.

    When the question does not state the answer's value, any mention gives it away. When it
    does ("Solve 5x + 12 = 72", answer 12), saying what a value is ("x = 12", "is 12") does. On
    a question with options the answer is in the question, so maths-core's leak check and the
    output classifier cover pointing at it.
    """
    answer = _as_fraction(item.answer)
    if answer is None:
        return False
    if answer not in numbers_in(item.stem):
        return answer in numbers_in(text)
    if item.choice:
        return False
    for match in STATES_VALUE.finditer(_clean(text)):
        if numbers_in(match.group(1)) & {answer}:
            return True
    return False


def untraced_numbers(message: TutorMessage, request: TurnRequest) -> set[Fraction]:
    """Numbers in the text that are in neither the question (or the parallel problem) nor a
    maths claim: maths-core checks claims, so every number must be one of these."""
    stems = [request.item.stem] + ([request.parallel.stem] if request.parallel else [])
    given = {n for stem in stems for n in numbers_in(stem)}
    # How many values a question lists is a fact about it too ("there are 9 values").
    given |= {Fraction(len(NUMBER.findall(_clean(stem)))) for stem in stems}
    # A given number with either sign is still the question's number ("x - 9" and "the -9").
    allowed = given | {abs(n) for n in given} | {-n for n in given}
    # The student's own answers and words can be talked about (the answer check still applies).
    for answer, _ in request.attempts:
        allowed |= numbers_in_json(answer)
    if request.student_message:
        allowed |= numbers_in(request.student_message)
    # 0, 1 and, with percentages, 100 are reference points rather than results.
    allowed |= {Fraction(0), Fraction(1)}
    if "%" in message.text or "per cent" in message.text.lower():
        allowed.add(Fraction(100))
    for entry in message.maths:
        allowed |= numbers_in_json(expression(entry))
    return numbers_in(STEP_LABEL.sub(" ", message.text)) - allowed


def repaired(message: TutorMessage, request: TurnRequest) -> TutorMessage:
    """The kind and hint level the step asks for. They are labels the student never reads, so
    a wrong one is corrected rather than sent back to the model (a reply may be a question or
    a redirect)."""
    kind, level = expected(request)
    if request.purpose == "reply" and message.kind in ("question", "redirect"):
        kind = message.kind
    return message.model_copy(update={"kind": kind, "hint_level": level})


def static_problems(message: TutorMessage, request: TurnRequest) -> list[str]:
    problems: list[str] = []
    kind, _ = expected(request)
    text = message.text
    limit = MAX_WORKED_EXAMPLE_WORDS if kind == "worked_example_parallel" else MAX_WORDS
    count = len(words(text))
    if count > limit:
        problems.append(f"{count} words; at most {limit}.")
    if DASHES.search(text):
        problems.append("Contains a dash. Use a full stop or a comma instead.")
    if any(unicodedata.category(c) in ("Cc", "Cf") and c != "\n" for c in text):
        problems.append("Contains a control or invisible character.")
    if unicodedata.normalize("NFC", text) != text:
        problems.append("Is not in Unicode NFC form.")
    if "!" in text:
        problems.append("Contains an exclamation mark.")
    if any(unicodedata.category(c) == "So" and c != chr(0xB0) for c in text):
        problems.append("Contains an emoji or picture symbol.")
    if tone := TONE.search(text):
        problems.append(f'Says "{tone.group(1)}". Name the slip, never the student.')
    for word in WORD.findall(text):
        lower = word.lower()
        uk = US_SPELLINGS.get(lower)
        if uk:
            problems.append(f'Write "{uk}", not "{word}" (UK English).')
        elif re.search(r"(ize|izes|ized|izing|yze|yzes|yzed)$", lower) and (
            lower not in IZE_ALLOWED
        ):
            problems.append(f'Use the -ise or -yse spelling, not "{word}" (UK English).')
    # A worked example may quote its own problem's question before the one it asks.
    if text.count("?") > (2 if kind == "worked_example_parallel" else 1):
        problems.append("Asks more than one question; ask one at a time.")
    if EMAIL.search(text) or WEB.search(text) or PHONE.search(text):
        problems.append("Contains a link or contact details.")
    confirms = request.purpose in CONFIRM_PURPOSES and CONFIRMS.search(text)
    if confirms or (request.purpose in WARMER_PURPOSES and WARMER.search(text)):
        problems.append(
            "Confirms or rules out a guess. Never say whether a guess is right; ask how they "
            "got it, and tell them to enter it as their answer."
        )
    if request.purpose != "feedback_correct" and answer_in_text(text, request.item):
        problems.append("States the answer to the question. Never give the answer.")
    untraced = untraced_numbers(message, request)
    if untraced:
        listed = ", ".join(sorted(str(n) for n in untraced))
        problems.append(
            f"States {listed}, which is not in the question or in maths. List every number "
            "fact you state in maths, so it can be checked."
        )
    return problems


def expression(entry: Any) -> Any:
    """A maths entry's MathJSON as plain JSON (integers stay integers)."""
    value = entry.model_dump(mode="json")["expr"] if hasattr(entry, "model_dump") else entry
    return value["expr"] if isinstance(value, dict) and "expr" in value else value


def _claims(message: TutorMessage) -> tuple[list[dict[str, Any]], list[str]]:
    claims = [{"role": entry.role, "expr": expression(entry)} for entry in message.maths]
    problems = [
        f'maths {index} is a lone {value!r}; write MathJSON such as ["Equal", left, right].'
        for index, value in enumerate((c["expr"] for c in claims), start=1)
        if isinstance(value, str) and value.strip() in ("[", "]", "")
    ]
    return claims, problems


def maths_problems(
    message: TutorMessage, request: TurnRequest, maths_core: MathsCoreClient
) -> list[str]:
    """Every statement true (against the parallel problem for a worked example), none leaking
    the question's answer."""
    claims, problems = _claims(message)
    if not claims:
        return problems
    leaks = maths_core.verify_claims(claims, request.item.template_id, request.item.seed)
    if request.purpose != "feedback_correct":
        for result in leaks["claims"]:
            if result["leaks_answer"]:
                problems.append(
                    f"maths {result['index'] + 1} gives away the answer to the question."
                )
    kind, _ = expected(request)
    anchor = request.parallel if kind == "worked_example_parallel" else request.item
    verdict = (
        leaks
        if anchor is request.item or anchor is None
        else maths_core.verify_claims(claims, anchor.template_id, anchor.seed)
    )
    for result in verdict["claims"]:
        if not result["verified"]:
            problems.append(
                f"maths {result['index'] + 1} could not be verified: {result['problem']}."
            )
    return problems


def output_check(
    message: TutorMessage, request: TurnRequest, llm: LlmClient
) -> tuple[list[str], float]:
    kind, level = expected(request)
    parts = [
        f"<question>{data(request.item.stem)}</question>",
        f"<answer>{data(request.item.answer)}</answer>",
        f"<step>{data({'purpose': request.purpose, 'kind': kind, 'hint_level': level})}</step>",
    ]
    if request.student_message is not None:
        message_text = request.student_message[:MAX_STUDENT_CHARS]
        parts.append(f"<student_message>{data(message_text)}</student_message>")
    parts.append(f"<tutor_message>{data(message.text)}</tutor_message>")
    result = llm.structured(
        prompt=load_prompt("safety-output"),
        context=[],
        messages=[{"role": "user", "content": "\n".join(parts)}],
        schema=output_schema(OutputVerdict),
        student_id=request.student_id,
        max_tokens=1024,
    )
    verdict = parse(OutputVerdict, result)
    problems = [problem.root for problem in verdict.problems]
    if not verdict.safe:
        problems.append("The safety check found it unsuitable for a child.")
    if not verdict.kind_and_respectful:
        problems.append("The tone check found it unkind or patronising.")
    if verdict.gives_away_answer:
        problems.append("It gives away the answer to the question.")
    if verdict.safe and verdict.kind_and_respectful and not verdict.gives_away_answer:
        problems = []
    return problems, result.record.cost_gbp


def generate(request: TurnRequest, *, llm: LlmClient, maths_core: MathsCoreClient) -> TurnResult:
    """Steps 5 to 7: generate, check, regenerate at most twice, then the templated message.

    Raises LlmUnavailableError when Claude cannot be reached (the caller uses the template).
    """
    prompt = load_prompt("tutor")
    messages: list[dict[str, Any]] = [{"role": "user", "content": user_message(request)}]
    result = TurnResult(
        message=fallback(request.purpose, request.hint_level, hints_used=request.hints_used),
        source="fallback",
    )
    result.prompt_version = prompt.version
    for _ in range(1 + MAX_REGENERATIONS):
        try:
            answer = llm.structured(
                prompt=prompt,
                context=[],
                messages=messages,
                schema=output_schema(TutorMessage),
                student_id=request.student_id,
                max_tokens=4000,
            )
        except LlmUnavailableError:
            raise
        except (LlmRequestError, LlmRefusalError) as error:
            # A request Claude rejects, or will not answer, does not get better on a retry.
            if error.record:
                result.cost_gbp += error.record.cost_gbp
            result.attempts.append([str(error)])
            return result
        except LlmError as error:
            if error.record:
                result.cost_gbp += error.record.cost_gbp
            result.attempts.append([str(error)])
            continue
        result.cost_gbp += answer.record.cost_gbp
        result.model = answer.record.model
        result.drafts.append(answer.text)
        try:
            message = repaired(parse(TutorMessage, answer), request)
        except LlmError as error:
            result.attempts.append([str(error)])
            continue
        if message.concern and request.student_message is not None:
            result.concern = True
            result.attempts.append(["The tutor model flagged a concern."])
            return result
        problems = static_problems(message, request)
        try:
            problems += maths_problems(message, request, maths_core)
        except SceneServiceError:
            problems.append("The maths could not be checked just now.")
        if not problems:
            try:
                safety, cost = output_check(message, request, llm)
            except LlmUnavailableError:
                # Unchecked text never reaches a student: the templated message is used.
                result.attempts.append(["The output check is unavailable."])
                return result
            except LlmError as error:
                safety, cost = [f"The output check could not run: {error}"], 0.0
            result.cost_gbp += cost
            problems += safety
        result.attempts.append(problems)
        if not problems:
            result.message, result.source = message, "model"
            return result
        messages += [
            {"role": "assistant", "content": answer.text},
            {
                "role": "user",
                "content": f"<check_results>{data(problems)}</check_results>\n"
                "That message failed these checks. Write it again, fixing every problem.",
            },
        ]
    return result
