"""Checking a student's answer and working, and verifying the maths in tutor messages and scenes.

Everything here starts from MathJSON and goes through `mathjson.to_sympy`; nothing is parsed
from text. The results never contain the item's answer, so they are safe to pass on.
"""

import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Literal

import sympy

from eddy_maths_core.equivalence import equivalent
from eddy_maths_core.formats import FormatIssue, check_format
from eddy_maths_core.items import TEMPLATES, Item
from eddy_maths_core.items.text import round_half_up
from eddy_maths_core.mathjson import (
    RELATIONS,
    MathJsonError,
    degree,
    read_response,
    split_unit,
    to_sympy,
)
from eddy_maths_core.rules import RULES, dec

# Rounding is only compared up to this many decimal places.
MAX_PLACES = 12

# A structure rule looks at how the answer is written, not only at its value (ADR-0022).
StructureRule = Callable[[Item, Any, sympy.Basic], bool]
STRUCTURES: dict[str, StructureRule] = {}


def structure(name: str) -> Callable[[StructureRule], StructureRule]:
    def register(function: StructureRule) -> StructureRule:
        STRUCTURES[name] = function
        return function

    return register


@structure("sf_not_normalised")
def _not_normalised(item: Item, written: Any, value: sympy.Basic) -> bool:
    """The right value as a x 10^n, but with a outside 1 to 10 (45 x 10^3)."""
    body, _ = split_unit(written)
    if not (
        isinstance(body, list) and len(body) == 3 and body[0] in ("Multiply", "InvisibleOperator")
    ):
        return False
    power = body[2]
    if not (isinstance(power, list) and power[:2] == ["Power", 10]):
        return False
    try:
        mantissa = abs(to_sympy(body[1]))
    except MathJsonError:
        return False
    return equivalent(value, item.answer) and not (1 <= mantissa < 10)


@structure("probability_over_one")
def _over_one(item: Item, written: Any, value: sympy.Basic) -> bool:
    return (
        isinstance(value, sympy.Expr)
        and value.is_number
        and value.is_real is True
        and bool(value > 1)
    )


@dataclass(frozen=True)
class AnswerCheck:
    correct: bool
    # The value is right, whatever the form.
    equivalent: bool
    format_issues: list[FormatIssue] = field(default_factory=list)
    misconceptions: list[str] = field(default_factory=list)
    # Why the response could not be read, if it could not.
    unreadable: str | None = None


def _written_places(written: Any) -> int | None:
    body, _ = split_unit(written)
    if isinstance(body, float):
        text = repr(body)
    elif isinstance(body, dict) and isinstance(body.get("num"), str):
        text = body["num"]
    else:
        return None
    if "(" in text:
        return None  # a recurring decimal is exact, not rounded
    try:
        exponent = Decimal(text).as_tuple().exponent
    except ArithmeticError:
        return None
    if not isinstance(exponent, int) or exponent >= 0 or exponent < -MAX_PLACES:
        return None
    return -exponent


def _solution_value(value: sympy.Basic, answer: sympy.Basic) -> sympy.Basic:
    """Accept "x = 4" for a numeric answer, and "4 = x"."""
    if isinstance(value, sympy.Eq) and not isinstance(answer, sympy.Eq):
        for unknown, other in ((value.lhs, value.rhs), (value.rhs, value.lhs)):
            if isinstance(unknown, sympy.Symbol) and not other.free_symbols:
                return other
    return value


def _rule_matches(
    rule_value: sympy.Basic, value: sympy.Basic, places: int | None, ratio: bool
) -> bool:
    if equivalent(rule_value, value, ratio=ratio):
        return True
    # A rule that gives an unending decimal matches the student's rounding of it.
    if places is not None and isinstance(rule_value, sympy.Expr) and rule_value.is_number:
        return bool(round_half_up(rule_value, places) == value)
    return False


def matched_misconceptions(item: Item, written: Any, value: sympy.Basic) -> list[str]:
    """Codes whose rule produces this response, for this item's template only."""
    template = TEMPLATES[item.template_id]
    places = _written_places(written)
    ratio = template.ratio
    matched = [
        code
        for code, rule_name in template.misconceptions.items()
        if (rule_value := RULES[rule_name](item.params)) is not None
        and _rule_matches(rule_value, value, places, ratio)
    ]
    for code, rule_name in template.structures.items():
        # A range check such as probability_over_one only speaks when no specific rule does.
        if rule_name == "probability_over_one" and matched:
            continue
        if STRUCTURES[rule_name](item, written, value):
            matched.append(code)
    return matched


