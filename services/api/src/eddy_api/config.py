"""Runtime settings, read from the environment and then services/api/.env (`pnpm keys:dev`)."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url

_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ENV_FILE, env_file_encoding="utf-8", extra="ignore")

    # Base64 of the PEM public key that verifies the service tokens apps/web signs (ADR-0008).
    service_token_public_key_b64: str = ""
    # Where this API runs. Production unless set: `pnpm keys:dev` writes development locally, and
    # only development and test allow the ZDR gate's local-database exception and the tutor's
    # unapproved safeguarding draft (ADR-0031).
    eddy_environment: Literal["development", "test", "production"] = "production"
    service_token_issuer: str = "eddy-web"  # noqa: S105 (an identifier, not a secret)
    service_token_audience: str = "eddy-api"  # noqa: S105 (an identifier, not a secret)
    service_token_max_lifetime_s: int = 60

    # SecretStr keeps credentials out of repr(), logs and tracebacks.
    # The schema owner: migrations, the seed and the local database helpers (ADR-0024).
    database_url: SecretStr = SecretStr("postgresql+psycopg://eddy:eddy@127.0.0.1:5442/eddy")
    # The runtime role the API and worker connect as: it can change rows but not the schema, and
    # can only read and add to the audit log (migration 0006).
    runtime_database_url: SecretStr = SecretStr(
        "postgresql+psycopg://eddy_app:eddy_app@127.0.0.1:5442/eddy"
    )
    maths_core_base_url: str = "http://127.0.0.1:8310"
    maths_core_service_token: SecretStr = SecretStr("")
    # The scene engine's checks over HTTP (workers/scene-check, its `serve` script).
    scene_check_base_url: str = "http://127.0.0.1:8320"
    scene_check_service_token: SecretStr = SecretStr("")
    # Claude (SPEC.md section 10). You put the key in services/api/.env yourself; it is never read
    # by tools or printed. Empty means no Tier L scenes: Tier D is served instead.
    anthropic_api_key: SecretStr = SecretStr("")
    # Cost guards for Tier L (ADR-0030): Claude calls one student may cause in 24 hours, and what
    # all of them may cost in 24 hours. Past either, scenes come from the cache or Tier D.
    tier_l_calls_per_student_per_day: int = 12
    tier_l_daily_budget_gbp: float = 5.0
    # SPEC.md section 10: zero data retention must be confirmed with Anthropic before any real
    # student data reaches Claude. Until it is, Tier L runs only against a local database.
    anthropic_zdr_confirmed: bool = False
    # The tutor (M7): Redis for rate limits, and how many messages a student may send.
    redis_url: str = "redis://127.0.0.1:6390/0"
    tutor_messages_per_minute: int = 12
    tutor_messages_per_day: int = 400
    # Cost guards for the tutor's Claude calls (tutor.turn and safety.*), over 24 hours: past
    # either, the tutor uses templated messages and free text gets a static reply.
    tutor_gbp_per_student_per_day: float = 0.5
    tutor_daily_budget_gbp: float = 20.0
    # Tutor turns one API process runs at once; each holds a database connection while Claude
    # writes (ADR-0031). Past it, the student is asked to try again in a moment.
    tutor_concurrent_turns: int = 4
    # Multiplies the per-visitor invite and sign-up limits (ADR-0032). Only E2E raises it, as its
    # parallel browsers all share one address.
    signup_limit_scale: int = 1
    # Privacy jobs (M8, `python -m eddy_api.jobs`): tutor message text is deleted after this many
    # days, and checkpoints of lessons that old with it (SPEC.md section 6.7).
    tutor_message_days: int = 90
    # Safeguarding alerts: where an alert for a new event or SAFETY concern goes (the named
    # safeguarding lead). Empty means no alert is sent and events wait, unnotified, for review.
    safeguarding_alert_email: str = ""
    smtp_url: str = "smtp://127.0.0.1:1025"
    mail_from: str = "Eddy <alerts@eddy.localhost>"


@lru_cache
def get_settings() -> Settings:
    return Settings()


def development(settings: Settings) -> bool:
    return settings.eddy_environment in ("development", "test")


def tier_l_enabled(settings: Settings) -> bool:
    """Claude (Tier L scenes and the tutor) is on with a key, and with ZDR confirmed, or with a
    local database in development or test."""
    if not settings.anthropic_api_key.get_secret_value():
        return False
    if settings.anthropic_zdr_confirmed:
        return True
    if not development(settings):
        return False
    for secret in (settings.database_url, settings.runtime_database_url):
        url = make_url(secret.get_secret_value())
        # Query options can send the connection elsewhere (host, hostaddr, a service file entry).
        if any(key in url.query for key in ("host", "hostaddr", "service")):
            return False
        if (url.host or "") not in {"127.0.0.1", "localhost", "::1"}:
            return False
    return True
