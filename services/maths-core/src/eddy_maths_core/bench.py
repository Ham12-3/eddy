"""Verification latency (SPEC.md section 7.3: p95 under 150 ms).

`python -m eddy_maths_core.bench [PATH]` times every verification path maths-core serves, from
MathJSON in to a verdict out, over the golden set: the correct answer and each distractor per
item, plus an expansion step, a quadratic solved step by step and a symbolic claim each time.
It prints p50, p95 and the maximum, and exits 1 if p95 is 150 ms or more.
"""

import json
import statistics
import sys
import time
from pathlib import Path

from eddy_maths_core.items import TEMPLATES
from eddy_maths_core.verify import check_answer, check_steps, verify_claims

TARGET_MS = 150.0
DEFAULT_PATH = Path("evals/golden/maths/items.jsonl")
# Work that reaches the slow paths: expansion, solving and symbolic simplification.
EXPANSION = [["Power", ["Add", "x", 3], 2], ["Add", ["Power", "x", 2], ["Multiply", 6, "x"], 9]]
EQUATION = [
    ["Equal", ["Add", ["Multiply", 3, ["Power", "x", 2]], ["Multiply", -12, "x"]], 0],
    ["Equal", ["Multiply", 3, "x", ["Subtract", "x", 4]], 0],
    ["Equal", ["Multiply", "x", ["Subtract", "x", 4]], 0],
]
IDENTITY = ["Equal", ["Multiply", 2, ["Add", "x", 3]], ["Add", ["Multiply", 2, "x"], 6]]


def run(path: Path) -> list[float]:
    entries = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]
    timings: list[float] = []

    def timed(action: object) -> None:
        start = time.perf_counter()
        action()  # type: ignore[operator]
        timings.append((time.perf_counter() - start) * 1000)

    for entry in entries:
        item = TEMPLATES[entry["template_id"]].generate(entry["seed"])
        answer = entry["answer"]
        timed(lambda item=item, answer=answer: check_answer(item, answer))
        for distractor in entry["distractors"]:
            timed(lambda item=item, value=distractor["value"]: check_answer(item, value))
        timed(lambda: check_steps(EXPANSION))
        timed(lambda: check_steps(EQUATION))
        timed(
            lambda item=item: verify_claims([("claim", IDENTITY), ("given", ["Equal", 2, 2])], item)
        )
    return timings


def main(argv: list[str]) -> int:
    path = Path(argv[0]) if argv else DEFAULT_PATH
    run(path)  # warm up: first calls import and cache SymPy internals
    timings = run(path)
    ordered = sorted(timings)
    p95 = ordered[int(0.95 * (len(ordered) - 1))]
    print(
        f"{len(timings)} verifications: p50 {statistics.median(timings):.2f} ms, "
        f"p95 {p95:.2f} ms, max {ordered[-1]:.2f} ms (target p95 < {TARGET_MS:.0f} ms)"
    )
    return 0 if p95 < TARGET_MS else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
