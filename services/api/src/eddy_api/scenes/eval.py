"""The Tier L eval suite (PLAN.md M6): 100 misconception cases through the whole hot path.

    uv run --package eddy-api python -m eddy_api.scenes.eval build
    uv run --package eddy-api python -m eddy_api.scenes.eval run            # dry run: no calls
    uv run --package eddy-api python -m eddy_api.scenes.eval run --live --max-gbp 20
    uv run --package eddy-api python -m eddy_api.scenes.eval cache-bench

`build` writes evals/scenes-tier-l/cases.jsonl from the frozen scene golden inputs: real items
from maths-core with each misconception's real wrong answer, 7 or 8 per scene, each with a reason
(asked to see it another way, or the mistake recurred), a confidence level and the reviewed
narration the student has already seen, which a new version must differ from.

`run --live` calls Claude, so it costs money: it needs your ANTHROPIC_API_KEY in services/api/.env,
the scene-check service and maths-core running, and it stops once it has spent `--max-gbp` (every
billed call counts, including ones that failed). Each case passes when a variant clears every
check on the first or second attempt (PLAN.md M6; production allows a third). It reports the pass
rate, cold latency over every completed case (p50 and p95), cost per variant and cached input
tokens against evals/thresholds.yaml, and writes a full report to e2e-artifacts/evals/.
`--critique` also reviews each passing variant (keyframes and the vision critique) and reports
the critique pass rate.

`cache-bench` times the cache-hit path of POST /v1/scenes/variants (with the real scene-check
service, in a transaction that is rolled back) against the 300 ms target.
"""

import argparse
import json
import statistics
import sys
import time
import uuid
from datetime import UTC, datetime
from typing import Any

import yaml
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from eddy_api.auth import Caller
from eddy_api.config import get_settings
from eddy_api.db.models import Attempt, CurriculumNode, Item, Misconception, User
from eddy_api.db.session import get_engine, get_session
from eddy_api.llm.client import CallRecord, LlmClient, LlmError
from eddy_api.llm.config import REPO_ROOT
from eddy_api.scenes.generate import VariantRequest, generate_variant, misconception_notes
from eddy_api.scenes.review import review_scene
from eddy_api.scenes.services import MathsCoreClient, SceneCheckClient, SceneServiceError

SUITE = REPO_ROOT / "evals" / "scenes-tier-l"
CASES = SUITE / "cases.jsonl"
INPUTS = REPO_ROOT / "evals" / "golden" / "scenes" / "inputs.json"
THRESHOLDS = REPO_ROOT / "evals" / "thresholds.yaml"
REPORTS = REPO_ROOT / "e2e-artifacts" / "evals"
CASE_COUNT = 100
# The suite stays on the 13 scenes it was set up for in M6, so its results stay comparable as
# more Tier D scenes (and their golden inputs) are added.
SUITE_SCENES = (
    "n1-order-negatives",
    "n1-order-decimals",
    "n9-standard-to-ordinary",
    "r9-reverse-percentage",
    "r5-share-in-ratio",
    "a17-two-step",
    "a10-gradient-two-points",
    "g3-cointerior",
    "g7-translation",
    "g16-triangle-area",
    "g20-hypotenuse",
    "p8-tree-and",
    "s4-median",
)
ATTEMPTS = 2
CONFIDENCES = [None, "low", "medium", "high"]
# A rough cost per case for the dry run: Opus 4.8 with adaptive thinking at high effort, about
# 3,000 input tokens (mostly cached after the first case) and 4,000 output tokens a call.
ESTIMATE_GBP_PER_CASE = 0.10


