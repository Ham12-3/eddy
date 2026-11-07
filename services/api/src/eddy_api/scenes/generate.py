"""Tier L generation (SPEC.md section 7.2, ADR-0030): Claude rewrites a scene's beats, and nothing
is stored until every check passes.

1. The scene engine gives the context: the reviewed Tier D spec for this item, the elements and
   beat kinds the template has (and what each element shows), its maths claims and the answer the
   misconception predicts.
2. Claude returns only the beats, through structured output whose schema lists exactly those
   elements and kinds. It cannot change the template, the item, the numbers or the answers.
3. Checks: the generated pydantic Beat model, the Python narration checks, the scene engine
   (schema, beat order, layout in both formats, static checks) and maths-core (claims, answers,
   every number in the narration and the labels).
4. Any problem goes back to Claude as structured feedback, up to `max_attempts` attempts. A cut-off
   or malformed answer counts as a failed attempt; a refusal ends the run. A variant that never
   passes is not used.

Nothing personal goes in a prompt: the item, the misconception's predicted answer (MathJSON), why
a new version was asked for, a confidence level and earlier narration this student saw. No
student text at all. Every value inside a tag is JSON with <, > and & escaped, so no data can
close a tag or open one.
"""

import json
import time
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any, Literal

import yaml
from pydantic import ValidationError

from eddy_api.llm.client import (
    LlmClient,
    LlmOutputError,
    LlmRefusalError,
    LlmTruncatedError,
    StructuredResult,
)
from eddy_api.llm.config import REPO_ROOT
from eddy_api.llm.prompts import Prompt, load_prompt
from eddy_api.scenes.narration import narration_problems
from eddy_api.scenes.services import MathsCoreClient, SceneCheckClient
from eddy_api.scenes.spec import Beat

Reason = Literal["another_way", "recurred", "precompute"]
Confidence = Literal["low", "medium", "high"]
MAX_ATTEMPTS = 3
MISCONCEPTIONS = REPO_ROOT / "curriculum" / "maths" / "misconceptions.yaml"
BACKSLASH = chr(92)
TAG_ESCAPES = {"&": BACKSLASH + "u0026", "<": BACKSLASH + "u003c", ">": BACKSLASH + "u003e"}

# Descriptions, not instructions: they sit inside a data tag.
REASONS: dict[str, str] = {
    "another_way": "The student watched the reviewed explanation and asked to see it another way.",
    "recurred": "The student has made this mistake before and has seen an explanation of it.",
    "precompute": "This version is prepared in advance for students who need another way in.",
}


@dataclass(frozen=True)
class VariantRequest:
    #: Scene template key, without the version ("bar_model.share_in_ratio").
    template: str
    item: dict[str, Any]
    #: The misconception's predicted answer, which the student's answer was checked to equal.
    student_answer: Any
    #: The item's correct answer from the verified bank (MathJSON).
    answer: Any
    reason: Reason
    confidence: Confidence | None = None
    #: Versions this student has already seen, each as its narration lines.
    seen: Sequence[Sequence[str]] = ()
    #: Why an earlier variant failed review (the background critique), to avoid repeating it.
    feedback: Sequence[str] = ()
    student_id: uuid.UUID | None = None


@dataclass
class Attempt:
    number: int
    problems: list[str]
    cost_gbp: float
    latency_ms: int
    cache_read_tokens: int = 0


@dataclass
class Variant:
    passed: bool
    spec: dict[str, Any] | None
    #: The beats from Claude's last attempt.
    beats: list[dict[str, Any]]
    attempts: list[Attempt] = field(default_factory=list)
    model: str = ""
    prompt: Prompt | None = None
    latency_ms: int = 0
    refused: bool = False

    @property
    def cost_gbp(self) -> float:
        return round(sum(a.cost_gbp for a in self.attempts), 6)


@lru_cache
def misconception_notes() -> dict[str, dict[str, str]]:
    raw = yaml.safe_load(MISCONCEPTIONS.read_bytes())
    return {m["code"]: m for m in raw["misconceptions"]}


def data(value: Any) -> str:
    """JSON that cannot close or open a tag: <, > and & are escaped as JSON allows."""
    text = json.dumps(value, ensure_ascii=False)
    for char, escape in TAG_ESCAPES.items():
        text = text.replace(char, escape)
    return text


