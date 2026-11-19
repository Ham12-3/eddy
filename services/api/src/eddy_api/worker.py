"""The services/api worker process (SPEC.md section 5.1): `pnpm dev:worker`, or
`uv run --package eddy-api python -m eddy_api.worker [--once]`.

It generates the Tier L scenes students asked for, then reviews Tier L scenes after they are
served (scenes/review.py). It needs Claude, the scene-check service and maths-core. Without Tier L
(no Anthropic key, or no ZDR confirmation against a non-local database) it says so and runs only
the privacy and safeguarding jobs, every 15 minutes (ADR-0034).
Over the daily budget it does nothing until there is room.
"""

import argparse
import logging
import sys
import time
import uuid

from sqlalchemy.orm import Session, sessionmaker

from eddy_api import jobs
from eddy_api.config import Settings, get_settings, tier_l_enabled
from eddy_api.db.session import session_factory
from eddy_api.llm.client import LlmClient
from eddy_api.llm.records import llm_recorder
from eddy_api.scenes.generate import Variant, VariantRequest, generate_variant
from eddy_api.scenes.review import (
    Regenerate,
    claim_next,
    claim_request,
    finish_request,
    process,
    run_request,
)
from eddy_api.scenes.services import MathsCoreClient, SceneCheckClient
from eddy_api.scenes.variants import generation_allowed

POLL_S = 5.0
ERROR_PAUSE_S = 30.0
HEALTH_WAIT_S = 120.0
log = logging.getLogger("eddy_api.worker")


def run_once(
    sessions: sessionmaker[Session],
    settings: Settings,
    *,
    scene_check: SceneCheckClient,
    llm: LlmClient,
    generator: Regenerate,
) -> bool:
    """Does one job. False when there was nothing to do (or no budget to do it)."""

    def allowed(session: Session, student: uuid.UUID | None = None) -> bool:
        return generation_allowed(
            session,
            student,
            calls_per_student=settings.tier_l_calls_per_student_per_day,
            daily_budget_gbp=settings.tier_l_daily_budget_gbp,
        )

    # A scene-check outage must not use up jobs' attempts: wait until it answers.
    if not scene_check.healthy():
        return False
    with sessions() as session:
        if not allowed(session):
            return False
        session.commit()  # no transaction stays open while Claude works
        request = claim_request(session)
        if request is not None:
            within = allowed(session, request.student_id)
            session.commit()
            if within:
                run_request(session, request, generator=generator)
            else:
                finish_request(session, request, "FAILED", "The daily limit was reached.")
                session.commit()
            log.info("request %s: %s", request.id, request.status)
            return True
        scene = claim_next(session)
        if scene is not None:
            replacement = process(
                session, scene, scene_check=scene_check, llm=llm, generator=generator
            )
            log.info("review %s: %s (replacement %s)", scene.id, scene.render_status, replacement)
            return True
    return False


#: How often the privacy and safeguarding jobs run (ADR-0034): alerts first, then purges and
#: erasures, so the safeguarding lead hears of a concern before anything is erased.
PRIVACY_EVERY_S = 15 * 60


def privacy_tick(sessions: sessionmaker[Session], settings: Settings) -> None:
    """One run of the privacy jobs. A failure is logged and retried on the next tick."""
    with sessions() as session:
        for name, job in (
            ("alerts", lambda: jobs.alerts(session, settings)),
            ("purge", lambda: jobs.purge(session, settings)),
            ("erasures", lambda: jobs.erasures(session)),
        ):
            try:
                log.info("%s: %s", name, job())
            except Exception:
                session.rollback()
                log.exception("the %s job failed; it runs again next time", name)


def main(argv: list[str]) -> int:
    logging.basicConfig(level=logging.INFO, format="worker: %(message)s")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true", help="do what is queued, then stop")
    args = parser.parse_args(argv)
    settings = get_settings()
    sessions = session_factory()
    privacy_tick(sessions, settings)
    next_privacy = time.monotonic() + PRIVACY_EVERY_S
    if not tier_l_enabled(settings):
        log.info("Tier L scenes are off (no key, or no ZDR for this database).")
        if args.once:
            return 0
        while True:
            time.sleep(PRIVACY_EVERY_S)
            privacy_tick(sessions, settings)
    llm = LlmClient.from_key(
        settings.anthropic_api_key.get_secret_value(), recorder=llm_recorder(sessions)
    )
    scene_check = SceneCheckClient.from_settings(settings)
    maths_core = MathsCoreClient.from_settings(settings)

    def generator(request: VariantRequest) -> Variant:
        return generate_variant(request, llm=llm, scene_check=scene_check, maths_core=maths_core)

    # pnpm dev starts everything at once: wait for scene-check rather than fail every job.
    deadline = time.monotonic() + HEALTH_WAIT_S
    while not scene_check.healthy():
        if time.monotonic() > deadline:
            log.error("scene-check is not answering at %s", settings.scene_check_base_url)
            return 1
        time.sleep(POLL_S)

    while True:
        if time.monotonic() >= next_privacy:
            privacy_tick(sessions, settings)
            next_privacy = time.monotonic() + PRIVACY_EVERY_S
        try:
            worked = run_once(
                sessions, settings, scene_check=scene_check, llm=llm, generator=generator
            )
        except Exception:
            log.exception("a job failed unexpectedly")
            time.sleep(ERROR_PAUSE_S)
            continue
        if worked:
            continue
        if args.once:
            return 0
        time.sleep(POLL_S)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