def build() -> list[dict[str, Any]]:
    every: dict[str, list[dict[str, Any]]] = json.loads(INPUTS.read_bytes())
    inputs = {key: rows for key, rows in every.items() if key.split(":")[0] in SUITE_SCENES}
    notes = misconception_notes()
    cases: list[dict[str, Any]] = []
    extra = sum(len(rows) for rows in inputs.values()) - CASE_COUNT
    for index, (key, rows) in enumerate(inputs.items()):
        item_template, misconception = key.split(":")
        # Drop one item from the first scenes until exactly CASE_COUNT remain.
        keep = rows[:-1] if index < extra else rows
        for row in keep:
            n = len(cases)
            reason = "another_way" if n % 2 == 0 else "recurred"
            cases.append(
                {
                    "id": f"{item_template}-{row['seed']}",
                    "template": notes[misconception]["scene"],
                    "item_template": item_template,
                    "misconception": misconception,
                    "seed": row["seed"],
                    "params": row["params"],
                    "studentAnswer": row["studentAnswer"],
                    "answer": row["answer"],
                    "reason": reason,
                    "confidence": CONFIDENCES[n % len(CONFIDENCES)],
                    # Both reasons mean the student has already watched the reviewed scene.
                    "seen_tier_d": True,
                }
            )
    if len(cases) != CASE_COUNT:
        raise ValueError(f"Expected {CASE_COUNT} cases, built {len(cases)}")
    return cases


def write_cases() -> None:
    SUITE.mkdir(parents=True, exist_ok=True)
    lines = [json.dumps(case, ensure_ascii=False, sort_keys=True) for case in build()]
    CASES.write_bytes(("\n".join(lines) + "\n").encode())
    print(f"Wrote {len(lines)} cases to {CASES.relative_to(REPO_ROOT).as_posix()}")


def load_cases() -> list[dict[str, Any]]:
    return [json.loads(line) for line in CASES.read_bytes().decode().splitlines() if line]


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, round(fraction * (len(ordered) - 1)))] if ordered else 0.0


def thresholds() -> dict[str, float]:
    raw: dict[str, Any] = yaml.safe_load(THRESHOLDS.read_bytes())
    return {k: float(v) for k, v in raw["scenes_tier_l"].items()}


def run_case(
    case: dict[str, Any],
    llm: LlmClient,
    scene_check: SceneCheckClient,
    maths_core: MathsCoreClient,
    *,
    critique: bool = False,
) -> dict[str, Any]:
    seen: list[list[str]] = []
    if case["seen_tier_d"]:
        context = scene_check.context(case["template"], case["params"], case["studentAnswer"])
        seen = [[beat["narration"] for beat in context["tierD"]["beats"]]]
    request = VariantRequest(
        template=case["template"],
        item=case["params"],
        student_answer=case["studentAnswer"],
        answer=case["answer"],
        reason=case["reason"],
        confidence=case["confidence"],
        seen=seen,
    )
    try:
        variant = generate_variant(
            request,
            llm=llm,
            scene_check=scene_check,
            maths_core=maths_core,
            max_attempts=ATTEMPTS,
        )
    except (LlmError, SceneServiceError) as error:
        return {"id": case["id"], "passed": False, "error": f"{type(error).__name__}: {error}"}
    result: dict[str, Any] = {
        "id": case["id"],
        "template": case["template"],
        "passed": variant.passed,
        "attempts": [
            {"problems": a.problems, "cost_gbp": a.cost_gbp, "latency_ms": a.latency_ms}
            for a in variant.attempts
        ],
        "passed_on": len(variant.attempts) if variant.passed else None,
        "latency_ms": variant.latency_ms,
        "cost_gbp": variant.cost_gbp,
        "beats": variant.beats,
        "prompt_version": variant.prompt.version if variant.prompt else None,
        "model": variant.model,
        "cache_read_tokens": sum(a.cache_read_tokens for a in variant.attempts),
    }
    if critique and variant.passed and variant.spec is not None:
        try:
            review = review_scene(variant.spec, case["template"], scene_check=scene_check, llm=llm)
            result["critique"] = {"passed": review.passed, "problems": review.problems}
        except (LlmError, SceneServiceError) as error:
            result["critique"] = {"passed": False, "problems": [type(error).__name__]}
    return result


