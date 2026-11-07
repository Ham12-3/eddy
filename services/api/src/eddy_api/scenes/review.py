"""Background work for Tier L scenes (SPEC.md section 7.2, ADR-0007, ADR-0030), run by the worker.

**Requests.** A student who asks for another way (or whose mistake recurs) gets Tier D at once and
a `scene_request`. The worker generates the variant with every hot path check, stores it as
PENDING and marks the request DONE, so the student's app can fetch it; other students only get it
once it has passed review.

**Review.** The worker draws every beat at every width in both themes (scene-check), confirms the
DOM boxes match the layout, and asks Claude to critique the light keyframes at a laptop and a
phone width against a checklist, with the item's facts beside them. A pass marks the scene PASSED;
a failure marks it FAILED, which keeps it out of the cache, and generates a replacement with the
reasons as feedback, at most three generations in all.

Both queues are tables, claimed with FOR UPDATE SKIP LOCKED and a ten-minute lease. A transient
error (a service down, Claude unavailable) keeps the claim, so the job is retried only after the
lease: a natural back-off. A job that errors three times is failed. Before writing an outcome the
worker checks the claim is still its own, so a job reclaimed after its lease is never written twice.
"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from eddy_api.db.models import SceneRequest, SceneSpec
from eddy_api.llm.client import LlmClient, LlmError, LlmUnavailableError
from eddy_api.llm.prompts import load_prompt
from eddy_api.scenes.generate import Variant, VariantRequest, data, misconception_notes
from eddy_api.scenes.services import SceneCheckClient, SceneServiceError
from eddy_api.scenes.variants import seen_specs, store_spec, usable_variant, variant_report

LEASE = timedelta(minutes=10)
MAX_CHECKS = 3
MAX_GENERATIONS = 3
MAX_REQUEST_TRIES = 3
#: A request still queued after this is no use to the student who asked: it expires.
REQUEST_EXPIRY = timedelta(hours=1)
#: Errors worth trying again after the lease; anything else is final.
TRANSIENT = (LlmUnavailableError, SceneServiceError)

Regenerate = Callable[[VariantRequest], Variant]


def now_utc() -> datetime:
    return datetime.now(UTC)


def critique_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "passes": {"type": "boolean"},
            "issues": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "beat": {"type": "integer"},
                        "problem": {"type": "string"},
                    },
                    "required": ["beat", "problem"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["passes", "issues"],
        "additionalProperties": False,
    }


def critique_content(spec: dict[str, Any], images: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The item's facts, then per beat its narration and its laptop and phone keyframes."""
    notes = misconception_notes().get(spec["misconception"], {})
    facts = {
        "misconception": spec["misconception"],
        "misconception_description": notes.get("teacher", ""),
        "item_parameters": spec["params"],
        "student_answer_mathjson": spec["studentAnswer"],
        "correct_answer_mathjson": spec["correctAnswer"],
    }
    content: list[dict[str, Any]] = [
        {"type": "text", "text": f"<scene_facts>{data(facts)}</scene_facts>"}
    ]
    for index, beat in enumerate(spec["beats"]):
        content.append(
            {
                "type": "text",
                "text": f'<beat number="{index + 1}" kind={data(beat["kind"])}>'
                f"<narration>{data(beat['narration'])}</narration></beat>",
            }
        )
        for format_ in ("desktop", "mobile"):
            for image in images:
                if image["beat"] == index and image["format"] == format_:
                    content.append(
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/png",
                                "data": image["png"],
                            },
                        }
                    )
    content.append({"type": "text", "text": "Review this scene against the checklist."})
    return content


@dataclass
class Review:
    passed: bool
    problems: list[str] = field(default_factory=list)
    cost_gbp: float = 0.0


