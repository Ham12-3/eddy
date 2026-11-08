"""PLAN.md M4 definition of done, measured on synthetic students (ADR-0026).

Fixed seeds keep these deterministic. The populations:

- learnable: start not knowing the node, each attempt teaches it with chance 0.1 to 0.3;
- persistent misconception: knows the rest of the node, but makes the misconception's mistake
  on 80% to 100% of the items that could show it, and remediation never cures it;
- curable misconception: as above at 80%, but each remediation cures it half the time;
- knowers on two-option items, whose every slip lands on the distractor;
- non-learners, who never learn the node (a prerequisite gap).

Students practise 5 items a day, at most 60 (or 120) attempts.
"""

import random

from eddy_api.learner.simulator import Student, run

STUDENTS = 2000


def persistent(rng: random.Random, options: int | None = None) -> Student:
    return Student(
        learn=0.3,
        knows=True,
        misconception=rng.uniform(0.8, 1.0),
        applicable=rng.uniform(0.3, 1.0),
        options=options,
        wrong_matches=1 / (options - 1) if options else 0.0,
    )


def test_learnable_students_reach_secure_within_a_bounded_number_of_attempts() -> None:
    rng = random.Random(2026)
    runs = [run(Student(learn=rng.uniform(0.1, 0.3)), rng) for _ in range(STUDENTS)]
    secured = sorted(r.secured_after for r in runs if r.secured_after is not None)
    assert len(secured) == STUDENTS  # every one, within 60 attempts (12 days)
    assert secured[len(secured) // 2] <= 10
    assert secured[int(0.99 * len(secured)) - 1] <= 35


def test_persistent_misconceptions_are_falsely_secured_under_two_percent() -> None:
    rng = random.Random(7)
    runs = [run(persistent(rng), rng) for _ in range(STUDENTS)]
    rate = sum(r.false_secure for r in runs) / STUDENTS
    assert rate < 0.02, rate


def test_on_choice_items_too_without_confidence_ratings() -> None:
    rng = random.Random(8)
    for options in (2, 4):
        runs = [run(persistent(rng, options), rng) for _ in range(STUDENTS)]
        rate = sum(r.false_secure for r in runs) / STUDENTS
        assert rate < 0.02, (options, rate)


def test_curable_misconceptions_still_reach_secure() -> None:
    rng = random.Random(11)
    runs = [
        run(
            Student(
                learn=rng.uniform(0.1, 0.3),
                misconception=0.8,
                applicable=rng.uniform(0.3, 1.0),
                cure=0.5,
            ),
            rng,
            max_attempts=120,
        )
        for _ in range(STUDENTS // 2)
    ]
    assert all(r.secured_after is not None for r in runs)


def test_slips_on_two_option_items_rarely_bring_a_scene() -> None:
    rng = random.Random(12)
    runs = [
        run(Student(learn=0.3, knows=True, options=2, wrong_matches=1.0), rng, max_attempts=120)
        for _ in range(STUDENTS)
    ]
    assert all(r.secured_after is not None for r in runs)
    assert sum(r.scenes > 0 for r in runs) / STUDENTS < 0.25


def test_students_who_cannot_learn_get_the_prerequisite_diagnostic_each_session() -> None:
    rng = random.Random(3)
    runs = [run(Student(learn=0.0, guess=0.05), rng, max_attempts=30) for _ in range(200)]
    sessions = 30 // 5
    assert all(1 <= r.diagnostics <= sessions for r in runs)  # at most once a session
    assert sum(r.diagnostics == sessions for r in runs) / len(runs) > 0.9
    assert sum(r.false_secure for r in runs) / len(runs) < 0.02