def summarise(results: list[dict[str, Any]], limits: dict[str, float]) -> dict[str, Any]:
    done = [r for r in results if "error" not in r]
    passed = [r for r in results if r["passed"]]
    first = [r for r in passed if r.get("passed_on") == 1]
    # Every completed case, passed or not: the slow paths are the ones that matter.
    latencies = [float(r["latency_ms"]) for r in done]
    costs = [float(r["cost_gbp"]) for r in done]
    critiqued = [r for r in results if "critique" in r]
    summary: dict[str, Any] = {
        "cases": len(results),
        "passed_within_two": len(passed) / len(results) if results else 0.0,
        "passed_first_time": len(first) / len(results) if results else 0.0,
        "errors": len(results) - len(done),
        "cold_p50_ms": percentile(latencies, 0.5),
        "cold_p95_ms": percentile(latencies, 0.95),
        "cost_gbp_total": round(sum(costs), 4),
        "cost_gbp_per_variant": round(sum(costs) / len(passed), 4) if passed else None,
        "cost_gbp_per_case": round(statistics.mean(costs), 4) if costs else None,
        "cache_read_tokens": sum(int(r.get("cache_read_tokens", 0)) for r in done),
        "critique_pass_rate": (
            sum(1 for r in critiqued if r["critique"]["passed"]) / len(critiqued)
            if critiqued
            else None
        ),
    }
    summary["meets_pass_rate"] = summary["passed_within_two"] >= limits["pass_within_two"]
    summary["meets_cold_p95"] = summary["cold_p95_ms"] < limits["cold_p95_ms"]
    return summary


def run(args: argparse.Namespace) -> int:
    cases = load_cases()[: args.limit] if args.limit else load_cases()
    limits = thresholds()
    if not args.live:
        print(
            f"Dry run: {len(cases)} cases, about £{ESTIMATE_GBP_PER_CASE * len(cases):.2f} "
            f"(up to {ATTEMPTS} attempts each, capped at £{args.max_gbp:.2f}). "
            "Nothing was sent. Add --live to call Claude."
        )
        return 0
    settings = get_settings()
    # Every billed call counts against the cap, including those in a case that then failed.
    calls: list[CallRecord] = []
    llm = LlmClient.from_key(settings.anthropic_api_key.get_secret_value(), recorder=calls.append)
    scene_check = SceneCheckClient.from_settings(settings)
    maths_core = MathsCoreClient.from_settings(settings)
    results: list[dict[str, Any]] = []
    for case in cases:
        spent = sum(call.cost_gbp for call in calls)
        if spent >= args.max_gbp:
            print(f"Stopped at the £{args.max_gbp:.2f} cap after {len(results)} cases.")
            break
        result = run_case(case, llm, scene_check, maths_core, critique=args.critique)
        spent = sum(call.cost_gbp for call in calls)
        results.append(result)
        state = "pass" if result["passed"] else "FAIL"
        print(f"{len(results):3d} {case['id']:<32} {state} £{spent:.2f}", flush=True)
    summary = summarise(results, limits)
    summary["cost_gbp_billed"] = round(sum(call.cost_gbp for call in calls), 4)
    REPORTS.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    path = REPORTS / f"tier-l-{stamp}.json"
    path.write_bytes(json.dumps({"summary": summary, "results": results}, indent=1).encode())
    print(json.dumps(summary, indent=1))
    print(f"Report: {path.relative_to(REPO_ROOT).as_posix()}")
    complete = len(results) == len(cases)
    return 0 if complete and summary["meets_pass_rate"] and summary["meets_cold_p95"] else 1


