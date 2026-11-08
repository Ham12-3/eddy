"""FastAPI application for services/maths-core. Run locally with `pnpm dev:maths`.

Private service: only services/api calls it, with the shared X-Service-Token header.
"""

import hmac
from typing import Annotated, Literal

import sympy
from fastapi import Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel

from eddy_maths_core import __version__
from eddy_maths_core.config import Settings, get_settings


class HealthResponse(BaseModel):
    status: Literal["ok"]
    version: str
    sympy_version: str


class HelloResponse(BaseModel):
    message: str


MIN_TOKEN_LENGTH = 32
# Placeholder values from the .env.example files; never valid.
PLACEHOLDER_TOKENS = frozenset({"shared-random-token"})


def require_service_token(
    settings: Annotated[Settings, Depends(get_settings)],
    x_service_token: Annotated[str | None, Header()] = None,
) -> None:
    expected = settings.maths_core_service_token.get_secret_value()
    if len(expected) < MIN_TOKEN_LENGTH or expected in PLACEHOLDER_TOKENS:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, detail="Service token verification is unavailable."
        )
    # Compare bytes: compare_digest rejects non-ASCII str input with a TypeError.
    if x_service_token is None or not hmac.compare_digest(
        x_service_token.encode(), expected.encode()
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid service token.")


def create_app() -> FastAPI:
    app = FastAPI(title="Eddy maths-core", version=__version__)

    @app.get("/health")
    def health() -> HealthResponse:
        return HealthResponse(status="ok", version=__version__, sympy_version=sympy.__version__)

    @app.get("/v1/hello", dependencies=[Depends(require_service_token)])
    def hello() -> HelloResponse:
        return HelloResponse(message="Eddy maths-core is reachable.")

    return app


app = create_app()
