"""Serving scenes, Tier L requests and the background review, over a seeded throwaway database.
Fakes stand in for Claude and the scene engine; the scenes are real ones from the golden set."""

import base64
import copy
import json
import time
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from eddy_api.config import Settings, get_settings
from eddy_api.db.models import (
    Attempt,
    CurriculumNode,
    Item,
    LlmCall,
    Misconception,
    SceneInstance,
    SceneRequest,
    SceneSpec,
    User,
)
from eddy_api.db.session import get_session
from eddy_api.llm.client import LlmClient, LlmUnavailableError
from eddy_api.main import create_app
from eddy_api.routes.scenes import SceneServices, get_scene_services
from eddy_api.scenes.generate import Attempt as GenerationAttempt
from eddy_api.scenes.generate import Variant, VariantRequest
from eddy_api.scenes.review import (
    LEASE,
    MAX_CHECKS,
    MAX_REQUEST_TRIES,
    claim_next,
    claim_request,
    process,
    run_request,
)
from eddy_api.scenes.services import MathsCoreClient, SceneCheckClient
from eddy_api.scenes.variants import (
    enqueue_request,
    generation_allowed,
    serve_now,
    spec_hash,
    store_spec,
    variant_key,
)
from eddy_api.seed.curriculum import load
from eddy_api.seed.upsert import seed

ROOT = Path(__file__).resolve().parents[3]
TEMPLATE = "number_line.compare_negatives"
RECORD = next(
    r
    for r in map(json.loads, (ROOT / "evals/golden/scenes/specs.jsonl").read_bytes().splitlines())
    if r["template"] == TEMPLATE
)
TIER_D: dict[str, Any] = RECORD["spec"]
KEY = variant_key(TIER_D["template"], TIER_D["misconception"], TIER_D["params"])


def reworded(tag: str) -> dict[str, Any]:
    new = copy.deepcopy(TIER_D)
    new["beats"][-1]["narration"] = f"{new['beats'][-1]['narration']} ({tag})"
    return new


class Generator:
    def __init__(self, fail: Exception | None = None, passes: bool = True) -> None:
        self.calls: list[VariantRequest] = []
        self.fail = fail
        self.passes = passes

    def __call__(self, request: VariantRequest) -> Variant:
        self.calls.append(request)
        if self.fail:
            raise self.fail
        spec = reworded(f"version {len(self.calls)} {uuid.uuid4().hex[:6]}")
        return Variant(
            passed=self.passes,
            spec=spec if self.passes else None,
            beats=spec["beats"],
            attempts=[GenerationAttempt(1, [], 0.05, 4000)],
            model="claude-test",
        )


def student(session: Session) -> uuid.UUID:
    user = User(email=f"{uuid.uuid4().hex}@example.test", role="student")
    session.add(user)
    session.flush()
    return user.id


def passed_variant(session: Session, tag: str) -> SceneSpec:
    row = store_spec(session, reworded(tag), tier="LLM", model="claude-test")
    row.render_status = "PASSED"
    session.flush()
    return row


def test_tier_d_until_a_reviewed_variant_exists(db_session: Session) -> None:
    learner = student(db_session)
    served = serve_now(db_session, student_id=learner, attempt_id=None, tier_d=TIER_D)
    assert (served.source, served.tier) == ("tier_d", "DETERMINISTIC")
    row = db_session.get(SceneSpec, served.scene_spec_id)
    assert row is not None
    assert (row.render_status, row.created_by) == ("PASSED", "TEMPLATE")
    # An unreviewed (PENDING) variant is never served to another student.
    store_spec(db_session, reworded("unreviewed"), tier="LLM")
    again = serve_now(db_session, student_id=student(db_session), attempt_id=None, tier_d=TIER_D)
    assert (again.source, again.scene_spec_id) == ("tier_d", served.scene_spec_id)


def test_a_reviewed_variant_is_shared_but_never_repeated(db_session: Session) -> None:
    first, second = student(db_session), student(db_session)
    variant = passed_variant(db_session, "reviewed")
    served = serve_now(db_session, student_id=first, attempt_id=None, tier_d=TIER_D)
    assert (served.source, served.scene_spec_id) == ("cache", variant.id)
    assert serve_now(db_session, student_id=second, attempt_id=None, tier_d=TIER_D).source == (
        "cache"
    )
    again = serve_now(db_session, student_id=first, attempt_id=None, tier_d=TIER_D)
    assert again.source == "tier_d"
    assert db_session.scalar(select(func.count()).select_from(SceneInstance)) == 3


