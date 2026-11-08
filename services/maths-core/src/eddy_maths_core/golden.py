"""The maths golden set (SPEC.md section 7.6): 300 fixed items that must verify at 100%.

`python -m eddy_maths_core.golden write PATH` records the items; `check PATH` verifies them.
Each record freezes a generated item: its stem, its answer in the form the question asks for,
and each distractor with its misconception. Checking regenerates the item from its template and
seed and requires all of these:

- the stem is unchanged (templates are deterministic);
- the recorded answer is marked correct, form included;
- every recorded distractor is marked wrong and recognised as its own misconception.

A template change that alters an answer therefore fails here until the golden file is
rewritten and the change reviewed. Never rewrite it to make a failure go away.
"""

import json
import sys
from pathlib import Path
from typing import Any

from eddy_maths_core.items import ALL, TEMPLATES
from eddy_maths_core.mathjson import MathJsonError, to_sympy
from eddy_maths_core.serialize import answer_mathjson, to_latex
from eddy_maths_core.verify import check_answer

SIZE = 300
FIRST_SEED = 1000
MAX_TRIES = 50


def selection() -> list[tuple[str, int]]:
    """Template and seed pairs, round-robin over every template so each is covered, skipping
    any seed that repeats an item already chosen. A template with only a few distinct items
    (2/3 and 1/3 to a decimal) drops out once they are used up."""
    chosen: list[tuple[str, int]] = []
    seen: set[str] = set()
    next_seed = dict.fromkeys(sorted(t.id for t in ALL), FIRST_SEED)
    while len(chosen) < SIZE:
        progressed = False
        for template_id in sorted(next_seed):
            if len(chosen) == SIZE:
                break
            for _ in range(MAX_TRIES):
                seed = next_seed[template_id]
                next_seed[template_id] += 1
                item = TEMPLATES[template_id].generate(seed)
                key = json.dumps([item.stem, item.diagram], sort_keys=True, default=str)
                if key not in seen:
                    seen.add(key)
                    chosen.append((template_id, seed))
                    progressed = True
                    break
        if not progressed:
            raise RuntimeError("the templates cannot make enough distinct items")
    return chosen


def record(template_id: str, seed: int) -> dict[str, Any]:
    item = TEMPLATES[template_id].generate(seed)
    return {
        "template_id": template_id,
        "seed": seed,
        "node": item.node,
        "stem": item.stem,
        "answer": answer_mathjson(item.answer, item.answer_format),
        "answer_latex": to_latex(item.answer),
        "distractors": [
            {
                "misconception": d.misconception,
                "value": answer_mathjson(d.value, item.answer_format),
            }
            for d in item.distractors
        ],
    }


def write(path: Path) -> None:
    lines = [json.dumps(record(t, s), ensure_ascii=False, sort_keys=True) for t, s in selection()]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(("\n".join(lines) + "\n").encode("utf-8"))


def check_record(entry: dict[str, Any]) -> list[str]:
    where = f"{entry['template_id']}@{entry['seed']}"
    template = TEMPLATES.get(entry["template_id"])
    if template is None:
        return [f"{where}: no such template"]
    item = template.generate(entry["seed"])
    problems = []
    if item.stem != entry["stem"]:
        problems.append(f"{where}: the stem changed")
    result = check_answer(item, entry["answer"])
    if not result.correct:
        problems.append(f"{where}: the recorded answer is not marked correct ({result})")
    for distractor in entry["distractors"]:
        try:
            to_sympy(distractor["value"])
        except MathJsonError as error:
            problems.append(f"{where}: a distractor cannot be read: {error}")
            continue
        verdict = check_answer(item, distractor["value"])
        if verdict.equivalent:
            problems.append(f"{where}: distractor {distractor['misconception']} is marked right")
        if distractor["misconception"] not in verdict.misconceptions:
            problems.append(f"{where}: distractor {distractor['misconception']} is not recognised")
    return problems


def check(path: Path) -> tuple[int, list[str]]:
    entries = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]
    problems = [problem for entry in entries for problem in check_record(entry)]
    return len(entries), problems


def main(argv: list[str]) -> int:
    if len(argv) != 2 or argv[0] not in ("write", "check"):
        print("usage: python -m eddy_maths_core.golden write|check PATH", file=sys.stderr)
        return 2
    path = Path(argv[1])
    if argv[0] == "write":
        write(path)
        print(f"wrote {SIZE} golden items to {path}")
        return 0
    count, problems = check(path)
    for problem in problems:
        print(problem, file=sys.stderr)
    verified = count - len({p.split(":")[0] for p in problems})
    print(f"maths golden set: {verified}/{count} items verified")
    return 1 if problems or count != SIZE else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
