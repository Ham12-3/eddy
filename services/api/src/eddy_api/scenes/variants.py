"""Serving scenes and queueing Tier L requests (SPEC.md section 7.2, ADR-0030).

Items come from a fixed, verified bank, and every student who makes the same mistake on the same
item gets a scene about the same predicted answer. So a Tier L variant is stored per item and
mistake (`variant_key`) and reused for other students once it has passed its review; a student is
never shown the same variant twice.

The route never waits for Claude. It serves at once either a reviewed Tier L variant this student
has not seen, or the Tier D scene, and queues a request that the worker turns into a new variant.
One open request per student (a unique index), and the cost guards are checked before queueing
and again by the worker before it spends anything.
"""

import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from eddy_api.db.models import LlmCall, SceneInstance, SceneRequest, SceneSpec
from eddy_api.scenes.generate import Variant

Source = Literal["cache", "tier_d"]
MAX_SEEN_VERSIONS = 3


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def variant_key(template: str, misconception: str, params: Any) -> str:
    """Every variant for one item and one mistake. `template` includes its version."""
    return hashlib.sha256(canonical([template, misconception, params]).encode()).hexdigest()


def spec_hash(spec: dict[str, Any]) -> str:
    """One scene: the item and mistake, the answer it narrates, and every beat as written."""
    beats = [[b["kind"], b["focus"], b["narration"]] for b in spec["beats"]]
    key = [spec["template"], spec["misconception"], spec["params"], spec["studentAnswer"], beats]
    return hashlib.sha256(canonical(key).encode()).hexdigest()


@dataclass(frozen=True)
class Served:
    scene_spec_id: uuid.UUID
    spec: dict[str, Any]
    tier: Literal["DETERMINISTIC", "LLM"]
    source: Source


def store_spec(
    session: Session,
    spec: dict[str, Any],
    *,
    tier: Literal["DETERMINISTIC", "LLM"],
    report: dict[str, Any] | None = None,
    model: str | None = None,
    prompt_version: str | None = None,
) -> SceneSpec:
    """Stores a scene once (by hash, safe under concurrency) and returns its row.

    The row may be an older one with the same hash: callers check its tier and status.
    """
    digest = spec_hash(spec)
    key, _, version = str(spec["template"]).partition("@")
    session.execute(
        insert(SceneSpec)
        .values(
            template_key=key,
            template_version=version,
            spec=spec,
            hash=digest,
            variant_key=variant_key(spec["template"], spec["misconception"], spec["params"]),
            tier=tier,
            verification_report=report or {},
            # Tier D scenes are reviewed and checked in CI; Tier L ones wait for the worker.
            render_status="PASSED" if tier == "DETERMINISTIC" else "PENDING",
            created_by="TEMPLATE" if tier == "DETERMINISTIC" else "LLM",
            model=model,
            prompt_version=prompt_version,
            approved=False,
            check_attempts=0,
        )
        .on_conflict_do_nothing(index_elements=["hash"])
    )
    row = session.scalar(select(SceneSpec).where(SceneSpec.hash == digest))
    if row is None:  # pragma: no cover - the insert or the conflicting row guarantees one
        raise RuntimeError("scene_spec row vanished")
    return row


def usable_variant(row: SceneSpec) -> bool:
    """A stored Tier L row that has not failed review (an identical older row may have)."""
    return row.tier == "LLM" and row.render_status != "FAILED"


def seen_specs(session: Session, student_id: uuid.UUID) -> set[uuid.UUID]:
    rows = session.scalars(
        select(SceneInstance.scene_spec_id).where(SceneInstance.student_id == student_id)
    )
    return set(rows)


def seen_versions(session: Session, student_id: uuid.UUID, key: str) -> list[list[str]]:
    """The narration of the scenes this student watched for this item and mistake, latest last."""
    rows = session.execute(
        select(SceneSpec.id, SceneSpec.spec)
        .join(SceneInstance, SceneInstance.scene_spec_id == SceneSpec.id)
        .where(SceneInstance.student_id == student_id, SceneSpec.variant_key == key)
        .order_by(SceneInstance.created_at.desc())
    )
    # Each scene once, so repeated Tier D views never push a seen variant out of the list.
    versions: list[list[str]] = []
    counted: set[uuid.UUID] = set()
    for scene_id, spec in rows:
        if scene_id in counted:
            continue
        counted.add(scene_id)
        versions.append([beat["narration"] for beat in spec["beats"]])
        if len(versions) == MAX_SEEN_VERSIONS:
            break
    return list(reversed(versions))


