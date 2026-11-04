"""Runtime settings, read from the environment and then services/maths-core/.env."""

from functools import lru_cache
from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ENV_FILE, env_file_encoding="utf-8", extra="ignore")

    # Shared secret that services/api sends in the X-Service-Token header (SPEC.md section 5.3).
    maths_core_service_token: SecretStr = SecretStr("")


@lru_cache
def get_settings() -> Settings:
    return Settings()
