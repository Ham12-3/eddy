"""Answer-format rules, checked after equivalence (SPEC.md section 7.3).

A response can be the right value in the wrong form: 0.5 when the question asks for a fraction,
4/8 when it asks for simplest form, 3.1 when it asks for 2 decimal places, or a length without
its unit. These rules read the MathJSON the student wrote, because SymPy has already simplified
the value away.
"""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal, localcontext
from math import gcd
from typing import Any, Literal

import sympy
from pydantic import BaseModel, Field

from eddy_maths_core.mathjson import split_unit

Form = Literal["any", "integer", "fraction", "decimal", "mixed_number", "standard_form", "exact"]


class AnswerFormat(BaseModel):
    """How an item wants its answer written. Stored on each item as `answer_format`."""

    kind: Literal["number", "expression", "equation", "coordinate", "ratio"] = "number"
    form: Form = "any"
    dp: int | None = Field(default=None, ge=0, le=6)
    sf: int | None = Field(default=None, ge=1, le=8)
    simplest: bool = False
    # The unit the answer is in (cm, cm^2, %, °), shown beside the answer box.
    unit: str | None = None
    # When the question itself asks for units, leaving them off is a format issue.
    require_unit: bool = False


@dataclass(frozen=True)
class FormatIssue:
    code: str
    message: str  # safe to show; never reveals the answer


def round_sf(value: sympy.Expr, figures: int) -> Decimal:
    exact = Decimal(str(sympy.N(value, 40)))
    if exact == 0:
        return Decimal(0)
    shift = figures - exact.adjusted() - 1
    with localcontext(prec=1000):
        return exact.quantize(Decimal(1).scaleb(-shift), rounding=ROUND_HALF_UP)


def _written_decimal(node: Any) -> Decimal | None:
    """The number exactly as written, if the student wrote a plain decimal or integer."""
    if isinstance(node, bool):
        return None
    if isinstance(node, int):
        return Decimal(node)
    if isinstance(node, float):
        return Decimal(repr(node))
    if isinstance(node, dict) and isinstance(node.get("num"), str) and "(" not in node["num"]:
        try:
            return Decimal(node["num"])
        except ArithmeticError:
            return None
    if isinstance(node, list) and len(node) == 2 and node[0] == "Negate":
        inner = _written_decimal(node[1])
        return -inner if inner is not None else None
    return None


def _fraction_parts(node: Any) -> tuple[int, int] | None:
    if (
        isinstance(node, list)
        and len(node) == 3
        and node[0] in ("Divide", "Rational")
        and all(isinstance(x, int) and not isinstance(x, bool) for x in node[1:])
    ):
        return node[1], node[2]
    if isinstance(node, list) and len(node) == 2 and node[0] == "Negate":
        parts = _fraction_parts(node[1])
        return (-parts[0], parts[1]) if parts else None
    return None


def _mixed_parts(node: Any) -> tuple[int, int, int] | None:
    """(whole, numerator, denominator) for a whole number then a proper fraction: 2 1/2."""
    if not (isinstance(node, list) and len(node) == 3 and node[0] in ("InvisibleOperator", "Add")):
        return None
    whole, fraction = node[1], node[2]
    parts = _fraction_parts(fraction)
    if isinstance(whole, bool) or not isinstance(whole, int) or whole < 1 or parts is None:
        return None
    numerator, denominator = parts
    if not 0 < numerator < denominator:
        return None  # 4 4/3 is not a mixed number
    return whole, numerator, denominator


def _has_written_decimal(node: Any) -> bool:
    """True if the student typed a decimal anywhere: an exact answer has none."""
    if isinstance(node, float):
        return True
    if isinstance(node, dict):
        return "." in str(node.get("num", ""))
    if isinstance(node, list):
        return any(_has_written_decimal(child) for child in node)
    return False


def _is_standard_form(node: Any) -> bool:
    """a x 10^n with 1 <= |a| < 10, or a power of ten alone."""
    if isinstance(node, list) and node[:1] == ["Power"] and node[1:2] == [10]:
        return True
    if not (
        isinstance(node, list) and len(node) == 3 and node[0] in ("Multiply", "InvisibleOperator")
    ):
        return False
    mantissa, power = node[1], node[2]
    written = _written_decimal(mantissa)
    return (
        written is not None
        and 1 <= abs(written) < 10
        and isinstance(power, list)
        and len(power) == 3
        and power[0] == "Power"
        and power[1] == 10
    )


def _ratio_in_lowest_terms(node: Any) -> bool:
    if not isinstance(node, list) or node[0] not in ("Ratio", "Tuple", "List", "Sequence"):
        return True
    parts = node[1:]
    if not all(isinstance(p, int) and not isinstance(p, bool) for p in parts):
        return False
    divisor = 0
    for part in parts:
        divisor = gcd(divisor, part)
    return divisor == 1


def check_format(
    written: Any, value: sympy.Basic, unit: str | None, fmt: AnswerFormat
) -> list[FormatIssue]:
    """Problems with how the response is written. Assumes the value is already correct."""
    issues: list[FormatIssue] = []
    body, _ = split_unit(written)

    # The answer box shows the expected unit, so leaving it off is fine unless the question
    # asks for units; writing a different unit is not.
    if unit is not None and unit != fmt.unit:
        # A different unit, or a unit (such as %) on an answer that has none.
        issues.append(FormatIssue("unit_wrong", "Check the units in your answer."))
    elif fmt.require_unit and unit is None:
        issues.append(FormatIssue("unit_missing", "Include the units in your answer."))

    if fmt.dp is not None:
        as_written = _written_decimal(body)
        if as_written is None or -as_written.as_tuple().exponent != fmt.dp:  # type: ignore[operator]
            places = "place" if fmt.dp == 1 else "places"
            issues.append(FormatIssue("dp", f"Give your answer to {fmt.dp} decimal {places}."))
    if fmt.sf is not None:
        as_written = _written_decimal(body)
        if as_written is None or len(as_written.normalize().as_tuple().digits) > fmt.sf:
            issues.append(FormatIssue("sf", f"Give your answer to {fmt.sf} significant figures."))

    if fmt.form == "integer" and not (
        isinstance(value, sympy.Integer) and _written_decimal(body) is not None
    ):
        issues.append(FormatIssue("form_integer", "Give your answer as a whole number."))
    elif fmt.form == "fraction" and _fraction_parts(body) is None:
        issues.append(FormatIssue("form_fraction", "Give your answer as a fraction."))
    elif fmt.form == "decimal" and _written_decimal(body) is None:
        issues.append(FormatIssue("form_decimal", "Give your answer as a decimal."))
    elif fmt.form == "standard_form" and not _is_standard_form(body):
        issues.append(FormatIssue("form_standard", "Give your answer in standard form."))
    elif fmt.form == "mixed_number" and _mixed_parts(body) is None:
        issues.append(FormatIssue("form_mixed", "Give your answer as a mixed number."))
    elif fmt.form == "exact" and _has_written_decimal(body):
        issues.append(FormatIssue("form_exact", "Give an exact answer, not a rounded decimal."))

    if fmt.simplest:
        parts = _fraction_parts(body)
        mixed = _mixed_parts(body) if fmt.form == "mixed_number" else None
        if mixed is not None:
            parts = mixed[1:]
        if parts is not None and gcd(*parts) != 1:
            issues.append(FormatIssue("simplest", "Write your answer in its simplest form."))
        if fmt.kind == "ratio" and not _ratio_in_lowest_terms(body):
            issues.append(FormatIssue("simplest", "Write your ratio in its simplest form."))
    return issues
