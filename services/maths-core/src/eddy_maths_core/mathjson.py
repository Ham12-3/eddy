"""MathJSON in, SymPy out, by walking the tree (SPEC.md section 7.3, ADR-0004).

Student and model input arrives as MathJSON from MathLive. It is checked against an allow-list
with size and depth limits, then converted node by node. Nothing is ever evaluated or parsed as
code: no `eval`, no `sympify` on a string, no `parse_expr`. Numbers given as strings are read by
a strict regular expression into exact rationals.

Every rejection raises MathJsonError with a reason that is safe to show to the student.
"""

import math
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from fractions import Fraction
from typing import Any

import sympy

MAX_NODES = 400
MAX_DEPTH = 24
MAX_DIGITS = 40
MAX_EXPONENT = 64
MAX_ARGS = 32
# No intermediate number may need more digits than this, and no expression may have a
# degree above MAX_DEGREE: GCSE needs neither, and both keep SymPy's work bounded.
MAX_RESULT_DIGITS = 400
MAX_DEGREE = 12
# At most this many different letters, and this many roots and absolute values: simplify and
# solve stay quick, and GCSE answers need far fewer.
MAX_SYMBOLS = 3
MAX_RADICALS = 4
MAX_ROOT_INDEX = 10

# Letters a student may use as unknowns, and the few named symbols GCSE needs.
_LETTER = re.compile(r"[A-Za-z]")
GREEK = frozenset({"alpha", "beta", "theta"})
CONSTANTS: dict[str, sympy.Expr] = {
    "Pi": sympy.pi,
    "Half": sympy.Rational(1, 2),
}
# Units may only trail a value (5 cm, 12 m^2); see split_unit.
UNITS = frozenset({"mm", "cm", "m", "km", "g", "kg", "ml", "l", "s", "min", "h"})

# A decimal string, optionally with a repeating block: 0.(3) is one third, 1.2(36) is 1.2363636...
_NUMBER = re.compile(
    r"^([+-]?)([0-9]{1,40})(?:\.([0-9]{0,40})(?:\(([0-9]{1,20})\))?)?(?:[eE]([+-]?[0-9]{1,3}))?$"
)

RELATIONS = {
    "Equal": sympy.Eq,
    "NotEqual": sympy.Ne,
    "Less": sympy.Lt,
    "LessEqual": sympy.Le,
    "Greater": sympy.Gt,
    "GreaterEqual": sympy.Ge,
}


class MathJsonError(ValueError):
    """The input is not MathJSON that Eddy accepts. The message is safe to show."""


@dataclass(frozen=True)
class Converted:
    """A converted response: the value, and the unit written after it, if any."""

    value: sympy.Basic
    unit: str | None = None


def _number_from_string(text: str) -> sympy.Rational:
    match = _NUMBER.match(text.strip())
    if not match:
        raise MathJsonError("That number could not be read.")
    sign, whole, decimals, repeating, exponent = match.groups()
    value = Fraction(int(whole))
    if decimals:
        value += Fraction(int(decimals), 10 ** len(decimals))
    if repeating:
        # 0.d(r): the repeating block starts after the fixed decimals.
        places = len(decimals or "")
        value += Fraction(int(repeating), (10 ** len(repeating) - 1) * 10**places)
    if exponent:
        power = int(exponent)
        if abs(power) > MAX_EXPONENT:
            raise MathJsonError("That number is too large.")
        value *= Fraction(10) ** power
    if sign == "-":
        value = -value
    return sympy.Rational(value.numerator, value.denominator)


def _number(node: int | float) -> sympy.Rational:
    if isinstance(node, bool):
        raise MathJsonError("That is not a number.")
    if isinstance(node, int):
        if len(str(abs(node))) > MAX_DIGITS:
            raise MathJsonError("That number is too large.")
        return sympy.Integer(node)
    try:
        # repr gives the shortest decimal that round-trips, so 0.1 stays exactly 1/10.
        exact = Fraction(Decimal(repr(node)))
    except (InvalidOperation, ValueError, OverflowError) as error:
        raise MathJsonError("That number could not be read.") from error
    if len(str(abs(exact.numerator))) > MAX_DIGITS or len(str(exact.denominator)) > MAX_DIGITS:
        raise MathJsonError("That number is too large.")
    return sympy.Rational(exact.numerator, exact.denominator)