def check_answer(item: Item, written: Any) -> AnswerCheck:
    try:
        response = read_response(written)
    except MathJsonError as error:
        return AnswerCheck(correct=False, equivalent=False, unreadable=str(error))
    value = _solution_value(response.value, item.answer)
    template = TEMPLATES[item.template_id]
    if equivalent(value, item.answer, ratio=template.ratio):
        issues = check_format(written, value, response.unit, item.answer_format)
        codes = [
            code
            for code, rule_name in template.structures.items()
            if rule_name != "probability_over_one" and STRUCTURES[rule_name](item, written, value)
        ]
        return AnswerCheck(
            correct=not issues, equivalent=True, format_issues=issues, misconceptions=codes
        )
    return AnswerCheck(
        correct=False, equivalent=False, misconceptions=matched_misconceptions(item, written, value)
    )


@dataclass(frozen=True)
class StepCheck:
    valid: bool
    # Index of the first step that does not follow from the one before it.
    first_invalid: int | None = None
    unreadable: str | None = None


def _follows(before: sympy.Basic, after: sympy.Basic) -> bool:
    if isinstance(before, sympy.Eq) != isinstance(after, sympy.Eq):
        return False
    return equivalent(before, after)


def check_steps(steps: Sequence[Any]) -> StepCheck:
    """Each step must be equivalent to the one before (same solution set for equations)."""
    converted: list[sympy.Basic] = []
    for index, step in enumerate(steps):
        try:
            converted.append(to_sympy(step))
        except MathJsonError as error:
            return StepCheck(valid=False, first_invalid=index, unreadable=str(error))
    for index in range(1, len(converted)):
        if not _follows(converted[index - 1], converted[index]):
            return StepCheck(valid=False, first_invalid=index)
    return StepCheck(valid=True)


ClaimRole = Literal["given", "claim", "step"]


@dataclass(frozen=True)
class ClaimResult:
    index: int
    role: ClaimRole
    verified: bool
    leaks_answer: bool
    problem: str | None = None


def _holds(relation: sympy.Basic) -> bool | None:
    """Whether a relation is true. None when it is not a relation or cannot be decided.

    An equation holds when its sides are equivalent (an identity, for letters). An inequality
    is only decided between numbers, by evaluating it; never by simplifying letters.
    """
    if isinstance(relation, sympy.Eq):
        return equivalent(relation.lhs, relation.rhs)
    if isinstance(relation, sympy.core.relational.Relational):
        if relation.free_symbols:
            return None
        difference = (relation.lhs - relation.rhs).evalf(30)
        if not difference.is_number or difference.is_real is not True:
            return None
        truth = relation.func(difference, 0)
        return bool(truth) if truth in (sympy.true, sympy.false) else None
    return None


def _anchored(relation: sympy.Basic, item: Item | None) -> bool | None:
    """Whether a statement about the question's unknown is true at the question's answer.

    "2x = 2x + 1" or a first step "3x = 7" cannot be true when the answer is 4. None when there
    is no item, or the answer is not a single number for a single unknown, so the statement
    cannot be checked against the question.
    """
    if item is None or not isinstance(relation, sympy.core.relational.Relational):
        return None
    unknowns = relation.free_symbols
    if len(unknowns) != 1 or not (isinstance(item.answer, sympy.Expr) and item.answer.is_number):
        return None
    (unknown,) = unknowns
    lhs = relation.lhs.subs(unknown, item.answer)
    rhs = relation.rhs.subs(unknown, item.answer)
    if lhs.is_extended_real is False or rhs.is_extended_real is False:
        return False  # "0 < sqrt(-x)" at x = 4: not a real number, so it cannot hold
    substituted = relation.func(lhs, rhs)
    if substituted in (sympy.true, sympy.false):
        return bool(substituted)  # SymPy settles some relations as soon as they are numbers
    return _holds(substituted)


def rational(text: str) -> sympy.Rational:
    return dec(text) if "." in text else sympy.Integer(int(text))


FRACTION_IN_STEM = re.compile(r"\\frac\{(\d+)\}\{(\d+)\}")
NUMBER_IN_STEM = re.compile(r"-?\d+(?:\.\d+)?")


def stem_values(item: Item) -> list[sympy.Rational]:
    """The numbers the question itself states, fractions included."""
    text = item.stem.replace(r"\,", "")
    fractions = [sympy.Rational(int(n), int(d)) for n, d in FRACTION_IN_STEM.findall(text)]
    return fractions + [rational(match) for match in NUMBER_IN_STEM.findall(text)]


