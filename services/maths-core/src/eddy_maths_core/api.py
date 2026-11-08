"""HTTP models and routes for item generation and verification (SPEC.md section 7.3).

Private: only services/api calls these, with the shared X-Service-Token. Requests carry MathJSON,
never text to parse. Responses carry MathJSON and LaTeX, and answer keys only from /v1/items,
which services/api keeps server-side.
"""

from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, JsonValue

from eddy_maths_core.equivalence import equivalent
from eddy_maths_core.formats import AnswerFormat
from eddy_maths_core.items import TEMPLATES, Item, TemplateError
from eddy_maths_core.mathjson import to_sympy
from eddy_maths_core.scene_golden import check_record
from eddy_maths_core.serialize import answer_mathjson, to_latex, to_mathjson
from eddy_maths_core.verify import (
    AnswerCheck,
    ClaimResult,
    StepCheck,
    check_answer,
    check_steps,
    verify_claims,
)

router = APIRouter(prefix="/v1")
COULD_NOT_CHECK = "That could not be checked."
MathJson = JsonValue
Seed = Annotated[int, Field(ge=0, le=2**31 - 1)]


class TemplateOut(BaseModel):
    id: str
    node: str
    family: str
    command_word: str
    marks: int
    calculator: bool
    misconceptions: list[str]


class ItemRequest(BaseModel):
    template_id: str = Field(max_length=64)
    seed: Seed


class MathValue(BaseModel):
    mathjson: MathJson
    latex: str


class DistractorOut(BaseModel):
    value: MathValue
    misconception: str


class ItemOut(BaseModel):
    template_id: str
    family: str
    node: str
    seed: int
    params: dict[str, JsonValue]
    stem_markdown: str
    answer: MathValue
    answer_format: AnswerFormat
    command_word: str
    marks: int
    calculator: bool
    distractors: list[DistractorOut]
    diagram: dict[str, JsonValue] | None


class AnswerRequest(ItemRequest):
    response: MathJson


class FormatIssueOut(BaseModel):
    code: str
    message: str


class AnswerOut(BaseModel):
    correct: bool
    equivalent: bool
    format_issues: list[FormatIssueOut]
    misconceptions: list[str]
    unreadable: str | None


class StepsRequest(BaseModel):
    steps: list[MathJson] = Field(min_length=1, max_length=30)


class StepsOut(BaseModel):
    valid: bool
    first_invalid: int | None
    unreadable: str | None


class Claim(BaseModel):
    role: Literal["given", "claim", "step"]
    expr: MathJson


class ClaimsRequest(BaseModel):
    claims: list[Claim] = Field(max_length=40)
    # The item the student is working on, so the answer-leak check knows what to look for and
    # givens can be checked against its answer. services/api must always send it for tutor
    # messages: without it nothing can leak, and statements with letters stay unverified.
    item: ItemRequest | None = None


class ClaimOut(BaseModel):
    index: int
    role: Literal["given", "claim", "step"]
    verified: bool
    leaks_answer: bool
    problem: str | None


class ClaimsOut(BaseModel):
    all_verified: bool
    leaks_answer: bool
    claims: list[ClaimOut]


def _value(value: Any, fmt: AnswerFormat | None = None) -> MathValue:
    written = answer_mathjson(value, fmt) if fmt else to_mathjson(value)
    return MathValue(mathjson=written, latex=to_latex(value))


def _item(request: ItemRequest) -> Item:
    template = TEMPLATES.get(request.template_id)
    if template is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No template has this id.")
    try:
        return template.generate(request.seed)
    except TemplateError as error:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR, detail="The template could not make an item."
        ) from error


@router.get("/templates", operation_id="listTemplates")
def list_templates() -> list[TemplateOut]:
    return [
        TemplateOut(
            id=t.id,
            node=t.node,
            family=t.family,
            command_word=t.command_word,
            marks=t.marks,
            calculator=t.calculator,
            misconceptions=sorted([*t.misconceptions, *t.structures]),
        )
        for t in TEMPLATES.values()
    ]


