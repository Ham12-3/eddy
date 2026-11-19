"""Precomputes Tier L variants (SPEC.md section 7.2 step 10): `pnpm scenes:precompute`.

    uv run --package eddy-api python -m eddy_api.scenes.precompute            # dry run
    uv run --package eddy-api python -m eddy_api.scenes.precompute --live --max-gbp 10

For each seeded misconception with a scene, it takes an item (the first scene golden input, a
real maths-core item with the misconception's predicted wrong answer) and makes up to three
variants through the whole pipeline: generation with every hot path check, then the background
review (keyframes and critique) straight away, following any replacement a failed review makes.
So only reviewed variants end up in the cache. Each variant is asked to differ from the reviewed
scene and from the variants before it.

It writes to the database in DATABASE_URL (a local one unless `--allow-remote`) and calls Claude,
so it costs money. It stops once it has spent `--max-gbp`, counting every billed call. When the
item bank arrives (M8) it will take the most attempted bank items instead.
"""

import argparse
import json
import sys
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.engine import make_url

from eddy_api.config import get_settings
from eddy_api.db.models import SceneSpec
from eddy_api.db.session import session_factory
from eddy_api.llm.client import CallRecord, LlmClient, LlmError
from eddy_api.llm.records import llm_recorder
from eddy_api.scenes.eval import INPUTS
from eddy_api.scenes.generate import Variant, VariantRequest, generate_variant, misconception_notes
from eddy_api.scenes.review import MAX_GENERATIONS, process
from eddy_api.scenes.services import MathsCoreClient, SceneCheckClient, SceneServiceError
from eddy_api.scenes.variants import store_spec, usable_variant, variant_report

PER_MISCONCEPTION = 3
ESTIMATE_GBP_PER_VARIANT = 0.15
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}


def items() -> list[dict[str, Any]]:
    inputs: dict[str, list[dict[str, Any]]] = json.loads(INPUTS.read_bytes())
    notes = misconception_notes()
    chosen = []
    for key, rows in inputs.items():
        _, misconception = key.split(":")
        chosen.append({"template": notes[misconception]["scene"], **rows[0]})
    return chosen


def main(argv: list[str]) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument("--live", action="store_true", help="call Claude and write to the database")
    parser.add_argument("--per-misconception", type=int, default=PER_MISCONCEPTION)
    # Its calls count against the daily scene budget (TIER_L_DAILY_BUDGET_GBP, default 5).
    parser.add_argument("--max-gbp", type=float, default=4.0)
    parser.add_argument("--allow-remote", action="store_true", help="allow a non-local database")
    args = parser.parse_args(argv)
    chosen = items()
    total = len(chosen) * args.per_misconception
    if not args.live:
        print(
            f"Dry run: {total} variants for {len(chosen)} misconceptions, about "
            f"£{ESTIMATE_GBP_PER_VARIANT * total:.2f} with their reviews (capped at "
            f"£{args.max_gbp:.2f}). Nothing was sent or stored. Add --live to run."
        )
        return 0

    settings = get_settings()
    host = make_url(settings.runtime_database_url.get_secret_value()).host or ""
    if host not in LOCAL_HOSTS and not args.allow_remote:
        print(f"Refusing to write to a non-local database ({host}); add --allow-remote.")
        return 1
    sessions = session_factory()
    calls: list[CallRecord] = []
    store_call = llm_recorder(sessions)

    def record(call: CallRecord) -> None:
        calls.append(call)
        store_call(call)

    llm = LlmClient.from_key(settings.anthropic_api_key.get_secret_value(), recorder=record)
    scene_check = SceneCheckClient.from_settings(settings)
    maths_core = MathsCoreClient.from_settings(settings)

    def generator(request: VariantRequest) -> Variant:
        return generate_variant(request, llm=llm, scene_check=scene_check, maths_core=maths_core)

    def spent() -> float:
        return sum(call.cost_gbp for call in calls)

    def review(row: SceneSpec) -> str:
        """Reviews a variant and any replacements it leads to; returns the final status."""
        with sessions() as session:
            current: SceneSpec | None = session.get(SceneSpec, row.id)
            for _ in range(MAX_GENERATIONS):
                if current is None:
                    return "FAILED"
                # Claim it as the worker would; if a worker holds it, leave it to the worker.
                locked = session.scalar(
                    select(SceneSpec)
                    .where(SceneSpec.id == current.id, SceneSpec.check_claimed_at.is_(None))
                    .with_for_update(skip_locked=True)
                )
                if locked is None:
                    session.rollback()
                    return "left to the worker"
                current.check_claimed_at = datetime.now(UTC)
                current.check_attempts += 1
                session.commit()
                replacement = process(
                    session, current, scene_check=scene_check, llm=llm, generator=generator
                )
                if current.render_status == "PASSED" or replacement is None:
                    return current.render_status
                current = session.get(SceneSpec, replacement)
            return current.render_status if current else "FAILED"

    kept = 0
    for entry in chosen:
        context = scene_check.context(entry["template"], entry["params"], entry["studentAnswer"])
        seen = [[beat["narration"] for beat in context["tierD"]["beats"]]]
        for number in range(args.per_misconception):
            if spent() >= args.max_gbp:
                print(f"Stopped at the £{args.max_gbp:.2f} cap.")
                return 1
            label = f"{entry['template']} #{number + 1}"
            request = VariantRequest(
                template=entry["template"],
                item=entry["params"],
                student_answer=entry["studentAnswer"],
                answer=entry["answer"],
                reason="precompute",
                seen=seen,
            )
            try:
                variant = generator(request)
            except (LlmError, SceneServiceError) as error:
                print(f"{label}: {type(error).__name__}")
                continue
            if not variant.passed or variant.spec is None:
                print(f"{label}: did not pass its checks (£{spent():.2f} so far)")
                continue
            with sessions() as session:
                row = store_spec(
                    session,
                    variant.spec,
                    tier="LLM",
                    report=variant_report(variant),
                    model=variant.model,
                    prompt_version=variant.prompt.version if variant.prompt else None,
                )
                session.commit()
                if not usable_variant(row):
                    print(f"{label}: identical to a version that failed review")
                    continue
            status = review(row)
            kept += status == "PASSED"
            print(f"{label}: {status} (£{spent():.2f} so far)")
            # The next variant should differ from this one too.
            seen = [*seen, [beat["narration"] for beat in variant.spec["beats"]]]
    print(f"{kept} of {total} variants passed review; £{spent():.2f} spent.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
