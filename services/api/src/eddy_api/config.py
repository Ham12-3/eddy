"""Runtime settings, read from the environment and then services/api/.env (`pnpm keys:dev`)."""

from functools import lru_cache
from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ENV_FILE, env_file_encoding="utf-8", extra="ignore")

    # Base64 of the PEM public key that verifies the service tokens apps/web signs (ADR-0008).
    service_token_public_key_b64: str = ""
    service_token_issuer: str = "eddy-web"  # noqa: S105 (an identifier, not a secret)
    service_token_audience: str = "eddy-api"  # noqa: S105 (an identifier, not a secret)
    service_token_max_lifetime_s: int = 60

    # SecretStr keeps credentials out of repr(), logs and tracebacks.
    database_url: SecretStr = SecretStr("postgresql+psycopg://eddy:eddy@127.0.0.1:5442/eddy")
    maths_core_base_url: str = "http://127.0.0.1:8310"
    maths_core_service_token: SecretStr = SecretStr("")


@lru_cache
def get_settings() -> Settings:
    return Settings()