def review_scene(
    spec: dict[str, Any],
    template: str,
    *,
    scene_check: SceneCheckClient,
    llm: LlmClient,
    student_id: uuid.UUID | None = None,
) -> Review:
    keyframes = scene_check.keyframes(template, spec)
    if keyframes["problems"]:
        # The DOM disagrees with the layout: no need to pay for a critique.
        return Review(passed=False, problems=[f"Keyframes: {p}" for p in keyframes["problems"]])
    result = llm.structured(
        prompt=load_prompt("scene-critique"),
        context=[],
        messages=[{"role": "user", "content": critique_content(spec, keyframes["images"])}],
        schema=critique_schema(),
        student_id=student_id,
    )
    issues = [f"Beat {i['beat']}: {i['problem']}" for i in result.data.get("issues", [])]
    # The prompt lists only problems that should fail the scene.
    passed = bool(result.data.get("passes")) and not issues
    return Review(passed=passed, problems=issues, cost_gbp=result.record.cost_gbp)


def _append(report: dict[str, Any], key: str, value: Any) -> dict[str, Any]:
    return {**report, key: [*report.get(key, []), value]}


def claim_next(session: Session, now: datetime | None = None) -> SceneSpec | None:
    """Claims the oldest PENDING Tier L scene whose lease is free; commits the claim."""
    now = now or now_utc()
    while True:
        row = session.scalar(
            select(SceneSpec)
            .where(
                SceneSpec.tier == "LLM",
                SceneSpec.render_status == "PENDING",
                or_(SceneSpec.check_claimed_at.is_(None), SceneSpec.check_claimed_at < now - LEASE),
            )
            .order_by(SceneSpec.created_at)
            .limit(1)
            .with_for_update(skip_locked=True)
        )
        if row is None:
            return None
        if row.check_attempts >= MAX_CHECKS:
            row.render_status = "FAILED"
            row.verification_report = {
                **row.verification_report,
                "review": {"passed": False, "problems": ["The review kept failing to run."]},
            }
            session.commit()
            continue
        row.check_claimed_at = now
        row.check_attempts += 1
        session.commit()
        return row


def _scene_still_ours(session: Session, row: SceneSpec, claimed_at: datetime | None) -> bool:
    session.refresh(row, with_for_update=True)
    return row.check_claimed_at == claimed_at and row.render_status == "PENDING"


def _requested_by(row: SceneSpec) -> uuid.UUID | None:
    """The student whose request made this scene, so its review chain counts against them."""
    raw = row.verification_report.get("requested_by")
    return uuid.UUID(raw) if raw else None


def regenerate_after(
    session: Session, row: SceneSpec, problems: list[str], generator: Regenerate
) -> SceneSpec | None:
    """A replacement for a scene that failed review, with the reasons as feedback."""
    generation = int(row.verification_report.get("generation", 1))
    if generation >= MAX_GENERATIONS:
        return None
    spec = row.spec
    request = VariantRequest(
        template=row.template_key,
        item=spec["params"],
        student_answer=spec["studentAnswer"],
        answer=spec["correctAnswer"],
        reason="precompute",
        seen=[[beat["narration"] for beat in spec["beats"]]],
        feedback=problems,
        student_id=_requested_by(row),
    )
    try:
        variant = generator(request)
    except (LlmError, SceneServiceError):
        return None
    if not variant.passed or variant.spec is None:
        return None
    report = {**variant_report(variant), "generation": generation + 1, "replaces": str(row.id)}
    if "requested_by" in row.verification_report:
        report["requested_by"] = row.verification_report["requested_by"]
    stored = store_spec(
        session,
        variant.spec,
        tier="LLM",
        report=report,
        model=variant.model,
        prompt_version=variant.prompt.version if variant.prompt else None,
    )
    return stored if usable_variant(stored) and stored.id != row.id else None