def beats_schema(focus_ids: Sequence[str], beat_kinds: Sequence[str]) -> dict[str, Any]:
    """Structured output for one template: only its elements and beat kinds can be written."""
    return {
        "type": "object",
        "properties": {
            "beats": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "kind": {"type": "string", "enum": list(beat_kinds)},
                        "focus": {
                            "type": "array",
                            "items": {"type": "string", "enum": list(focus_ids)},
                        },
                        "narration": {"type": "string"},
                    },
                    "required": ["kind", "focus", "narration"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["beats"],
        "additionalProperties": False,
    }


def template_block(context: dict[str, Any]) -> str:
    """What stays the same for every item of a template: after the prompt, before the breakpoint."""
    notes = misconception_notes().get(context["misconception"], {})
    described = {
        "template": context["template"],
        "title": context["title"],
        "misconception": context["misconception"],
        "misconception_description": notes.get("teacher", ""),
        "elements_in_order": context["focusIds"],
        "beat_kinds": context["beatKinds"],
    }
    return f"<scene_template>{data(described)}</scene_template>"


def student_block(request: VariantRequest, context: dict[str, Any]) -> str:
    """This item and this student: after the cache breakpoint. Data, never instructions."""
    tier_d = [
        {"kind": b["kind"], "focus": b["focus"], "narration": b["narration"]}
        for b in context["tierD"]["beats"]
    ]
    correct = context["tierD"]["correctAnswer"]
    parts = [
        f"<item_parameters>{data(request.item)}</item_parameters>",
        f"<elements_on_screen>{data(context.get('elements', {}))}</elements_on_screen>",
        f"<reviewed_scene>{data(tier_d)}</reviewed_scene>",
        f"<student_answer_mathjson>{data(request.student_answer)}</student_answer_mathjson>",
        f"<correct_answer_mathjson>{data(correct)}</correct_answer_mathjson>",
        f"<why>{data(REASONS[request.reason])}</why>",
    ]
    if request.confidence:
        parts.append(f"<confidence>{data(request.confidence)}</confidence>")
    for number, version in enumerate(request.seen, start=1):
        parts.append(f'<already_seen version="{number}">{data(list(version))}</already_seen>')
    if request.feedback:
        parts.append(
            f"<earlier_version_failed_review>{data(list(request.feedback))}"
            "</earlier_version_failed_review>"
        )
    parts.append("Write the beats for this student.")
    return "\n".join(parts)


def feedback_message(problems: Sequence[str]) -> str:
    return (
        f"<check_results>{data(list(problems))}</check_results>\n"
        "That version failed these checks. Write all the beats again, fixing every problem."
    )


def _parse_beats(raw_data: dict[str, Any]) -> tuple[list[dict[str, Any]], list[str]]:
    """All the beats, or none: a beat that fails the model would shift the numbers of the rest."""
    raw = raw_data.get("beats")
    if not isinstance(raw, list):
        return [], ["The answer had no list of beats."]
    beats: list[dict[str, Any]] = []
    problems: list[str] = []
    for i, entry in enumerate(raw, start=1):
        try:
            beats.append(Beat.model_validate(entry).model_dump(mode="json"))
        except ValidationError as error:
            problems.append(f"Beat {i}: {error.errors()[0]['msg']}")
    return ([], problems) if problems else (beats, [])


def _check(
    request: VariantRequest,
    context: dict[str, Any],
    result: StructuredResult,
    scene_check: SceneCheckClient,
    maths_core: MathsCoreClient,
) -> tuple[list[dict[str, Any]], dict[str, Any] | None, list[str]]:
    beats, problems = _parse_beats(result.data)
    if not beats:
        return beats, None, problems
    reference = [b["narration"] for b in context["tierD"]["beats"]]
    problems += narration_problems(
        [b["narration"] for b in beats], reference=reference, seen=request.seen
    )
    check = scene_check.check(request.template, request.item, request.student_answer, beats)
    problems += check["problems"]
    spec = check["spec"]
    if spec is not None:
        verdict = maths_core.verify_scene(
            spec=spec,
            answer=request.answer,
            predicted=check["predicted"],
            claims=check["claims"],
            labels=check["labels"],
        )
        problems += verdict["problems"]
    return beats, spec, problems


def generate_variant(
    request: VariantRequest,
    *,
    llm: LlmClient,
    scene_check: SceneCheckClient,
    maths_core: MathsCoreClient,
    max_attempts: int = MAX_ATTEMPTS,
) -> Variant:
    """Raises LlmUnavailableError, LlmRequestError or SceneServiceError when a service fails."""
    start = time.perf_counter()
    prompt = load_prompt("scene-spec")
    context = scene_check.context(request.template, request.item, request.student_answer)
    schema = beats_schema(context["focusIds"], context["beatKinds"])
    blocks = [template_block(context)]
    messages: list[dict[str, Any]] = [{"role": "user", "content": student_block(request, context)}]
    variant = Variant(passed=False, spec=None, beats=[], prompt=prompt)
    for number in range(1, max_attempts + 1):
        try:
            result = llm.structured(
                prompt=prompt,
                context=blocks,
                messages=messages,
                schema=schema,
                student_id=request.student_id,
            )
        except (LlmTruncatedError, LlmOutputError, LlmRefusalError) as error:
            record = error.record
            variant.attempts.append(
                Attempt(
                    number=number,
                    problems=[str(error)],
                    cost_gbp=record.cost_gbp if record else 0.0,
                    latency_ms=record.latency_ms if record else 0,
                )
            )
            if isinstance(error, LlmRefusalError):
                variant.refused = True
                break
            # Nothing usable to send back: ask again from the same conversation.
            continue
        variant.model = result.record.model
        beats, spec, problems = _check(request, context, result, scene_check, maths_core)
        variant.attempts.append(
            Attempt(
                number=number,
                problems=problems,
                cost_gbp=result.record.cost_gbp,
                latency_ms=result.record.latency_ms,
                cache_read_tokens=result.record.usage.cache_read_tokens,
            )
        )
        variant.beats = beats
        if not problems and spec is not None:
            variant.passed, variant.spec = True, spec
            break
        messages += [
            {"role": "assistant", "content": result.text},
            {"role": "user", "content": feedback_message(problems)},
        ]
    variant.latency_ms = round((time.perf_counter() - start) * 1000)
    return variant