def test_the_scene_hash_includes_the_answer_it_narrates() -> None:
    other = copy.deepcopy(TIER_D)
    other["studentAnswer"] = 12345
    assert spec_hash(other) != spec_hash(TIER_D)


def request_payload() -> dict[str, Any]:
    return {
        "item": TIER_D["params"],
        "student_answer": TIER_D["studentAnswer"],
        "answer": RECORD["answer"],
        "reason": "another_way",
        "confidence": "high",
        "seen": [[b["narration"] for b in TIER_D["beats"]]],
    }


def queued(session: Session, learner: uuid.UUID) -> SceneRequest:
    return enqueue_request(
        session,
        student_id=learner,
        attempt_id=attempt(session, learner).id,
        template=TEMPLATE,
        key=KEY,
        payload=request_payload(),
    )


def test_one_open_request_per_student(seeded: Session) -> None:
    learner = student(seeded)
    first = queued(seeded, learner)
    second = queued(seeded, learner)
    assert first.id == second.id
    assert seeded.scalar(select(func.count()).select_from(SceneRequest)) == 1


def test_the_worker_generates_a_request(seeded: Session) -> None:
    learner = student(seeded)
    request = queued(seeded, learner)
    claimed = claim_request(seeded)
    assert claimed is not None
    assert claimed.id == request.id
    assert claim_request(seeded) is None  # leased
    generate = Generator()
    run_request(seeded, claimed, generator=generate)
    assert claimed.status == "DONE"
    assert generate.calls[0].seen == request_payload()["seen"]
    assert generate.calls[0].student_id == learner
    row = seeded.get(SceneSpec, claimed.scene_spec_id)
    assert row is not None
    assert (row.tier, row.render_status) == ("LLM", "PENDING")


def test_a_request_that_never_passes_fails(seeded: Session) -> None:
    claimed = claim_request(seeded) or queued(seeded, student(seeded))
    claimed = claim_request(seeded) or claimed
    run_request(seeded, claimed, generator=Generator(passes=False))
    assert claimed.status == "FAILED"
    assert claimed.scene_spec_id is None


def test_transient_failures_back_off_then_give_up(seeded: Session) -> None:
    queued(seeded, student(seeded))
    now = datetime.now(UTC)
    for tries in range(MAX_REQUEST_TRIES):
        claimed = claim_request(seeded, now + tries * (LEASE + timedelta(seconds=1)))
        assert claimed is not None
        run_request(seeded, claimed, generator=Generator(fail=LlmUnavailableError("busy")))
        assert claimed.status == "RUNNING"  # kept, so it waits out the lease
    assert claim_request(seeded, now + MAX_REQUEST_TRIES * (LEASE + timedelta(seconds=1))) is None
    row = seeded.scalar(select(SceneRequest))
    assert row is not None
    assert row.status == "FAILED"


def test_the_review_queue_leases_and_gives_up(db_session: Session) -> None:
    row = store_spec(db_session, reworded("queued"), tier="LLM")
    now = datetime.now(UTC)
    assert claim_next(db_session, now) is row
    assert claim_next(db_session, now) is None
    assert claim_next(db_session, now + LEASE + timedelta(seconds=1)) is row
    row.check_attempts = MAX_CHECKS
    row.check_claimed_at = None
    db_session.flush()
    assert claim_next(db_session, now) is None
    assert row.render_status == "FAILED"


class FakeKeyframes:
    def __init__(self, problems: list[str] | None = None, down: bool = False) -> None:
        self.problems = problems or []
        self.down = down

    def keyframes(self, template: str, spec: dict[str, Any]) -> dict[str, Any]:
        if self.down:
            from eddy_api.scenes.services import SceneServiceError

            raise SceneServiceError("down")
        png = base64.b64encode(b"png").decode()
        images = [{"format": f, "width": 1, "beat": 0, "png": png} for f in ("desktop", "mobile")]
        return {"problems": self.problems, "images": images}