def process(
    session: Session,
    row: SceneSpec,
    *,
    scene_check: SceneCheckClient,
    llm: LlmClient,
    generator: Regenerate,
) -> uuid.UUID | None:
    """Reviews one claimed scene. Returns the id of a replacement, if one was made."""
    claimed_at = row.check_claimed_at
    try:
        review = review_scene(
            row.spec,
            row.template_key,
            scene_check=scene_check,
            llm=llm,
            student_id=_requested_by(row),
        )
    except TRANSIENT as error:
        # Keep the claim: the review is tried again after the lease, up to MAX_CHECKS times.
        if _scene_still_ours(session, row, claimed_at):
            row.verification_report = _append(
                row.verification_report, "review_errors", type(error).__name__
            )
        session.commit()
        return None
    except LlmError as error:
        # A refusal or a request the API will never accept: it cannot pass, so it is failed.
        review = Review(passed=False, problems=[f"The critique could not run: {error}"])
    if not _scene_still_ours(session, row, claimed_at):
        session.rollback()
        return None
    outcome = {"passed": review.passed, "problems": review.problems, "cost_gbp": review.cost_gbp}
    row.verification_report = {**row.verification_report, "review": outcome}
    row.render_status = "PASSED" if review.passed else "FAILED"
    # The verdict is saved, and the row lock released, before any regeneration is paid for.
    session.commit()
    if review.passed:
        return None
    replacement = regenerate_after(session, row, review.problems, generator)
    session.commit()
    return replacement.id if replacement else None


def claim_request(session: Session, now: datetime | None = None) -> SceneRequest | None:
    """Claims the oldest queued request (or a running one whose lease has run out)."""
    now = now or now_utc()
    while True:
        row = session.scalar(
            select(SceneRequest)
            .where(
                or_(
                    SceneRequest.status == "QUEUED",
                    (SceneRequest.status == "RUNNING") & (SceneRequest.claimed_at < now - LEASE),
                )
            )
            .order_by(SceneRequest.created_at)
            .limit(1)
            .with_for_update(skip_locked=True)
        )
        if row is None:
            return None
        if row.attempts >= MAX_REQUEST_TRIES:
            finish_request(session, row, "FAILED", "Generation kept failing to run.", now)
            session.commit()
            continue
        if row.created_at < now - REQUEST_EXPIRY:
            finish_request(session, row, "FAILED", "Expired before it could be made.", now)
            session.commit()
            continue
        row.status = "RUNNING"
        row.claimed_at = now
        row.attempts += 1
        session.commit()
        return row


def finish_request(
    session: Session, row: SceneRequest, status: str, note: str, now: datetime | None = None
) -> None:
    row.status = status
    row.finished_at = now or now_utc()
    row.report = _append(row.report, "notes", note)


def request_from_row(row: SceneRequest) -> VariantRequest:
    payload = row.request
    return VariantRequest(
        template=row.template_key,
        item=payload["item"],
        student_answer=payload["student_answer"],
        answer=payload["answer"],
        reason=payload["reason"],
        confidence=payload.get("confidence"),
        seen=payload.get("seen", []),
        student_id=row.student_id,
    )


def run_request(session: Session, row: SceneRequest, *, generator: Regenerate) -> None:
    """Generates one claimed request and records the outcome."""
    claimed_at = row.claimed_at
    try:
        variant = generator(request_from_row(row))
    except TRANSIENT as error:
        # Keep the claim: tried again after the lease, up to MAX_REQUEST_TRIES times.
        session.refresh(row, with_for_update=True)
        if row.claimed_at == claimed_at:
            row.report = _append(row.report, "errors", type(error).__name__)
        session.commit()
        return
    except LlmError as error:
        session.refresh(row, with_for_update=True)
        if row.claimed_at == claimed_at:
            finish_request(session, row, "FAILED", f"Generation could not run: {error}")
        session.commit()
        return
    session.refresh(row, with_for_update=True)
    if row.claimed_at != claimed_at or row.status != "RUNNING":
        session.rollback()
        return
    row.report = {**row.report, "generation": variant_report(variant)}
    if not variant.passed or variant.spec is None:
        finish_request(session, row, "FAILED", "No version passed every check.")
    else:
        report = {**variant_report(variant), "requested_by": str(row.student_id)}
        stored = store_spec(
            session,
            variant.spec,
            tier="LLM",
            report=report,
            model=variant.model,
            prompt_version=variant.prompt.version if variant.prompt else None,
        )
        if not usable_variant(stored):
            finish_request(session, row, "FAILED", "Identical to a version that failed review.")
        elif stored.id in seen_specs(session, row.student_id):
            finish_request(session, row, "FAILED", "Identical to a version already seen.")
        else:
            row.scene_spec_id = stored.id
            finish_request(session, row, "DONE", "Generated.")
    session.commit()
