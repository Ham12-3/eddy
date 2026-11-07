"""Scenes for an attempt (SPEC.md section 7.2, ADR-0030).

`POST /v1/scenes/variants` answers at once with a scene to show: a reviewed Tier L variant this
student has not seen, or the Tier D scene. When that is Tier D and Claude scenes are on, it also
queues a request for a new Tier L variant ("Building another way to see it"), which the worker
generates; `GET /v1/scenes/requests/{id}` returns it when it is ready. The route never waits for
Claude.

Everything comes from the database: the item's parameters and verified answer from the bank, and
the detected misconception from the attempt. The student's answer must equal the answer that
misconception predicts (maths-core checks), and only that predicted answer goes into scenes and
prompts, so a student's own input never reaches Claude or another student. A student can only
ask about their own attempts and requests.
"""

import json
import uuid
from dataclasses import dataclass
from functools import lru_cache
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from eddy_api.auth import Caller, require_roles
from eddy_api.config import Settings, get_settings, tier_l_enabled
from eddy_api.db.models import Attempt, Item, Misconception, SceneRequest, SceneSpec
from eddy_api.db.session import get_session
from eddy_api.scenes.generate import Confidence
from eddy_api.scenes.services import MathsCoreClient, SceneCheckClient, SceneServiceError
from eddy_api.scenes.spec import SceneSpec as SceneSpecModel
from eddy_api.scenes.variants import (
    enqueue_request,
    generation_allowed,
    record_watch,
    seen_versions,
    serve_now,
    variant_key,
)

router = APIRouter(prefix="/v1/scenes", tags=["scenes"])
DbSession = Annotated[Session, Depends(get_session)]
student_or_system = require_roles("student", "system")
StudentOrSystem = Annotated[Caller, Depends(student_or_system)]
CONFIDENCE: dict[int, Confidence] = {1: "low", 2: "low", 3: "medium", 4: "high"}
STATES: dict[str, Literal["queued", "running", "done", "failed"]] = {
    "QUEUED": "queued",
    "RUNNING": "running",
    "DONE": "done",
    "FAILED": "failed",
}


@dataclass(frozen=True)
class SceneServices:
    scene_check: SceneCheckClient
    maths_core: MathsCoreClient


@lru_cache
def get_scene_services() -> SceneServices:
    settings = get_settings()
    return SceneServices(
        scene_check=SceneCheckClient.from_settings(settings),
        maths_core=MathsCoreClient.from_settings(settings),
    )


Services = Annotated[SceneServices, Depends(get_scene_services)]


class VariantIn(BaseModel):
    attempt_id: uuid.UUID
    reason: Literal["another_way", "recurred"]


class SceneOut(BaseModel):
    scene_spec_id: uuid.UUID
    tier: Literal["DETERMINISTIC", "LLM"]
    spec: SceneSpecModel


class VariantOut(SceneOut):
    source: Literal["cache", "tier_d"]
    #: Set when a new Tier L variant is being made: poll GET /v1/scenes/requests/{id}.
    request_id: uuid.UUID | None


class RequestOut(BaseModel):
    request_id: uuid.UUID
    status: Literal["queued", "running", "done", "failed"]
    scene: SceneOut | None


def _unexplainable(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail)


def _owned(caller: Caller, student_id: uuid.UUID) -> bool:
    return caller.role == "system" or str(student_id) == caller.subject


@router.post("/variants", operation_id="getSceneVariant")
def scene_variant(
    body: VariantIn,
    caller: StudentOrSystem,
    session: DbSession,
    services: Services,
    settings: Annotated[Settings, Depends(get_settings)],
) -> VariantOut:
    attempt = session.get(Attempt, body.attempt_id)
    # Someone else's attempt looks the same as a missing one.
    if attempt is None or not _owned(caller, attempt.student_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No such attempt.")
    if attempt.correct or attempt.detected_misconception_id is None:
        raise _unexplainable("This attempt has no detected misconception to explain.")
    misconception = session.get(Misconception, attempt.detected_misconception_id)
    item = session.get(Item, attempt.item_id)
    if misconception is None or not misconception.remediation_template or item is None:
        raise _unexplainable("There is no scene for this misconception yet.")
    try:
        answer = json.loads(item.answer_canonical)
    except json.JSONDecodeError:
        raise _unexplainable("This item's answer is not stored as MathJSON.") from None

    template = misconception.remediation_template
    try:
        context = services.scene_check.context(template, item.params, attempt.response_mathjson)
        if context["misconception"] != misconception.code:
            raise _unexplainable("There is no scene for this misconception yet.")
        predicted = context["predicted"]
        if not services.maths_core.equivalent(attempt.response_mathjson, predicted):
            raise _unexplainable(
                "This answer is not the one this misconception usually gives, so there is no "
                "scene for it yet."
            )
        # Scenes narrate the predicted answer, never the student's own input.
        tier_d = services.scene_check.context(template, item.params, predicted)["tierD"]
    except SceneServiceError as error:
        # 404: no such template; 400, 413 and 422: parameters or an answer it cannot take.
        if error.status in (400, 404, 413, 422):
            raise _unexplainable("There is no scene for this misconception yet.") from None
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, detail="Scenes are unavailable just now."
        ) from None

    served = serve_now(session, student_id=attempt.student_id, attempt_id=attempt.id, tier_d=tier_d)
    request_id = None
    allowed = tier_l_enabled(settings) and generation_allowed(
        session,
        attempt.student_id,
        calls_per_student=settings.tier_l_calls_per_student_per_day,
        daily_budget_gbp=settings.tier_l_daily_budget_gbp,
    )
    if served.source == "tier_d" and allowed:
        key = variant_key(tier_d["template"], tier_d["misconception"], tier_d["params"])
        payload = {
            "item": item.params,
            "student_answer": predicted,
            "answer": answer,
            "reason": body.reason,
            "confidence": CONFIDENCE.get(attempt.confidence_self_report or 0),
            "seen": seen_versions(session, attempt.student_id, key),
        }
        queued = enqueue_request(
            session,
            student_id=attempt.student_id,
            attempt_id=attempt.id,
            template=template,
            key=key,
            payload=payload,
        )
        # The student's open request may be for another attempt: never hand that one back here.
        request_id = queued.id if queued.attempt_id == attempt.id else None
    session.commit()
    return VariantOut(
        scene_spec_id=served.scene_spec_id,
        tier=served.tier,
        spec=SceneSpecModel.model_validate(served.spec),
        source=served.source,
        request_id=request_id,
    )


@router.get("/requests/{request_id}", operation_id="getSceneRequest")
def scene_request(request_id: uuid.UUID, caller: StudentOrSystem, session: DbSession) -> RequestOut:
    row = session.get(SceneRequest, request_id)
    if row is None or not _owned(caller, row.student_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No such request.")
    scene = None
    state = STATES[row.status]
    if row.status == "DONE" and row.scene_spec_id is not None:
        spec = session.get(SceneSpec, row.scene_spec_id)
        if spec is None or spec.render_status == "FAILED":
            # The background review failed it after it was made: it is not shown any more.
            state = "failed"
        else:
            record_watch(session, row.student_id, row.attempt_id, spec.id)
            session.commit()
            scene = SceneOut(
                scene_spec_id=spec.id, tier="LLM", spec=SceneSpecModel.model_validate(spec.spec)
            )
    return RequestOut(request_id=row.id, status=state, scene=scene)
