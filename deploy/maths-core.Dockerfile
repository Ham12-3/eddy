# services/maths-core: stateless maths verification, reachable only on Fly's private network.
# Built from the repository root: see docs/deploy.md.
FROM python:3.12-slim-bookworm

COPY --from=ghcr.io/astral-sh/uv:0.11.14 /uv /usr/local/bin/uv

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

COPY pyproject.toml uv.lock .python-version ./
COPY services/api/pyproject.toml services/api/pyproject.toml
COPY services/maths-core/pyproject.toml services/maths-core/pyproject.toml
RUN uv sync --frozen --no-dev --package eddy-maths-core --no-install-workspace

COPY services/maths-core services/maths-core
RUN uv sync --frozen --no-dev --package eddy-maths-core

RUN useradd --system --uid 10001 eddy
USER eddy
ENV PATH="/app/.venv/bin:${PATH}"

EXPOSE 8310
# IPv6 only: Fly's private network is IPv6, and nothing else should reach it.
CMD ["uvicorn", "eddy_maths_core.main:app", "--host", "::", "--port", "8310"]