def check_limits(node: Any) -> None:
    """Reject anything too big or too deep before any conversion work is done."""
    count = 0
    stack: list[tuple[Any, int]] = [(node, 1)]
    while stack:
        current, depth = stack.pop()
        count += 1
        if count > MAX_NODES:
            raise MathJsonError("That expression is too long.")
        if depth > MAX_DEPTH:
            raise MathJsonError("That expression is nested too deeply.")
        if isinstance(current, list):
            if len(current) > MAX_ARGS + 1:
                raise MathJsonError("That expression has too many parts.")
            stack.extend((child, depth + 1) for child in current)
        elif isinstance(current, dict):
            stack.extend((child, depth + 1) for child in current.values())
        elif isinstance(current, str) and len(current) > 64:
            raise MathJsonError("That expression could not be read.")


def _args(node: list[Any], low: int, high: int | None = None) -> list[Any]:
    args = node[1:]
    if len(args) < low or (high is not None and len(args) > high):
        raise MathJsonError("That expression could not be read.")
    return args


def _expr(value: sympy.Basic) -> sympy.Expr:
    if not isinstance(value, sympy.Expr):
        raise MathJsonError("That expression could not be read.")
    return value


def _digits(value: sympy.Expr) -> float:
    """Roughly how many decimal digits a number needs: numerator, denominator or magnitude."""
    if isinstance(value, sympy.Rational):
        return float(max(len(str(abs(value.p))), len(str(value.q))))
    magnitude = abs(complex(sympy.N(value, 15)))
    return abs(math.log10(magnitude)) + 1 if magnitude else 1.0


def _power(base: sympy.Expr, exponent: sympy.Expr) -> sympy.Expr:
    # A power must be a number with a small numerator and denominator (2, -3, 1/2). A letter in
    # the power is not GCSE maths and would make every other bound meaningless.
    if not (exponent.is_Rational and exponent.q <= MAX_ROOT_INDEX):
        raise MathJsonError("Eddy can only check powers that are numbers.")
    if abs(exponent) > MAX_EXPONENT:
        raise MathJsonError("That power is too large.")
    if base.is_number and base.is_negative and not exponent.is_Integer:
        raise MathJsonError("That has no real value, such as the square root of a negative.")
    # Each level of a nested power is checked before it is worked out, so ((2^4)^4)^4... stops
    # long before the number gets expensive.
    if base.is_number and exponent.is_number and _digits(base) * abs(exponent) > MAX_RESULT_DIGITS:
        raise MathJsonError("That number is too large.")
    if (
        not base.is_number
        and exponent.is_Integer
        and degree(base) * abs(int(exponent)) > MAX_DEGREE
    ):
        raise MathJsonError("That power is too high for Eddy to check.")
    return sympy.Pow(base, exponent)


def degree(expr: sympy.Basic) -> int:
    """An upper bound on the polynomial degree of an expression, without expanding it."""
    if not isinstance(expr, sympy.Expr) or expr.is_number:
        return 0
    if isinstance(expr, sympy.Symbol):
        return 1
    if isinstance(expr, sympy.Add):
        return max(degree(arg) for arg in expr.args)
    if isinstance(expr, sympy.Mul):
        return sum(degree(arg) for arg in expr.args)
    if isinstance(expr, sympy.Pow):
        base, exponent = expr.as_base_exp()
        if exponent.is_Integer:
            return degree(base) * abs(int(exponent))
        return degree(base)
    return max((degree(arg) for arg in expr.args), default=1)


def _is_digit_literal(node: Any) -> bool:
    return isinstance(node, int) and not isinstance(node, bool) and node >= 0


def _mixed_number(args: Sequence[Any]) -> sympy.Expr | None:
    """2 1/2 as MathLive writes it without an operator: a whole number then a fraction."""
    if len(args) != 2 or not _is_digit_literal(args[0]):
        return None
    fraction = args[1]
    if (
        isinstance(fraction, list)
        and len(fraction) == 3
        and fraction[0] in ("Divide", "Rational")
        and _is_digit_literal(fraction[1])
        and _is_digit_literal(fraction[2])
        and fraction[2] != 0
    ):
        return _number(args[0]) + _number(fraction[1]) / _number(fraction[2])
    return None


def _convert(node: Any) -> sympy.Basic:
    if isinstance(node, (bool, type(None))):
        raise MathJsonError("That expression could not be read.")
    if isinstance(node, (int, float)):
        return _number(node)
    if isinstance(node, str):
        return _symbol(node)
    if isinstance(node, dict):
        if set(node) == {"num"} and isinstance(node["num"], str):
            return _number_from_string(node["num"])
        if set(node) == {"sym"} and isinstance(node["sym"], str):
            return _symbol(node["sym"])
        if set(node) == {"fn"} and isinstance(node["fn"], list):
            return _convert(node["fn"])
        raise MathJsonError("That expression could not be read.")
    if not isinstance(node, list) or not node or not isinstance(node[0], str):
        raise MathJsonError("That expression could not be read.")

    head = node[0]
    handler = _HEADS.get(head)
    if handler is None:
        if head == "Error":
            raise MathJsonError("That answer could not be read. Check it for a missing part.")
        raise MathJsonError("That expression uses something Eddy cannot check yet.")
    return handler(node)