def cached_variant(session: Session, key: str, exclude: set[uuid.UUID]) -> SceneSpec | None:
    """A Tier L variant for this item and mistake that has passed review and is not excluded."""
    query = (
        select(SceneSpec)
        .where(
            SceneSpec.variant_key == key,
            SceneSpec.tier == "LLM",
            SceneSpec.render_status == "PASSED",
        )
        .order_by(SceneSpec.created_at)
    )
    return next((row for row in session.scalars(query) if row.id not in exclude), None)


def generation_allowed(
    session: Session,
    student_id: uuid.UUID | None,
    *,
    calls_per_student: int,
    daily_budget_gbp: float,
    now: datetime | None = None,
) -> bool:
    """Whether a new Tier L scene may be generated now, within both cost guards (ADR-0030).

    Counts scene routes only, so tutor calls (M7) never switch scenes off.
    """
    since = (now or datetime.now(UTC)) - timedelta(days=1)
    scene_calls = LlmCall.route.like("scene.%")
    spent = session.scalar(
        select(func.coalesce(func.sum(LlmCall.cost_estimate_gbp), 0)).where(
            LlmCall.created_at >= since, scene_calls
        )
    )
    if float(spent or 0) >= daily_budget_gbp:
        return False
    if student_id is None:
        return True
    calls = session.scalar(
        select(func.count())
        .select_from(LlmCall)
        .where(
            LlmCall.student_id == student_id,
            LlmCall.route == "scene.generate",
            LlmCall.created_at >= since,
        )
    )
    return int(calls or 0) < calls_per_student


def record_watch(
    session: Session, student_id: uuid.UUID, attempt_id: uuid.UUID | None, scene: uuid.UUID
) -> None:
    exists = session.scalar(
        select(SceneInstance.id).where(
            SceneInstance.student_id == student_id,
            SceneInstance.scene_spec_id == scene,
            SceneInstance.attempt_id == attempt_id,
        )
    )
    if exists is None:
        session.add(
            SceneInstance(student_id=student_id, attempt_id=attempt_id, scene_spec_id=scene)
        )
        session.flush()


def serve_now(
    session: Session,
    *,
    student_id: uuid.UUID,
    attempt_id: uuid.UUID | None,
    tier_d: dict[str, Any],
) -> Served:
    """A reviewed Tier L variant this student has not seen, else the Tier D scene."""
    key = variant_key(tier_d["template"], tier_d["misconception"], tier_d["params"])
    cached = cached_variant(session, key, seen_specs(session, student_id))
    if cached is not None:
        served = Served(cached.id, cached.spec, "LLM", "cache")
    else:
        row = store_spec(session, tier_d, tier="DETERMINISTIC")
        served = Served(row.id, row.spec, "DETERMINISTIC", "tier_d")
    record_watch(session, student_id, attempt_id, served.scene_spec_id)
    return served


def open_request(session: Session, student_id: uuid.UUID) -> SceneRequest | None:
    return session.scalar(
        select(SceneRequest).where(
            SceneRequest.student_id == student_id,
            SceneRequest.status.in_(("QUEUED", "RUNNING")),
        )
    )


def enqueue_request(
    session: Session,
    *,
    student_id: uuid.UUID,
    attempt_id: uuid.UUID,
    template: str,
    key: str,
    payload: dict[str, Any],
) -> SceneRequest:
    """Queues a Tier L request, or returns the student's open one (one at a time)."""
    existing = open_request(session, student_id)
    if existing is not None:
        return existing
    row = SceneRequest(
        student_id=student_id,
        attempt_id=attempt_id,
        template_key=template,
        variant_key=key,
        request=payload,
        status="QUEUED",
        report={},
    )
    try:
        with session.begin_nested():
            session.add(row)
    except IntegrityError:
        # Another request from the same student won the race for the unique index.
        existing = open_request(session, student_id)
        if existing is None:  # pragma: no cover - the unique index guarantees one
            raise
        return existing
    return row


def variant_report(variant: Variant) -> dict[str, Any]:
    return {
        "attempts": [
            {
                "number": a.number,
                "problems": a.problems,
                "cost_gbp": a.cost_gbp,
                "latency_ms": a.latency_ms,
            }
            for a in variant.attempts
        ],
        "latency_ms": variant.latency_ms,
        "cost_gbp": variant.cost_gbp,
    }
