"""Admin views (SPEC.md section 4.6): the cost dashboard (PLAN.md M10, ADR-0034).

`GET /v1/admin/costs` adds up `llm_call` (metadata only, never content) by day and by route,
with tokens, latency and an estimate per lesson. Admin role only.
"""

from datetime import UTC, date, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import Date, cast, func, select
from sqlalchemy.orm import Session

from eddy_api.auth import Caller, require_roles
from eddy_api.db.models import LlmCall, TutorSession
from eddy_api.db.session import get_session

router = APIRouter(prefix="/v1/admin", tags=["admin"])
DbSession = Annotated[Session, Depends(get_session)]
Admin = Annotated[Caller, Depends(require_roles("admin"))]


class RouteCost(BaseModel):
    route: str
    calls: int
    cost_gbp: float
    input_tokens: int
    output_tokens: int
    cached_tokens: int
    p95_latency_ms: int


class DayCost(BaseModel):
    day: date
    calls: int
    cost_gbp: float


class CostsOut(BaseModel):
    days: int
    total_gbp: float
    lessons: int
    #: Tutor spend divided by lessons started in the period: an estimate, not a measurement.
    per_lesson_gbp: float | None
    by_route: list[RouteCost]
    by_day: list[DayCost]


@router.get("/costs", operation_id="getCosts")
def costs(_: Admin, session: DbSession, days: Annotated[int, Query(ge=1, le=90)] = 30) -> CostsOut:
    since = datetime.now(UTC) - timedelta(days=days)
    routes = session.execute(
        select(
            LlmCall.route,
            func.count(),
            func.coalesce(func.sum(LlmCall.cost_estimate_gbp), 0),
            func.coalesce(func.sum(LlmCall.input_tokens), 0),
            func.coalesce(func.sum(LlmCall.output_tokens), 0),
            func.coalesce(func.sum(LlmCall.cache_read_tokens), 0),
            func.percentile_cont(0.95).within_group(LlmCall.latency_ms),
        )
        .where(LlmCall.created_at >= since)
        .group_by(LlmCall.route)
        .order_by(func.sum(LlmCall.cost_estimate_gbp).desc())
    ).all()
    by_day = session.execute(
        select(
            cast(LlmCall.created_at, Date),
            func.count(),
            func.coalesce(func.sum(LlmCall.cost_estimate_gbp), 0),
        )
        .where(LlmCall.created_at >= since)
        .group_by(cast(LlmCall.created_at, Date))
        .order_by(cast(LlmCall.created_at, Date))
    ).all()
    lessons = int(
        session.scalar(
            select(func.count()).select_from(TutorSession).where(TutorSession.started_at >= since)
        )
        or 0
    )
    tutor = sum(float(row[2]) for row in routes if str(row[0]).startswith(("tutor.", "safety.")))
    total = sum(float(row[2]) for row in routes)
    return CostsOut(
        days=days,
        total_gbp=round(total, 4),
        lessons=lessons,
        per_lesson_gbp=round(tutor / lessons, 4) if lessons else None,
        by_route=[
            RouteCost(
                route=str(route),
                calls=int(calls),
                cost_gbp=round(float(cost), 4),
                input_tokens=int(tokens_in),
                output_tokens=int(tokens_out),
                cached_tokens=int(cached),
                p95_latency_ms=int(p95 or 0),
            )
            for route, calls, cost, tokens_in, tokens_out, cached, p95 in routes
        ],
        by_day=[
            DayCost(day=day, calls=int(calls), cost_gbp=round(float(cost), 4))
            for day, calls, cost in by_day
        ],
    )
