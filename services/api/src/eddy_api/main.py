"""FastAPI application for services/api. Run locally with `pnpm dev:api`."""

from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException, status
from pydantic import BaseModel

from eddy_api import __version__
from eddy_api.auth import ROLES, Caller, Role, require_roles
from eddy_api.config import Settings, get_settings
from eddy_api.routes import (
    accounts,
    admin,
    curriculum,
    learning,
    local,
    me,
    parents,
    scenes,
    tutor,
)


class HealthResponse(BaseModel):
    status: Literal["ok"]
    version: str


class HelloResponse(BaseModel):
    message: str
    subject: str
    role: Role


def online_only(settings: Annotated[Settings, Depends(get_settings)]) -> None:
    """For routes the desktop app must not have: they answer 404 in local mode."""
    if settings.eddy_local_mode:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found.")


def create_app() -> FastAPI:
    app = FastAPI(title="Eddy API", version=__version__)

    @app.get("/health", operation_id="getHealth")
    def health() -> HealthResponse:
        return HealthResponse(status="ok", version=__version__)

    @app.get("/v1/hello", operation_id="getHello")
    def hello(caller: Annotated[Caller, Depends(require_roles(*ROLES))]) -> HelloResponse:
        return HelloResponse(
            message="Eddy API is reachable and verified the service token.",
            subject=caller.subject,
            role=caller.role,
        )

    # Email sign-up and parents exist only online: the desktop app has neither (ADR-0036).
    app.include_router(accounts.router, dependencies=[Depends(online_only)])
    app.include_router(local.router)
    app.include_router(me.router)
    app.include_router(learning.router)
    app.include_router(parents.router, dependencies=[Depends(online_only)])
    app.include_router(admin.router)
    app.include_router(curriculum.router)
    app.include_router(scenes.router)
    app.include_router(tutor.router)
    return app


app = create_app()