def _sides(written: Any, value: sympy.Basic) -> list[tuple[Any, sympy.Basic]]:
    """A statement and the parts of it that could state the answer on their own."""
    parts: list[tuple[Any, sympy.Basic]] = [(written, value)]
    if (
        isinstance(value, sympy.core.relational.Relational)
        and isinstance(written, list)
        and len(written) == 3
        and written[0] in RELATIONS
    ):
        parts += [(written[1], value.lhs), (written[2], value.rhs)]
    if isinstance(value, sympy.Tuple):
        written_items = written[1:] if isinstance(written, list) else []
        for index, element in enumerate(value):
            form = written_items[index] if index < len(written_items) else element
            parts.append((form, element))
    if isinstance(value, sympy.Eq) and len(value.free_symbols) == 1:
        # "x - 10 = 0" pins x just as surely as "x = 10" does.
        (unknown,) = value.free_symbols
        expr = value.lhs - value.rhs
        if degree(expr) == 1 and expr.is_polynomial(unknown):
            solution = sympy.solve(expr, unknown)
            if len(solution) == 1:
                parts.append((solution[0], solution[0]))
    return parts


def _matches_answer(candidate: sympy.Basic, item: Item, ratio: bool) -> bool:
    if equivalent(candidate, item.answer, ratio=ratio):
        return True
    places = item.answer_format.dp
    if (
        places is not None
        and isinstance(candidate, sympy.Expr)
        and candidate.is_number
        and candidate.is_real is True
    ):
        # 49 pi or 153.93804 still give away an answer of 153.9.
        return bool(round_half_up(candidate, places) == item.answer)
    if isinstance(item.answer, sympy.Tuple) and isinstance(candidate, sympy.Expr):
        given = stem_values(item)
        return any(candidate == part and not any(part == g for g in given) for part in item.answer)
    return False


def _leaks(written: Any, value: sympy.Basic, item: Item, ratio: bool) -> bool:
    """Whether a statement gives the answer away.

    A value equal to the answer is a leak unless the question itself states that value and the
    statement writes it in a different form from the one asked for: on "write 1/4 as a
    decimal", repeating 1/4 is fine but 0.25 is not. On a choice (which of -7 and -3 is
    smaller?) any mention of the answer counts, in any form, so the tutor falls back to a
    templated hint rather than risk naming it.
    """
    template = TEMPLATES[item.template_id]
    stated = any(item.answer == g for g in stem_values(item))
    for form, candidate in _sides(written, value):
        if isinstance(candidate, sympy.Expr) and candidate.is_Symbol:
            continue  # a bare letter such as x is never the answer
        if not _matches_answer(candidate, item, ratio):
            continue
        if template.choice or not stated:
            return True
        try:
            unit = read_response(form).unit
        except MathJsonError:
            unit = None
        if not check_format(form, candidate, unit, item.answer_format):
            return True
    return False


def _check_claim(
    role: ClaimRole, value: sympy.Basic, item: Item | None, previous_step: sympy.Basic | None
) -> tuple[bool, str | None]:
    """(verified, problem) for one statement.

    - Any statement about numbers alone must be true, whatever its role ("given 2 + 2 = 5").
    - A claim must be true; with letters, true for every value (an identity) or true at the
      question's answer.
    - A given, and the first step, must be true at the question's answer when that can be
      checked, and are otherwise unverified: they cannot be checked on their own.
    - Every later step must follow from the step before it.
    """
    relation = isinstance(value, sympy.core.relational.Relational)
    if relation and not value.free_symbols:
        holds = _holds(value)
        return (holds is True, None if holds else "false")
    if role == "claim":
        holds = _holds(value) or _anchored(value, item)
        if holds is True:
            return True, None
        return False, ("false" if holds is False else "not a checkable statement")
    if role == "step" and previous_step is not None:
        if _follows(previous_step, value):
            return True, None
        return False, "does not follow from the previous step"
    if not relation:
        return True, None  # a plain expression, such as a value shown in a scene
    anchored = _anchored(value, item)
    if anchored is True:
        return True, None
    return False, ("false at the answer" if anchored is False else "cannot be checked alone")


def verify_claims(
    claims: Sequence[tuple[ClaimRole, Any]], item: Item | None = None
) -> list[ClaimResult]:
    """Check every maths claim in a tutor message or scene, and whether any leaks the answer."""
    results: list[ClaimResult] = []
    previous_step: sympy.Basic | None = None
    ratio = TEMPLATES[item.template_id].ratio if item else False
    for index, (role, expr) in enumerate(claims):
        try:
            value = to_sympy(expr)
        except MathJsonError as error:
            results.append(
                ClaimResult(index, role, verified=False, leaks_answer=False, problem=str(error))
            )
            continue
        leaks = item is not None and _leaks(expr, value, item, ratio)
        verified, problem = _check_claim(role, value, item, previous_step)
        if role == "step":
            previous_step = value
        results.append(
            ClaimResult(index, role, verified=verified, leaks_answer=leaks, problem=problem)
        )
    return results
