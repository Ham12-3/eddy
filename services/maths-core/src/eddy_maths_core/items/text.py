"""Small helpers for writing stems: numbers as KaTeX, money in pounds and pence."""

from decimal import ROUND_HALF_UP, Decimal, localcontext

import sympy

# Enough for any value maths-core accepts (at most 400 digits) rounded to any place.
DECIMAL_PRECISION = 1000


def tex(value: sympy.Basic) -> str:
    """LaTeX for a value, with thin spaces in large whole numbers (3\\,200\\,000)."""
    if isinstance(value, sympy.Integer) and abs(value) >= 10_000:
        return f"{int(value):,}".replace(",", "\\,")
    if isinstance(value, sympy.Rational) and not value.is_integer:
        exact = Decimal(int(value.p)) / Decimal(int(value.q))
        if exact == exact.quantize(Decimal(1).scaleb(-8)):
            return f"{exact.normalize():f}"
    return str(sympy.latex(value))


def money(amount: str | sympy.Basic) -> str:
    """£4.50 style, always with two decimal places."""
    value = Decimal(str(amount)) if isinstance(amount, str) else Decimal(str(sympy.N(amount, 20)))
    return f"£{value.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)}"


def round_sf_rational(value: sympy.Expr, figures: int) -> sympy.Rational:
    """Round to significant figures, half up, exactly."""
    exact = Decimal(str(sympy.N(value, 40)))
    shift = figures - exact.adjusted() - 1
    with localcontext(prec=DECIMAL_PRECISION):
        rounded = exact.quantize(Decimal(1).scaleb(-shift), rounding=ROUND_HALF_UP)
    numerator, denominator = rounded.as_integer_ratio()
    return sympy.Rational(numerator, denominator)


def round_half_up(value: sympy.Expr, places: int) -> sympy.Rational:
    """Round as GCSE does (half up), exactly."""
    exact = Decimal(str(sympy.N(value, 40)))
    with localcontext(prec=DECIMAL_PRECISION):
        rounded = exact.quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)
    numerator, denominator = rounded.as_integer_ratio()
    return sympy.Rational(numerator, denominator)