def _symbol(name: str) -> sympy.Basic:
    if name in CONSTANTS:
        return CONSTANTS[name]
    if _LETTER.fullmatch(name) or name in GREEK:
        return sympy.Symbol(name)
    if name in UNITS:
        raise MathJsonError("Write units after the number.")
    raise MathJsonError("That expression uses a symbol Eddy does not know.")


def _add(node: list[Any]) -> sympy.Basic:
    return sympy.Add(*(_expr(_convert(a)) for a in _args(node, 1)))


def _multiply(node: list[Any]) -> sympy.Basic:
    return sympy.Mul(*(_expr(_convert(a)) for a in _args(node, 1)))


def _subtract(node: list[Any]) -> sympy.Basic:
    args = _args(node, 1, 2)
    if len(args) == 1:
        return -_expr(_convert(args[0]))
    return _expr(_convert(args[0])) - _expr(_convert(args[1]))


def _negate(node: list[Any]) -> sympy.Basic:
    (arg,) = _args(node, 1, 1)
    return -_expr(_convert(arg))


def _divide(node: list[Any]) -> sympy.Basic:
    top, bottom = (_expr(_convert(a)) for a in _args(node, 2, 2))
    if bottom.is_zero:
        raise MathJsonError("That divides by zero.")
    return top / bottom


def _power_node(node: list[Any]) -> sympy.Basic:
    base, exponent = (_expr(_convert(a)) for a in _args(node, 2, 2))
    return _power(base, exponent)


def _square(node: list[Any]) -> sympy.Basic:
    (arg,) = _args(node, 1, 1)
    return _power(_expr(_convert(arg)), sympy.Integer(2))


def _sqrt(node: list[Any]) -> sympy.Basic:
    (arg,) = _args(node, 1, 1)
    return sympy.sqrt(_expr(_convert(arg)))


def _root(node: list[Any]) -> sympy.Basic:
    arg, index = (_expr(_convert(a)) for a in _args(node, 2, 2))
    if not (index.is_Integer and 2 <= index <= 10):
        raise MathJsonError("Eddy can only check square, cube and small roots.")
    if index % 2 == 1:
        return sympy.real_root(arg, index)  # the cube root of -8 is -2, as at GCSE
    return sympy.root(arg, index)


def _abs(node: list[Any]) -> sympy.Basic:
    (arg,) = _args(node, 1, 1)
    return sympy.Abs(_expr(_convert(arg)))


def _percent(node: list[Any]) -> sympy.Basic:
    (arg,) = _args(node, 1, 1)
    return _expr(_convert(arg)) / 100


def _degrees(node: list[Any]) -> sympy.Basic:
    # GCSE angles stay in degrees: 30 degrees is the number 30.
    (arg,) = _args(node, 1, 1)
    return _expr(_convert(arg))


def _delimiter(node: list[Any]) -> sympy.Basic:
    args = _args(node, 0, 2)
    if not args:
        raise MathJsonError("That expression has empty brackets.")
    # The optional second argument names the brackets ("'()'"); it carries no value.
    if len(args) == 2 and not (isinstance(args[1], str) and args[1].startswith("'")):
        raise MathJsonError("That expression could not be read.")
    body = args[0]
    if isinstance(body, list) and body and body[0] == "Sequence":
        items = body[1:]
        if len(items) == 1:
            return _convert(items[0])
        return sympy.Tuple(*(_expr(_convert(item)) for item in items))
    return _convert(body)


def _sequence(node: list[Any]) -> sympy.Basic:
    items = _args(node, 1)
    if len(items) == 1:
        return _convert(items[0])
    return sympy.Tuple(*(_expr(_convert(item)) for item in items))


def _tuple(node: list[Any]) -> sympy.Basic:
    return sympy.Tuple(*(_expr(_convert(item)) for item in _args(node, 2)))


def _invisible(node: list[Any]) -> sympy.Basic:
    args = _args(node, 1)
    mixed = _mixed_number(args)
    if mixed is not None:
        return mixed
    if any(_is_digit_literal(a) for a in args[1:]):
        # "2 3" with no operator is ambiguous; ask rather than guess.
        raise MathJsonError("Put an operation between the two numbers.")
    return sympy.Mul(*(_expr(_convert(a)) for a in args))