def cache_bench(requests: int) -> int:
    """POST /v1/scenes/variants cache hits, timed end to end through the app."""
    # Imported here: the app imports this package's modules.
    from eddy_api.main import create_app
    from eddy_api.routes.scenes import SceneServices, get_scene_services, student_or_system
    from eddy_api.scenes.variants import store_spec

    settings = get_settings()
    scene_check = SceneCheckClient.from_settings(settings)
    case = load_cases()[0]
    context = scene_check.context(case["template"], case["params"], case["studentAnswer"])
    variant = json.loads(json.dumps(context["tierD"]))
    variant["beats"][-1]["narration"] += " That is the answer."

    connection = get_engine().connect()
    transaction = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint")
    try:
        node = session.scalar(select(CurriculumNode).where(CurriculumNode.code == "N1"))
        misconception = session.scalar(
            select(Misconception).where(Misconception.code == case["misconception"])
        )
        if node is None or misconception is None:
            print("Seed the local database first: pnpm db:migrate && pnpm db:seed")
            return 1
        item = Item(
            node_id=node.id,
            template_id=case["item_template"],
            params=case["params"],
            stem_markdown="bench",
            answer_canonical=json.dumps(case["answer"]),
            answer_format={},
            calculator_allowed=False,
            command_word="WORK_OUT",
            marks=1,
            provenance="TEMPLATE",
        )
        session.add(item)
        session.flush()
        cached = store_spec(session, variant, tier="LLM", model="bench")
        cached.render_status = "PASSED"
        attempts = []
        for _ in range(requests):
            user = User(email=f"bench-{uuid.uuid4().hex}@example.test", role="student")
            session.add(user)
            session.flush()
            attempt = Attempt(
                student_id=user.id,
                item_id=item.id,
                response_raw="",
                response_mathjson=case["studentAnswer"],
                correct=False,
                detected_misconception_id=misconception.id,
                time_ms=1,
            )
            session.add(attempt)
            attempts.append(attempt)
        session.flush()

        app = create_app()
        app.dependency_overrides[get_session] = lambda: session
        maths_core = MathsCoreClient.from_settings(settings)
        app.dependency_overrides[get_scene_services] = lambda: SceneServices(
            scene_check=scene_check, maths_core=maths_core
        )
        app.dependency_overrides[student_or_system] = lambda: Caller(subject="bench", role="system")
        timings: list[float] = []
        with TestClient(app) as client:
            for attempt in attempts:
                start = time.perf_counter()
                response = client.post(
                    "/v1/scenes/variants",
                    json={"attempt_id": str(attempt.id), "reason": "another_way"},
                )
                timings.append((time.perf_counter() - start) * 1000)
                if response.status_code != 200 or response.json()["source"] != "cache":
                    print(f"Not a cache hit: {response.status_code} {response.text[:200]}")
                    return 1
    finally:
        session.close()
        transaction.rollback()
        connection.close()
    p95 = percentile(timings, 0.95)
    print(
        f"{len(timings)} cache hits: p50 {statistics.median(timings):.1f} ms, "
        f"p95 {p95:.1f} ms (target p95 < {thresholds()['cache_hit_p95_ms']:.0f} ms)"
    )
    return 0 if p95 < thresholds()["cache_hit_p95_ms"] else 1


def main(argv: list[str]) -> int:
    # Pound signs and narration print correctly on a Windows console too.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("build", help="write the 100 cases")
    runner = sub.add_parser("run", help="run the cases (a dry run unless --live)")
    runner.add_argument("--live", action="store_true", help="call Claude (costs money)")
    runner.add_argument("--max-gbp", type=float, default=20.0, help="stop after spending this")
    runner.add_argument("--limit", type=int, default=0, help="run only the first N cases")
    runner.add_argument("--critique", action="store_true", help="also review passing variants")
    bench = sub.add_parser("cache-bench", help="time cache hits through the route")
    bench.add_argument("--requests", type=int, default=100)
    args = parser.parse_args(argv)
    if args.command == "build":
        write_cases()
        return 0
    if args.command == "run":
        return run(args)
    return cache_bench(args.requests)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
