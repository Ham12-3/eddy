"""`python -m eddy_api.learner`: the synthetic-student report behind ADR-0026.

Prints how quickly learnable students reach SECURE, how many scenes students who already know a
node are shown because of slips, and how often students with a misconception are wrongly called
SECURE, on free answers and on choice items. Seeded, so the numbers repeat exactly.
"""

import random
import statistics
import sys

from eddy_api.learner.simulator import Run, Student, run

STUDENTS = 5000
GROUP = 2500


def _speed(runs: list[Run]) -> str:
    secured = sorted(r.secured_after for r in runs if r.secured_after is not None)
    return (
        f"secured {len(secured)}/{len(runs)}; attempts median {statistics.median(secured):g}, "
        f"p99 {secured[int(0.99 * len(secured)) - 1]}, max {max(secured)}"
    )


def _false(runs: list[Run]) -> str:
    return f"{sum(r.false_secure for r in runs) / len(runs):.2%}"


def _persistent(rng: random.Random, rate: float, options: int | None = None) -> Student:
    return Student(
        learn=0.3,
        knows=True,
        misconception=rate,
        applicable=rng.uniform(0.3, 1.0),
        options=options,
        # On a choice item a slip lands on the misconception's distractor one time in
        # (options - 1).
        wrong_matches=1 / (options - 1) if options else 0.0,
    )


def main() -> int:
    rng = random.Random(2026)  # noqa: S311 (a seeded simulation, not security)
    learnable = [run(Student(learn=rng.uniform(0.1, 0.3)), rng) for _ in range(STUDENTS)]
    print(f"Learnable students (learn 0.1 to 0.3), free answers, {STUDENTS} runs of 60 attempts:")
    print(f"  {_speed(learnable)}")
    print(f"  secured without truly knowing (lucky guesses): {_false(learnable)}")

    choice = [
        run(
            Student(learn=rng.uniform(0.1, 0.3), options=2, wrong_matches=1.0),
            rng,
            max_attempts=120,
        )
        for _ in range(GROUP)
    ]
    print(f"Learnable students, two-option choice items, {GROUP} runs of 120 attempts:")
    print(f"  {_speed(choice)}")
    print(f"  secured without truly knowing (lucky guesses): {_false(choice)}")

    knowers = [
        run(Student(learn=0.3, knows=True, options=2, wrong_matches=1.0), rng, max_attempts=120)
        for _ in range(GROUP)
    ]
    shown = sum(r.scenes > 0 for r in knowers) / GROUP
    print(f"Students who already know the node, two-option items, 10% slips, {GROUP} runs:")
    print(f"  {_speed(knowers)}")
    print(f"  shown a scene for a slip: {shown:.2%}")

    print(f"Students who never learn the node (a prerequisite gap), {GROUP} runs of 60 attempts:")
    for guess in (0.2, 0.1, 0.05):
        runs = [run(Student(learn=0.0, guess=guess), rng) for _ in range(GROUP)]
        offered = statistics.mean(r.diagnostics for r in runs)
        print(
            f"  right by chance {guess:.0%} of the time: falsely SECURE {_false(runs)}; "
            f"prerequisite diagnostic offered {offered:.1f} times on average"
        )
    runs = [run(Student(learn=0.0, options=2, wrong_matches=1.0), rng) for _ in range(GROUP)]
    print(f"  on two-option items (right by chance half the time): falsely SECURE {_false(runs)}")

    print(f"Persistent misconception (never cured), free answers, {GROUP} runs per rate:")
    for rate in (0.5, 0.6, 0.7, 0.8, 0.9, 1.0):
        runs = [run(_persistent(rng, rate), rng) for _ in range(GROUP)]
        print(f"  makes the mistake {rate:.0%} of the time: falsely SECURE {_false(runs)}")
    for options in (2, 4):
        runs = [run(_persistent(rng, rng.uniform(0.8, 1.0), options), rng) for _ in range(GROUP)]
        print(
            f"Persistent misconception (80% to 100%), {options}-option choice items, no "
            f"confidence ratings: falsely SECURE {_false(runs)}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