@router.post("/items", operation_id="generateItem")
def generate_item(request: ItemRequest) -> ItemOut:
    item = _item(request)
    return ItemOut(
        template_id=item.template_id,
        family=item.family,
        node=item.node,
        seed=item.seed,
        params=item.params,
        stem_markdown=item.stem,
        answer=_value(item.answer, item.answer_format),
        answer_format=item.answer_format,
        command_word=item.command_word,
        marks=item.marks,
        calculator=item.calculator,
        distractors=[
            DistractorOut(value=_value(d.value, item.answer_format), misconception=d.misconception)
            for d in item.distractors
        ],
        diagram=dict(item.diagram) if item.diagram else None,
    )


@router.post("/answers/check", operation_id="checkAnswer")
def check(request: AnswerRequest) -> AnswerOut:
    item = _item(request)
    try:
        result = check_answer(item, request.response)
    except Exception:
        result = AnswerCheck(correct=False, equivalent=False, unreadable=COULD_NOT_CHECK)
    return AnswerOut(
        correct=result.correct,
        equivalent=result.equivalent,
        format_issues=[
            FormatIssueOut(code=i.code, message=i.message) for i in result.format_issues
        ],
        misconceptions=result.misconceptions,
        unreadable=result.unreadable,
    )


@router.post("/steps/check", operation_id="checkSteps")
def steps(request: StepsRequest) -> StepsOut:
    try:
        result = check_steps(request.steps)
    except Exception:
        result = StepCheck(valid=False, first_invalid=0, unreadable=COULD_NOT_CHECK)
    return StepsOut(
        valid=result.valid, first_invalid=result.first_invalid, unreadable=result.unreadable
    )


@router.post("/claims/verify", operation_id="verifyClaims")
def claims(request: ClaimsRequest) -> ClaimsOut:
    item = _item(request.item) if request.item else None
    try:
        results = verify_claims([(c.role, c.expr) for c in request.claims], item)
    except Exception:
        results = [
            ClaimResult(i, c.role, verified=False, leaks_answer=True, problem=COULD_NOT_CHECK)
            for i, c in enumerate(request.claims)
        ]
    return ClaimsOut(
        all_verified=all(r.verified for r in results),
        leaks_answer=any(r.leaks_answer for r in results),
        claims=[
            ClaimOut(
                index=r.index,
                role=r.role,
                verified=r.verified,
                leaks_answer=r.leaks_answer,
                problem=r.problem,
            )
            for r in results
        ],
    )


class SceneVerifyRequest(BaseModel):
    """A scene spec as served, with the facts it must agree with (ADR-0030).

    services/api supplies the answer from its verified item bank, and the claims, predicted wrong
    answer and canvas labels from the scene engine; only the narration came from a model.
    """

    spec: dict[str, JsonValue]
    answer: MathJson
    predicted: MathJson
    claims: list[MathJson] = Field(max_length=100)
    labels: list[Annotated[str, Field(max_length=500)]] = Field(max_length=300)


class SceneVerifyOut(BaseModel):
    verified: bool
    problems: list[str]


@router.post("/scenes/verify", operation_id="verifyScene")
def scene(request: SceneVerifyRequest) -> SceneVerifyOut:
    """Every claim true, both answers right, and every number in the narration and labels traced.

    The same check as the scene golden set (`scene_golden.check_record`), run on one spec.
    Anything malformed fails closed.
    """
    record = {
        "spec": request.spec,
        "answer": request.answer,
        "predicted": request.predicted,
        "claims": request.claims,
        "labels": request.labels,
    }
    try:
        problems = check_record(record)
    except Exception:
        problems = [COULD_NOT_CHECK]
    return SceneVerifyOut(verified=not problems, problems=problems)


class EquivalentRequest(BaseModel):
    left: MathJson
    right: MathJson


class EquivalentOut(BaseModel):
    equivalent: bool


@router.post("/answers/equivalent", operation_id="answersEquivalent")
def answers_equivalent(request: EquivalentRequest) -> EquivalentOut:
    """Whether two MathJSON values are equal (symbolically and by sampling).

    services/api uses it to confirm a student's answer is the one their misconception predicts
    before a scene narrates it (ADR-0030). Anything that will not convert is not equivalent.
    """
    try:
        same = equivalent(to_sympy(request.left), to_sympy(request.right))
    except Exception:
        same = False
    return EquivalentOut(equivalent=bool(same))
