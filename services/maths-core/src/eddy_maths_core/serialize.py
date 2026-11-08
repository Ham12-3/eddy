"""SymPy back to MathJSON and LaTeX, for answers, distractors and steps sent to other services.

Only the shapes maths-core itself produces are supported. The output round-trips through
`mathjson.to_sympy` to an equal value, which a property test checks.
"""

from decimal import ROUND_HALF_UP, Decimal, localcontext
from typing import Any

import sympy

from eddy_maths_core.formats import AnswerFormat
from eddy_maths_core.items.text import DECIMAL_PRECISION


def to_mathjson(value: sympy.Basic) -> Any:
    if isinstance(value, sympy.Tuple):
        return ["Tuple", *(to_mathjson(item) for item in value)]
    if isinstance(value, sympy.Eq):
        return ["Equal", to_mathjson(value.lhs), to_mathjson(value.rhs)]
    if isinstance(value, sympy.Integer):
        return int(value)
    if isinstance(value, sympy.Rational):
        if value < 0:
            return ["Negate", to_mathjson(-value)]
        return ["Rational", int(value.p), int(value.q)]
    if value is sympy.pi:
        return "Pi"
    if isinstance(value, sympy.Symbol):
        return value.name
    if isinstance(value, sympy.Add):
        return ["Add", *(to_mathjson(term) for term in value.as_ordered_terms())]
    if isinstance(value, sympy.Mul):
        coefficient, rest = value.as_coeff_Mul()
        if coefficient == -1:
            return ["Negate", to_mathjson(rest)]
        return ["Multiply", *(to_mathjson(factor) for factor in value.as_ordered_factors())]
    if isinstance(value, sympy.Pow):
        base, exponent = value.as_base_exp()
        if exponent == sympy.Rational(1, 2):
            return ["Sqrt", to_mathjson(base)]
        return ["Power", to_mathjson(base), to_mathjson(exponent)]
    raise TypeError(f"cannot write {type(value).__name__} as MathJSON")


def to_latex(value: sympy.Basic) -> str:
    if isinstance(value, sympy.Tuple):
        return "(" + ", ".join(to_latex(item) for item in value) + ")"
    return str(sympy.latex(value))


def _decimal_text(value: sympy.Rational, places: int | None) -> str | None:
    """The value as a terminating decimal string, or None if it does not terminate."""
    exact = Decimal(int(value.p)) / Decimal(int(value.q))
    if places is not None:
        with localcontext(prec=DECIMAL_PRECISION):
            return f"{exact.quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP):f}"
    if exact != exact.quantize(Decimal(1).scaleb(-12)):
        return None
    return f"{exact.normalize():f}"


def answer_mathjson(value: sympy.Basic, fmt: AnswerFormat) -> Any:
    """The answer written the way the question asks: 0.7 as a decimal, 4.1 x 10^7, 2 1/2."""
    # Decimals for decimal questions, rounding questions and percentages (16.5%, not 33/2%).
    as_decimal = fmt.form == "decimal" or fmt.dp is not None or fmt.sf is not None
    if isinstance(value, sympy.Rational) and (as_decimal or fmt.unit == "%"):
        text = _decimal_text(value, fmt.dp)
        if text is not None:
            return {"num": text}
    if isinstance(value, sympy.Rational) and fmt.form == "standard_form" and value != 0:
        power = (Decimal(int(value.p)) / Decimal(int(value.q))).adjusted()
        mantissa = value / sympy.Integer(10) ** power
        text = _decimal_text(mantissa, None)
        if text is not None:
            return ["Multiply", {"num": text}, ["Power", 10, power]]
    if isinstance(value, sympy.Rational) and fmt.form == "mixed_number" and not value.is_integer:
        whole = int(value.p) // int(value.q)
        rest = value - whole
        return ["InvisibleOperator", whole, ["Rational", int(rest.p), int(rest.q)]]
    return to_mathjson(value)
