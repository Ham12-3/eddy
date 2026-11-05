"""One hand-worked example per misconception rule, independent of the rule's own code.

Each expected value was worked out by hand from the misconception's description (most from the
worked example in curriculum/maths/misconceptions.yaml). Unlike the property tests, which check
a distractor against the rule that made it, these would catch a rule that models the wrong
mistake.
"""

from typing import Any

import pytest
import sympy

from eddy_maths_core.equivalence import equivalent
from eddy_maths_core.items import ALL  # noqa: F401  (registers every rule)
from eddy_maths_core.rules import RULES

q = sympy.Rational
T = sympy.Tuple

EXAMPLES: dict[str, tuple[dict[str, Any], sympy.Basic]] = {
    # N1: -7 or -3, picks -3 as smaller; 0.5 or 0.125; 0.4 or 0.45; 1/5 or 1/8
    "neg_compare_by_magnitude": ({"a": 7, "b": 3}, sympy.Integer(-3)),
    "decimal_compare_by_length": ({"short": "0.5", "long": "0.125"}, q(1, 8)),
    "decimal_compare_shorter_bigger": ({"short": "0.4", "long": "0.45"}, q(2, 5)),
    "unit_fraction_compare_by_denominator": ({"a": 5, "b": 8}, q(1, 8)),
    # N2
    "neg_add_sign_rule_overapplied": ({"a": 3, "b": 4}, sympy.Integer(7)),
    "neg_sub_negative_as_sub": ({"a": 5, "b": 3}, sympy.Integer(2)),
    "neg_mult_sign_negative": ({"a": 3, "b": 4}, sympy.Integer(-12)),
    "frac_add_num_den": ({"a": 1, "b": 2, "c": 1, "d": 3}, q(2, 5)),
    "frac_sub_num_den": ({"a": 3, "b": 4, "c": 1, "d": 2}, sympy.Integer(1)),  # 2/2
    "frac_div_flip_first": ({"a": 1, "b": 2, "c": 3, "d": 4}, q(3, 2)),  # 2/1 x 3/4
    "decimal_add_right_aligned": ({"short": "3.2", "long": "1.45"}, q(177, 100)),
    "decimal_mult_point_count_wrong": ({"a": 3, "b": 2}, q(3, 5)),  # 0.6
    "mixed_mult_whole_only": ({"w": 2, "n": 1, "d": 2, "k": 3}, q(13, 2)),  # 6 1/2
    "left_to_right_evaluation": ({"a": 3, "b": 4, "c": 2}, sympy.Integer(14)),
    # N9
    "sf_negative_power_wrong_direction": ({"m": "4.2", "k": -3}, sympy.Integer(4200)),
    "sf_power_applied_to_mantissa": ({"m": "3.4", "k": 5}, q(17, 5) ** 5),
    "sf_power_counts_zeros": ({"m": "3.2", "k": 6}, sympy.Integer(320_000)),
    "sf_multiply_powers": ({"a": 2, "b": 3, "m": 3, "n": 4}, sympy.Integer(6 * 10**12)),
    # N10: one third as 0.3 (so two thirds as 0.6); 1/8 as 0.8; 0.5 as 5%; 3/5 as 35%
    "fdp_third_point_three": ({"n": 1, "d": 3}, q(3, 10)),
    "fdp_denominator_as_decimal": ({"n": 1, "d": 8}, q(4, 5)),
    "fdp_percent_digits_only": ({"x": "0.5"}, sympy.Integer(5)),
    "fdp_concatenate": ({"n": 3, "d": 5}, sympy.Integer(35)),
    # N11 and R6: 2 : 3 read as 2/3
    "ratio_part_over_other_part": ({"a": 2, "b": 3}, q(2, 3)),
    "ratio_fraction_inverted": ({"a": 2, "b": 3}, q(2, 3)),
    # N12: 3/4 of 20 as 5; 15% of 80 as 80 / 15
    "frac_of_amount_divide_only": ({"n": 3, "d": 4, "amount": 20}, sympy.Integer(5)),
    "pct_divide_by_percent": ({"amount": 80, "pct": 15}, q(16, 3)),
    # R4: 6 cats to 4 dogs as 2 : 3; 12 : 8 dividing one side as 3 : 8
    "ratio_order_swapped": ({"a": 6, "b": 4}, T(2, 3)),
    "ratio_simplify_one_part": ({"a": 12, "b": 8}, T(3, 8)),
    # R5: 45 in 2 : 3 as 45 / 2; 30 in 2 : 3 as 30 / 3 = 10 a part; a share of 30 treated as
    # the whole of 2 : 3
    "ratio_divide_by_each_part": ({"a": 2, "b": 3, "total": 45, "ask": "a"}, q(45, 2)),
    "ratio_divide_by_one_part": ({"a": 2, "b": 3, "total": 30, "ask": "a"}, sympy.Integer(20)),
    "ratio_part_treated_as_total": (
        {"a": 2, "b": 3, "given_part": "b", "given": 30, "ask": "a", "unit": 10},
        sympy.Integer(12),
    ),
    # R7: 6 eggs for 4 people becomes 8 for 6
    "ratio_additive_scaling": ({"people": 4, "new_people": 6, "amount": 6}, sympy.Integer(8)),
    # R9
    "pct_change_only": ({"amount": 60, "pct": 25}, sympy.Integer(15)),
    "pct_reverse_apply_to_new": ({"original": 100, "pct": 20, "sign": -1}, sympy.Integer(96)),
    "pct_successive_add": ({"amount": 200, "first": 10, "second": 20}, sympy.Integer(260)),
    "pct_change_over_new": ({"old": 80, "new": 100}, sympy.Integer(20)),
    # A17: x + 5 = 12 as 17; 3x = 12 as 9; 2x + 6 = 10 as x + 6 = 5; 3x = 2x + 5 as 5x = 5;
    # 5x + 3 = 2x + 9 as 5x - 3 = 2x + 9; 3(x + 4) = 18 as 3x + 4 = 18; -2x = 8 as 4
    "eq_inverse_wrong_operation": ({"b": 5, "c": 12}, sympy.Integer(17)),
    "eq_coefficient_subtracted": ({"a": 3, "c": 12}, sympy.Integer(9)),
    "eq_divide_one_term": ({"a": 2, "b": 6, "c": 10}, sympy.Integer(-1)),
    "eq_move_without_sign_change": ({"a": 3, "b": 0, "c": 2, "d": 5}, sympy.Integer(1)),
    "eq_sign_changed_not_moved": ({"a": 5, "b": 3, "c": 2, "d": 9}, sympy.Integer(4)),
    "expand_first_term_only": ({"a": 3, "b": 4, "c": 18}, q(14, 3)),
    "eq_sign_lost_dividing_negative": ({"a": -2, "c": 8}, sympy.Integer(4)),
    # A8, A9, A10
    "coordinates_swapped": ({"x": 3, "y": -2}, T(-2, 3)),
    "line_table_swapped": ({"m": 3, "c": 1, "k": -2}, sympy.Integer(-1)),
    "parallel_by_intercept": ({"m": 2, "c": 5}, sympy.Integer(5)),
    "gradient_run_over_rise": ({"x1": 0, "y1": 1, "x2": 2, "y2": 7}, q(1, 3)),
    "gradient_sign_dropped": ({"x1": 0, "y1": 5, "x2": 2, "y2": 1}, sympy.Integer(2)),
    "intercept_not_divided": ({"c": 6}, sympy.Integer(6)),
    "gradient_counts_squares": ({"rise_squares": 3, "run_squares": 3}, sympy.Integer(1)),
    # G3
    "angles_line_sum_360": ({"a": 110}, sympy.Integer(250)),
    "triangle_sum_360": ({"a": 50, "b": 60}, sympy.Integer(250)),
    "cointerior_as_equal": ({"a": 70}, sympy.Integer(70)),
    "polygon_interior_n_times_180": ({"n": 6}, sympy.Integer(1080)),
    "vertically_opposite_as_supplementary": ({"a": 40}, sympy.Integer(140)),
    # G7: (1, 2) by the vector (3, -1) moved (-1, 3); (3, 1) a quarter turn clockwise
    "translate_components_swapped": ({"x": 1, "y": 2, "dx": 3, "dy": -1}, T(0, 5)),
    "rotate_about_origin": ({"x": 3, "y": 1, "cx": 1, "cy": 1, "clockwise": True}, T(1, -3)),
    "rotate_wrong_direction": ({"x": 3, "y": 1, "cx": 1, "cy": 1, "clockwise": True}, T(1, 3)),
    "reflect_line_as_axis": ({"x": 2, "y": 5}, T(2, -5)),
    "enlarge_ignore_centre": ({"ax": 1, "ay": 1, "bx": 3, "by": 2, "k": 2}, T(5, 3)),
    # G16
    "area_as_perimeter": ({"l": 5, "w": 3}, sympy.Integer(16)),
    "triangle_no_half": ({"b": 6, "h": 4}, sympy.Integer(24)),
    "parallelogram_slant_height": ({"b": 10, "s": 6}, sympy.Integer(60)),
    "trapezium_no_half": ({"a": 3, "b": 5, "h": 4}, sympy.Integer(32)),
    "area_units_linear_factor": ({"m2": 1}, sympy.Integer(100)),
    # G17: radius 5 area as 2 x pi x 5; diameter 10 used as the radius
    "circle_area_as_circumference": ({"r": 5}, 10 * sympy.pi),
    "circle_diameter_as_radius": ({"d": 10}, 100 * sympy.pi),
    "composite_perimeter_includes_inner": (
        {"w": 9, "h": 10, "cut_w": 7, "cut_h": 5},
        sympy.Integer(40),
    ),
    # G20: sides 3 and 4; hypotenuse 5 and side 3
    "pythagoras_no_root": ({"a": 3, "b": 4}, sympy.Integer(25)),
    "pythagoras_add_sides": ({"a": 3, "b": 4}, sympy.Integer(7)),
    "pythagoras_subtract_for_hypotenuse": ({"a": 5, "b": 3}, sympy.Integer(4)),
    "pythagoras_add_for_leg": ({"c": 5, "a": 3}, sympy.sqrt(34)),
    # P7, P8: total 7 unordered (3 of 21); 1/2 then 1/3
    "sample_space_unordered": ({"total": 7}, q(1, 7)),
    "tree_add_along_branches": ({"a": 1, "n": 2, "b": 1, "m": 3}, q(5, 6)),
    "tree_multiply_alternatives": ({"a": 1, "n": 2, "b": 1, "m": 3}, q(1, 18)),
    "tree_ignore_replacement": ({"r": 3, "s": 2}, q(9, 25)),
    # S4
    "median_unordered": ({"values": [5, 1, 9, 3, 7]}, sympy.Integer(9)),
    "median_position_as_value": ({"values": [5, 1, 9, 3, 7]}, sympy.Integer(3)),
    "grouped_mean_class_width": ({"start": 0, "width": 10, "freqs": [2, 3, 5]}, sympy.Integer(10)),
    "grouped_mean_divide_by_groups": (
        {"start": 0, "width": 10, "freqs": [2, 3, 5]},
        sympy.Integer(60),
    ),
    "mode_as_frequency": ({"values": [0, 1, 2], "freqs": [3, 14, 9]}, sympy.Integer(14)),
    "range_largest_value": ({"values": [4, 9, 2]}, sympy.Integer(9)),
}


def test_every_rule_has_a_worked_example() -> None:
    assert set(EXAMPLES) == set(RULES)


@pytest.mark.parametrize("name", sorted(EXAMPLES))
def test_rule_matches_its_worked_example(name: str) -> None:
    params, expected = EXAMPLES[name]
    value = RULES[name](params)
    assert value is not None
    assert equivalent(value, expected), (name, value, expected)


def test_two_thirds_is_read_as_point_six() -> None:
    assert RULES["fdp_third_point_three"]({"n": 2, "d": 3}) == q(3, 5)
