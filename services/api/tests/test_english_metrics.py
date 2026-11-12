"""Agreement metrics for English marking (Loop 4 scaffolding), against hand-worked values."""

import pytest

from eddy_api.english.metrics import adjacent_agreement, exact_agreement, quadratic_weighted_kappa
from eddy_api.llm.io import EnglishMarking


def test_perfect_and_opposite_agreement() -> None:
    assert quadratic_weighted_kappa([1, 2, 3, 4], [1, 2, 3, 4], 1, 4) == pytest.approx(1.0)
    assert quadratic_weighted_kappa([0, 0, 1, 1], [1, 1, 0, 0], 0, 1) == pytest.approx(-1.0)


def test_a_hand_worked_kappa() -> None:
    # Scale 0 to 2. Observed: (0,0), (1,2), (2,1). Weights (i - j)^2 / 4.
    # Weighted disagreement 0.25 + 0.25 = 0.5; expected (all cells 1/3) = 3 x 1/3 = 1.
    assert quadratic_weighted_kappa([0, 1, 2], [0, 2, 1], 0, 2) == pytest.approx(0.5)


def test_kappa_is_symmetric_and_near_misses_cost_less() -> None:
    a, b = [1, 2, 3, 4, 5, 6], [1, 3, 3, 4, 6, 6]
    assert quadratic_weighted_kappa(a, b, 1, 6) == pytest.approx(
        quadratic_weighted_kappa(b, a, 1, 6)
    )
    near = quadratic_weighted_kappa([1, 2, 3, 4], [2, 3, 4, 3], 1, 4)
    far = quadratic_weighted_kappa([1, 2, 3, 4], [4, 4, 1, 1], 1, 4)
    assert near > far


def test_one_shared_level_is_perfect_agreement() -> None:
    assert quadratic_weighted_kappa([3, 3, 3], [3, 3, 3], 1, 6) == 1.0


def test_exact_and_adjacent_agreement() -> None:
    a, b = [1, 2, 3, 4, 5], [1, 3, 3, 6, 5]
    assert exact_agreement(a, b, 1, 6) == pytest.approx(0.6)
    assert adjacent_agreement(a, b, 1, 6) == pytest.approx(0.8)


@pytest.mark.parametrize(
    ("first", "second", "low", "high"),
    [([1, 2], [1], 1, 4), ([], [], 1, 4), ([1], [1], 2, 2), ([0], [1], 1, 4)],
)
def test_bad_input_is_refused(first: list[int], second: list[int], low: int, high: int) -> None:
    with pytest.raises(ValueError, match=r"same answers|No marks|two levels|outside"):
        quadratic_weighted_kappa(first, second, low, high)


def test_the_marking_output_schema() -> None:
    marking = EnglishMarking.model_validate(
        {
            "question_type": "reading_evaluation",
            "marks": 14,
            "max_marks": 20,
            "overall_level": 3,
            "assessments": [
                {
                    "objective": "AO4",
                    "level": 3,
                    "evidence": ["the storm felt alive"],
                    "comment": "Clear.",
                }
            ],
            "next_step": "Explain how one method shapes the reader's view.",
        }
    )
    assert marking.assessments[0].objective == "AO4"
    with pytest.raises(ValueError, match="pattern"):
        EnglishMarking.model_validate(
            {
                **marking.model_dump(),
                "assessments": [{"objective": "AO9", "level": 1, "evidence": [], "comment": ""}],
            }
        )
