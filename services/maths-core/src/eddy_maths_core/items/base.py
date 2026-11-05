"""Item templates: parameters in, a verified question out (SPEC.md sections 6.1 and 7.3).

A template draws parameters from a seeded random generator, rejecting any draw that gives
awkward numbers or colliding distractors, then builds the item: the stem, the exact answer, the
answer format, and one distractor per misconception rule it supports. Every distractor is the
named rule applied to the same parameters (ADR-0022), so the wrong answer a student gives can be
traced back to the misconception that produces it.
"""

import random
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any, Literal

import sympy

from eddy_maths_core.equivalence import equivalent
from eddy_maths_core.formats import AnswerFormat
from eddy_maths_core.rules import RULES, Params

CommandWord = Literal[
    "CALCULATE",
    "WORK_OUT",
    "SHOW_THAT",
    "EXPLAIN",
    "ESTIMATE",
    "SIMPLIFY",
    "EXPAND",
    "FACTORISE",
    "SOLVE",
    "WRITE",
    "COMPLETE",
]
MAX_DRAWS = 200


class TemplateError(RuntimeError):
    """A template could not produce a valid item. Always a bug in the template."""


@dataclass(frozen=True)
class Distractor:
    value: sympy.Basic
    misconception: str
    rule: str


@dataclass(frozen=True)
class Item:
    template_id: str
    family: str
    node: str
    seed: int
    params: Params
    stem: str  # Markdown; maths in $...$ for KaTeX
    answer: sympy.Basic
    answer_format: AnswerFormat
    command_word: CommandWord
    marks: int
    calculator: bool
    distractors: tuple[Distractor, ...]
    # Structured data for a diagram the UI draws (M5 scene primitives), if the item needs one.
    diagram: Mapping[str, Any] | None = None


@dataclass(frozen=True)
class Template:
    """One kind of question. `misconceptions` maps each misconception code to its rule name."""

    id: str
    node: str
    family: str
    command_word: CommandWord
    marks: int
    calculator: bool
    draw: Callable[[random.Random], Params]
    stem: Callable[[Params], str]
    answer: Callable[[Params], sympy.Basic]
    answer_format: AnswerFormat = field(default_factory=AnswerFormat)
    misconceptions: Mapping[str, str] = field(default_factory=dict)
    # Misconceptions recognised from how the answer is written (structure rules, ADR-0022).
    structures: Mapping[str, str] = field(default_factory=dict)
    # A choice between values the question lists (which is smaller?): any mention of the
    # answer by the tutor counts as giving it away.
    choice: bool = False
    # Draws that leave fewer distractors than this are rejected (capped at len(misconceptions)).
    min_distractors: int = 1
    # Extra conditions a draw must meet beyond clean distractors.
    valid: Callable[[Params], bool] = lambda _: True
    diagram: Callable[[Params], Mapping[str, Any]] | None = None

    @property
    def ratio(self) -> bool:
        return self.answer_format.kind == "ratio"

    def distractors(self, params: Params) -> tuple[Distractor, ...] | None:
        """One wrong answer per rule that can show itself with these parameters.

        A rule that gives nothing, or gives the right answer, cannot be diagnosed here and is
        left out. Two rules giving the same wrong answer would make it ambiguous, so the draw is
        rejected (None), as it is when fewer than `min_distractors` remain.
        """
        answer = self.answer(params)
        found: list[Distractor] = []
        for code, rule_name in self.misconceptions.items():
            value = RULES[rule_name](params)
            if value is None or equivalent(value, answer, ratio=self.ratio):
                continue
            if any(equivalent(value, d.value, ratio=self.ratio) for d in found):
                return None
            found.append(Distractor(value=value, misconception=code, rule=rule_name))
        if len(found) < min(self.min_distractors, len(self.misconceptions)):
            return None
        return tuple(found)

    def generate(self, seed: int) -> Item:
        rng = random.Random(f"{self.id}:{seed}")  # noqa: S311 (reproducible items, not security)
        for _ in range(MAX_DRAWS):
            params = self.draw(rng)
            if not self.valid(params):
                continue
            distractors = self.distractors(params)
            if distractors is None:
                continue
            return Item(
                template_id=self.id,
                family=self.family,
                node=self.node,
                seed=seed,
                params=params,
                stem=self.stem(params),
                answer=self.answer(params),
                answer_format=self.answer_format,
                command_word=self.command_word,
                marks=self.marks,
                calculator=self.calculator,
                distractors=distractors,
                diagram=self.diagram(params) if self.diagram else None,
            )
        raise TemplateError(f"{self.id} found no valid parameters in {MAX_DRAWS} draws")
