"""FastAPI application for services/api. Run locally with `pnpm dev:api`."""

from typing import Annotated, Literal

from fastapi import Depends, FastAPI
from pydantic import BaseModel

from eddy_api import __version__
from eddy_api.auth import ROLES, Caller, Role, require_roles
from eddy_api.routes import accounts, curriculum, learning, me, scenes, tutor


class HealthResponse(BaseModel):
    status: Literal["ok"]
    version: str


class HelloResponse(BaseModel):
    message: str
    subject: str
    role: Role


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

    app.include_router(accounts.router)
    app.include_router(me.router)
    app.include_router(learning.router)
    app.include_router(curriculum.router)
    app.include_router(scenes.router)
    app.include_router(tutor.router)
    return app


app = create_app()