class FakeSdk:
    def __init__(self, verdict: dict[str, Any]) -> None:
        self.verdict = verdict
        self.calls: list[dict[str, Any]] = []
        self.messages = self

    def create(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        usage = SimpleNamespace(
            input_tokens=10,
            output_tokens=10,
            cache_read_input_tokens=0,
            cache_creation_input_tokens=0,
        )
        text = json.dumps(self.verdict)
        return SimpleNamespace(
            stop_reason="end_turn", content=[SimpleNamespace(type="text", text=text)], usage=usage
        )


def review(
    session: Session,
    row: SceneSpec,
    verdict: dict[str, Any],
    keyframes: FakeKeyframes | None = None,
) -> tuple[uuid.UUID | None, FakeSdk, Generator]:
    sdk = FakeSdk(verdict)
    generate = Generator()
    claimed = claim_next(session)
    assert claimed is row
    replacement = process(
        session,
        row,
        scene_check=cast(SceneCheckClient, keyframes or FakeKeyframes()),
        llm=LlmClient(sdk),  # type: ignore[arg-type]
        generator=generate,
    )
    return replacement, sdk, generate


def test_a_scene_that_passes_review(db_session: Session) -> None:
    row = store_spec(db_session, reworded("good"), tier="LLM")
    replacement, sdk, _ = review(db_session, row, {"passes": True, "issues": []})
    assert row.render_status == "PASSED"
    assert replacement is None
    content = sdk.calls[0]["messages"][0]["content"]
    assert content[0]["text"].startswith("<scene_facts>")
    assert [block["type"] for block in content[1:4]] == ["text", "image", "image"]


def test_a_failed_review_evicts_and_regenerates_with_feedback(db_session: Session) -> None:
    row = store_spec(db_session, reworded("muddled"), tier="LLM")
    verdict = {"passes": False, "issues": [{"beat": 3, "problem": "The line is not mentioned."}]}
    replacement, _, generate = review(db_session, row, verdict)
    assert row.render_status == "FAILED"
    [sent] = generate.calls
    assert sent.feedback == ["Beat 3: The line is not mentioned."]
    assert sent.seen == [[b["narration"] for b in row.spec["beats"]]]
    new = db_session.get(SceneSpec, replacement)
    assert new is not None
    assert (new.verification_report["generation"], new.render_status) == (2, "PENDING")


def test_keyframe_problems_fail_without_a_critique(db_session: Session) -> None:
    row = store_spec(db_session, reworded("spills"), tier="LLM")
    _, sdk, _ = review(db_session, row, {"passes": True, "issues": []}, FakeKeyframes(["spill"]))
    assert row.render_status == "FAILED"
    assert sdk.calls == []


def test_a_service_outage_keeps_the_claim(db_session: Session) -> None:
    row = store_spec(db_session, reworded("outage"), tier="LLM")
    review(db_session, row, {"passes": True, "issues": []}, FakeKeyframes(down=True))
    assert row.render_status == "PENDING"
    assert row.check_claimed_at is not None  # waits out the lease before trying again
    assert claim_next(db_session) is None


def test_a_reclaimed_scene_is_not_written_twice(db_session: Session) -> None:
    row = store_spec(db_session, reworded("slow"), tier="LLM")
    assert claim_next(db_session) is row

    class Reclaimed(FakeKeyframes):
        def keyframes(self, template: str, spec: dict[str, Any]) -> dict[str, Any]:
            # While this review runs, its lease expires and another worker claims the scene.
            db_session.execute(
                update(SceneSpec)
                .where(SceneSpec.id == row.id)
                .values(check_claimed_at=datetime.now(UTC) + timedelta(minutes=1))
            )
            return super().keyframes(template, spec)

    process(
        db_session,
        row,
        scene_check=cast(SceneCheckClient, Reclaimed()),
        llm=LlmClient(FakeSdk({"passes": True, "issues": []})),  # type: ignore[arg-type]
        generator=Generator(),
    )
    assert db_session.scalar(select(SceneSpec.render_status).where(SceneSpec.id == row.id)) == (
        "PENDING"
    )


def call(
    session: Session, cost: float, who: uuid.UUID | None, route: str = "scene.generate"
) -> None:
    session.add(
        LlmCall(
            route=route,
            model="claude-test",
            prompt_id="scene-spec",
            prompt_version="1.0.0",
            input_tokens=1,
            output_tokens=1,
            latency_ms=1,
            cost_estimate_gbp=cost,
            student_id=who,
        )
    )
    session.flush()


def test_cost_guards(db_session: Session) -> None:
    learner, other = student(db_session), student(db_session)

    def allowed(who: uuid.UUID) -> bool:
        return generation_allowed(db_session, who, calls_per_student=2, daily_budget_gbp=1.0)

    assert allowed(learner)
    call(db_session, 0.1, learner)
    call(db_session, 0.1, learner)
    assert not allowed(learner)  # two calls today
    assert allowed(other)
    call(db_session, 5.0, None, route="tutor.turn")  # other routes do not count
    assert allowed(other)
    call(db_session, 0.9, None, route="scene.critique")
    assert not allowed(other)


# The routes: attempts in the database, roles from the service token.

_KEY = ec.generate_private_key(ec.SECP256R1())
_PUBLIC_B64 = base64.b64encode(
    _KEY.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
).decode()


def token(subject: str, role: str) -> dict[str, str]:
    now = int(time.time())
    claims = {
        "iss": "eddy-web",
        "aud": "eddy-api",
        "sub": subject,
        "role": role,
        "iat": now,
        "exp": now + 60,
    }
    return {"Authorization": f"Bearer {jwt.encode(claims, _KEY, algorithm='ES256')}"}


class FakeSceneCheck:
    def __init__(self, misconception: str = "NEG_ORDER_BY_DIGIT") -> None:
        self.misconception = misconception
        self.answers: list[Any] = []

    def context(self, template: str, item: dict[str, Any], answer: Any) -> dict[str, Any]:
        self.answers.append(answer)
        return {
            "misconception": self.misconception,
            "predicted": TIER_D["studentAnswer"],
            "tierD": {**TIER_D, "studentAnswer": answer},
        }


class FakeMathsCore:
    def equivalent(self, left: Any, right: Any) -> bool:
        return bool(left == right)


@pytest.fixture
def seeded(db_session: Session) -> Session:
    seed(db_session, load(ROOT / "curriculum"))
    return db_session


@pytest.fixture
def api(seeded: Session) -> Iterator[tuple[TestClient, Session, FakeSceneCheck]]:
    scene_check = FakeSceneCheck()
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(
        service_token_public_key_b64=_PUBLIC_B64,
        anthropic_api_key=SecretStr("sk-test"),
    )
    app.dependency_overrides[get_session] = lambda: seeded
    app.dependency_overrides[get_scene_services] = lambda: SceneServices(
        scene_check=cast(SceneCheckClient, scene_check),
        maths_core=cast(MathsCoreClient, FakeMathsCore()),
    )
    with TestClient(app) as client:
        yield client, seeded, scene_check


def attempt(
    session: Session, learner: uuid.UUID, *, correct: bool = False, answer: Any = None
) -> Attempt:
    node = session.scalar(select(CurriculumNode).where(CurriculumNode.code == "N1"))
    misconception = session.scalar(
        select(Misconception).where(Misconception.code == "NEG_ORDER_BY_DIGIT")
    )
    assert node is not None
    assert misconception is not None
    item = Item(
        node_id=node.id,
        template_id="n1-order-negatives",
        params=TIER_D["params"],
        stem_markdown="Which is smaller?",
        answer_canonical=json.dumps(RECORD["answer"]),
        answer_format={},
        calculator_allowed=False,
        command_word="WORK_OUT",
        marks=1,
        provenance="TEMPLATE",
    )
    session.add(item)
    session.flush()
    row = Attempt(
        student_id=learner,
        item_id=item.id,
        response_raw="",
        response_mathjson=TIER_D["studentAnswer"] if answer is None else answer,
        correct=correct,
        detected_misconception_id=None if correct else misconception.id,
        confidence_self_report=4,
        time_ms=1000,
    )
    session.add(row)
    session.flush()
    return row


def test_the_route_serves_tier_d_now_and_queues_a_request(
    api: tuple[TestClient, Session, FakeSceneCheck],
) -> None:
    client, session, scene_check = api
    learner = student(session)
    mine = attempt(session, learner)
    body = {"attempt_id": str(mine.id), "reason": "another_way"}
    response = client.post("/v1/scenes/variants", json=body, headers=token(str(learner), "student"))
    assert response.status_code == 200, response.text
    data = response.json()
    assert (data["source"], data["tier"]) == ("tier_d", "DETERMINISTIC")
    assert data["request_id"]
    # The scene narrates the predicted answer, never the raw input.
    assert scene_check.answers[-1] == TIER_D["studentAnswer"]
    queued_row = session.get(SceneRequest, uuid.UUID(data["request_id"]))
    assert queued_row is not None
    assert queued_row.request["confidence"] == "high"
    assert queued_row.request["seen"] == [[b["narration"] for b in TIER_D["beats"]]]

    # The worker makes it; the student fetches it.
    claimed = claim_request(session)
    assert claimed is not None
    run_request(session, claimed, generator=Generator())
    ready = client.get(
        f"/v1/scenes/requests/{data['request_id']}", headers=token(str(learner), "student")
    )
    assert ready.json()["status"] == "done"
    assert ready.json()["scene"]["tier"] == "LLM"


def test_the_route_refuses_what_it_cannot_explain(
    api: tuple[TestClient, Session, FakeSceneCheck],
) -> None:
    client, session, scene_check = api
    owner, other = student(session), student(session)
    theirs = attempt(session, owner)
    body = {"attempt_id": str(theirs.id), "reason": "another_way"}
    post = client.post
    assert (
        post("/v1/scenes/variants", json=body, headers=token(str(other), "student")).status_code
        == 404
    )
    assert post("/v1/scenes/variants", json=body, headers=token("p", "parent")).status_code == 403
    right = attempt(session, owner, correct=True)
    body = {"attempt_id": str(right.id), "reason": "another_way"}
    assert (
        post("/v1/scenes/variants", json=body, headers=token(str(owner), "student")).status_code
        == 422
    )
    # An answer the misconception does not predict gets no scene that would misdescribe it.
    odd = attempt(session, owner, answer=999)
    body = {"attempt_id": str(odd.id), "reason": "another_way"}
    assert (
        post("/v1/scenes/variants", json=body, headers=token(str(owner), "student")).status_code
        == 422
    )
    # A template that explains a different misconception is not used.
    scene_check.misconception = "DEC_LONGER_IS_BIGGER"
    mine = attempt(session, owner)
    body = {"attempt_id": str(mine.id), "reason": "another_way"}
    assert (
        post("/v1/scenes/variants", json=body, headers=token(str(owner), "student")).status_code
        == 422
    )


def test_requests_are_private(api: tuple[TestClient, Session, FakeSceneCheck]) -> None:
    client, session, _ = api
    owner, other = student(session), student(session)
    row = queued(session, owner)
    path = f"/v1/scenes/requests/{row.id}"
    assert client.get(path, headers=token(str(other), "student")).status_code == 404
    assert client.get(path, headers=token(str(owner), "student")).json()["status"] == "queued"


def test_a_request_for_another_attempt_is_not_handed_back(
    api: tuple[TestClient, Session, FakeSceneCheck],
) -> None:
    client, session, _ = api
    learner = student(session)
    headers = token(str(learner), "student")
    first, second = attempt(session, learner), attempt(session, learner)
    one = client.post(
        "/v1/scenes/variants",
        json={"attempt_id": str(first.id), "reason": "another_way"},
        headers=headers,
    ).json()
    two = client.post(
        "/v1/scenes/variants",
        json={"attempt_id": str(second.id), "reason": "another_way"},
        headers=headers,
    ).json()
    assert one["request_id"]
    assert two["request_id"] is None  # the open request belongs to the first attempt


def test_a_variant_that_fails_review_is_not_served_by_its_request(
    api: tuple[TestClient, Session, FakeSceneCheck],
) -> None:
    client, session, _ = api
    learner = student(session)
    row = queued(session, learner)
    claimed = claim_request(session)
    assert claimed is not None
    run_request(session, claimed, generator=Generator())
    scene = session.get(SceneSpec, row.scene_spec_id)
    assert scene is not None
    scene.render_status = "FAILED"
    session.flush()
    data = client.get(
        f"/v1/scenes/requests/{row.id}", headers=token(str(learner), "student")
    ).json()
    assert data == {"request_id": str(row.id), "status": "failed", "scene": None}


def test_stale_requests_expire_and_hopeless_ones_fail_at_once(seeded: Session) -> None:
    from eddy_api.llm.client import LlmRequestError
    from eddy_api.scenes.review import REQUEST_EXPIRY

    old = queued(seeded, student(seeded))
    assert claim_request(seeded, datetime.now(UTC) + REQUEST_EXPIRY + timedelta(minutes=1)) is None
    assert old.status == "FAILED"
    fresh = queued(seeded, student(seeded))
    claimed = claim_request(seeded)
    assert claimed is not None
    run_request(seeded, claimed, generator=Generator(fail=LlmRequestError("bad request")))
    assert fresh.status == "FAILED"


def test_review_chains_count_against_the_student_who_asked(seeded: Session) -> None:
    learner = student(seeded)
    queued(seeded, learner)
    claimed = claim_request(seeded)
    assert claimed is not None
    run_request(seeded, claimed, generator=Generator())
    made = seeded.get(SceneSpec, claimed.scene_spec_id)
    assert made is not None
    assert made.verification_report["requested_by"] == str(learner)
    verdict = {"passes": False, "issues": [{"beat": 1, "problem": "Muddled."}]}
    _, _, generate = review(seeded, made, verdict)
    assert generate.calls[0].student_id == learner
