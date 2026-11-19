# services/api: the API (default command) and the worker (Fly process group "worker").
# Built from the repository root: see docs/deploy.md.
FROM python:3.12-slim-bookworm

COPY --from=ghcr.io/astral-sh/uv:0.11.14 /uv /usr/local/bin/uv

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    EDDY_ENVIRONMENT=production

WORKDIR /app

# Dependencies first, so a code change does not reinstall them.
COPY pyproject.toml uv.lock .python-version ./
COPY services/api/pyproject.toml services/api/pyproject.toml
COPY services/maths-core/pyproject.toml services/maths-core/pyproject.toml
RUN uv sync --frozen --no-dev --package eddy-api --no-install-workspace

# The code, and the files it reads at run time (REPO_ROOT is /app): model ids, prompts, the
# safeguarding tripwires and the curriculum the scenes and tutor read.
COPY services/api services/api
COPY config config
COPY prompts prompts
COPY curriculum curriculum
RUN uv sync --frozen --no-dev --package eddy-api

RUN useradd --system --uid 10001 eddy
USER eddy
ENV PATH="/app/.venv/bin:${PATH}"

EXPOSE 8080
# Fly's proxy reaches the app on IPv4. (On "::" asyncio would listen on IPv6 only.)
CMD ["uvicorn", "eddy_api.main:app", "--host", "0.0.0.0", "--port", "8080"]
