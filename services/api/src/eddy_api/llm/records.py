"""Writes each Claude call to `llm_call`: metadata only, in its own transaction (ADR-0009).

Its own session, so a call is recorded (and costed) even when the work that made it is rolled
back, for example a Tier L variant that never passed its checks.
"""

from sqlalchemy.orm import Session, sessionmaker

from eddy_api.db.models import LlmCall
from eddy_api.llm.client import CallRecord, Recorder


def llm_recorder(sessions: sessionmaker[Session]) -> Recorder:
    def record(call: CallRecord) -> None:
        with sessions() as session:
            session.add(
                LlmCall(
                    route=call.route,
                    model=call.model,
                    prompt_id=call.prompt_id,
                    prompt_version=call.prompt_version,
                    input_tokens=call.usage.input_tokens,
                    output_tokens=call.usage.output_tokens,
                    cache_read_tokens=call.usage.cache_read_tokens,
                    latency_ms=call.latency_ms,
                    cost_estimate_gbp=call.cost_gbp,
                    stop_reason=call.stop_reason,
                    safety_flags=[],
                    student_id=call.student_id,
                )
            )
            session.commit()

    return record