def _relation(node: list[Any]) -> sympy.Basic:
    left, right = (_expr(_convert(a)) for a in _args(node, 2, 2))
    return RELATIONS[node[0]](left, right, evaluate=False)


_HEADS: dict[str, Callable[[list[Any]], sympy.Basic]] = {
    "Add": _add,
    "Multiply": _multiply,
    "Subtract": _subtract,
    "Negate": _negate,
    "Divide": _divide,
    "Rational": _divide,
    "Power": _power_node,
    "Square": _square,
    "Sqrt": _sqrt,
    "Root": _root,
    "Abs": _abs,
    "Percent": _percent,
    "Degrees": _degrees,
    "Delimiter": _delimiter,
    "Sequence": _sequence,
    "Tuple": _tuple,
    "Pair": _tuple,
    "Triple": _tuple,
    "List": _tuple,
    "Ratio": _tuple,
    "InvisibleOperator": _invisible,
    **dict.fromkeys(RELATIONS, _relation),
}


def split_unit(node: Any) -> tuple[Any, str | None]:
    """Take a trailing unit off a value: ["Multiply", 5, "cm"] is (5, "cm").

    Squared and cubed units are written cm^2 and cm^3 in the result. A whole answer written as
    a percentage, ["Percent", 40], is the number 40 with the unit "%".
    """
    if isinstance(node, list) and len(node) == 2 and node[0] in ("Percent", "Degrees"):
        return node[1], "%" if node[0] == "Percent" else "°"
    if (
        not isinstance(node, list)
        or len(node) < 3
        or node[0] not in ("Multiply", "InvisibleOperator")
    ):
        return node, None
    last = node[-1]
    unit: str | None = None
    if isinstance(last, str) and last in UNITS:
        unit = last
    elif (
        isinstance(last, list)
        and len(last) == 3
        and last[0] == "Power"
        and isinstance(last[1], str)
        and last[1] in UNITS
        and last[2] in (2, 3)
    ):
        unit = f"{last[1]}^{last[2]}"
    elif (
        isinstance(last, list)
        and len(last) == 2
        and last[0] == "Square"
        and isinstance(last[1], str)
        and last[1] in UNITS
    ):
        unit = f"{last[1]}^2"
    if unit is None:
        return node, None
    rest = node[1:-1]
    return (rest[0] if len(rest) == 1 else [node[0], *rest]), unit


def _parts(value: sympy.Basic) -> list[sympy.Basic]:
    if isinstance(value, sympy.core.relational.Relational):
        return [value.lhs, value.rhs]
    if isinstance(value, sympy.Tuple):
        return list(value.args)
    return [value]


def to_sympy(node: Any) -> sympy.Basic:
    """Convert MathJSON to SymPy, or raise MathJsonError."""
    check_limits(node)
    try:
        value = _convert(node)
    except MathJsonError:
        raise
    except (
        RecursionError,
        OverflowError,
        MemoryError,
        ValueError,
        TypeError,
        ZeroDivisionError,
    ) as error:
        raise MathJsonError("That expression could not be checked.") from error
    if value.has(sympy.zoo, sympy.nan, sympy.oo, -sympy.oo):
        raise MathJsonError("That divides by zero.")
    if value.has(sympy.I) or any(
        isinstance(part, sympy.Expr) and part.is_number and part.is_real is False
        for part in _parts(value)
    ):
        raise MathJsonError("That has no real value, such as the square root of a negative.")
    parts = (
        [value.lhs, value.rhs] if isinstance(value, sympy.core.relational.Relational) else [value]
    )
    if isinstance(value, sympy.Tuple):
        parts = list(value.args)
    if any(degree(part) > MAX_DEGREE for part in parts):
        raise MathJsonError("That power is too high for Eddy to check.")
    if len(value.free_symbols) > MAX_SYMBOLS:
        raise MathJsonError("That uses more letters than Eddy can check.")
    radicals = sum(
        1
        for sub_expr in sympy.preorder_traversal(value)
        if isinstance(sub_expr, sympy.Abs)
        or (isinstance(sub_expr, sympy.Pow) and not sub_expr.exp.is_Integer)
    )
    if radicals > MAX_RADICALS:
        raise MathJsonError("That has more roots than Eddy can check.")
    return value


def read_response(node: Any) -> Converted:
    """A student's answer: the value, with any trailing unit split off first."""
    check_limits(node)
    body, unit = split_unit(node)
    return Converted(value=to_sympy(body), unit=unit)
