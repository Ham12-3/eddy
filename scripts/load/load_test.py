"""Load test (PLAN.md M10, ADR-0034): the API under concurrent students, against local services.

Starts its own API (port 8302) and maths-core (port 8312) on the E2E database with a fresh
service-token key, signs up STUDENTS test students, then for DURATION seconds runs CONCURRENCY
loops, each acting as a student: their account, today's plan, progress, the diagnostic start
and the curriculum. No Claude calls (no key is given), so it costs nothing.

    uv run --package eddy-api python scripts/load/load_test.py [--concurrency 20] [--duration 30]

Reports p50, p95 and the worst time per route, errors and requests per second, and writes
e2e-artifacts/load/report.json. Postgres, Redis and Mailpit must be running (docker compose).
k6 is not installed on the dev machine, so this script stands in for it; the report has the
same numbers k6 would give for these routes.
"""

import argparse
import asyncio
import base64
import json
import os
import secrets
import statistics
import subprocess
import sys
import time
import uuid
from datetime import date
from pathlib import Path
from typing import Any

import httpx
import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

ROOT = Path(__file__).resolve().parents[2]
API = "http://127.0.0.1:8302"
MATHS = "http://127.0.0.1:8312"
OWNER_URL = "postgresql+psycopg://eddy:eddy@127.0.0.1:5442/eddy_e2e"
RUNTIME_URL = "postgresql+psycopg://eddy_app:eddy_app@127.0.0.1:5442/eddy_e2e"
INVITE = "LOADTEST2026"
KEY = ec.generate_private_key(ec.SECP256R1())
PUBLIC_B64 = base64.b64encode(
    KEY.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
).decode()


def token(subject: str, role: str) -> dict[str, str]:
    now = int(time.time())
    claims = {"iss": "eddy-web", "aud": "eddy-api", "sub": subject, "role": role}
    claims |= {"iat": now, "exp": now + 60}
    return {"Authorization": f"Bearer {jwt.encode(claims, KEY, algorithm='ES256')}"}


def start(command: list[str], env: dict[str, str]) -> subprocess.Popen[bytes]:
    return subprocess.Popen(  # noqa: S603 (fixed commands)
        command,
        cwd=ROOT,
        env={**os.environ, **env},
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def stop(process: subprocess.Popen[bytes]) -> None:
    """Stop a server and its children: on Windows `uv run` leaves uvicorn running otherwise."""
    if os.name == "nt":
        subprocess.run(  # noqa: S603
            ["taskkill", "/T", "/F", "/PID", str(process.pid)],  # noqa: S607
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    else:
        process.terminate()


async def wait_for(url: str, seconds: float = 90) -> None:
    deadline = time.monotonic() + seconds
    async with httpx.AsyncClient() as client:
        while time.monotonic() < deadline:
            try:
                if (await client.get(url, timeout=2)).status_code == 200:
                    return
            except httpx.HTTPError:
                pass
            await asyncio.sleep(0.5)
    raise RuntimeError(f"{url} did not come up")


async def make_students(client: httpx.AsyncClient, count: int) -> list[str]:
    ids = []
    today = date.today()
    for n in range(count):
        email = f"load-{uuid.uuid4().hex[:10]}-{n}@example.test"
        auth = token("system:auth", "system")
        signup = await client.post(
            f"{API}/v1/auth/signups",
            json={
                "email": email,
                "invite_code": INVITE,
                "birth_year": today.year - 15,
                "birth_month": 1,
                "visitor": secrets.token_hex(32),
            },
            headers=auth,
        )
        signup.raise_for_status()
        made = await client.post(f"{API}/v1/auth/users", json={"email": email}, headers=auth)
        made.raise_for_status()
        user = made.json()["id"]
        setup = await client.put(
            f"{API}/v1/me/profile",
            json={
                "exam_series": f"{today.year + 1}-summer",
                "target_grade": 4,
                "is_resitter": False,
            },
            headers=token(user, "student"),
        )
        setup.raise_for_status()
        ids.append(user)
    return ids


ROUTES = [
    ("GET", "/v1/me"),
    ("GET", "/v1/me/plan"),
    ("GET", "/v1/me/progress"),
    ("POST", "/v1/diagnostic"),
    ("GET", "/v1/curriculum/nodes"),
]


async def student_loop(
    client: httpx.AsyncClient, student: str, until: float, times: dict[str, list[float]]
) -> dict[str, int]:
    errors: dict[str, int] = {}
    step = 0
    while time.monotonic() < until:
        method, path = ROUTES[step % len(ROUTES)]
        step += 1
        started = time.perf_counter()
        try:
            response = await client.request(
                method, f"{API}{path}", headers=token(student, "student"), timeout=30
            )
            ok = response.status_code < 400
        except httpx.HTTPError:
            ok = False
        times.setdefault(path, []).append((time.perf_counter() - started) * 1000)
        if not ok:
            errors[path] = errors.get(path, 0) + 1
    return errors


def percentile(values: list[float], share: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(share * len(ordered)))]


async def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--concurrency", type=int, default=20)
    parser.add_argument("--duration", type=int, default=30)
    parser.add_argument("--students", type=int, default=20)
    args = parser.parse_args(argv)
    maths_token = secrets.token_urlsafe(32)
    env = {
        "DATABASE_URL": OWNER_URL,
        "RUNTIME_DATABASE_URL": RUNTIME_URL,
        "SERVICE_TOKEN_PUBLIC_KEY_B64": PUBLIC_B64,
        "MATHS_CORE_BASE_URL": MATHS,
        "MATHS_CORE_SERVICE_TOKEN": maths_token,
        "EDDY_ENVIRONMENT": "test",
        "ANTHROPIC_API_KEY": "",
        "SIGNUP_LIMIT_SCALE": "100",
    }
    uv = ["uv", "run", "--package"]
    for step in (["eddy_api.db.local"], ["eddy_api.invites", INVITE, "--uses", "100000"]):
        subprocess.run(  # noqa: S603 (fixed commands)
            [*uv, "eddy-api", "python", "-m", *step],
            cwd=ROOT,
            env={**os.environ, **env},
            check=True,
        )
    subprocess.run(
        ["pnpm", "db:migrate"],  # noqa: S607 (pnpm from PATH, as the dev scripts use)
        cwd=ROOT,
        env={**os.environ, **env},
        check=True,
        shell=os.name == "nt",
    )
    api = start(
        [*uv, "eddy-api", "uvicorn", "eddy_api.main:app", "--port", "8302", "--workers", "2"], env
    )
    maths = start(
        [*uv, "eddy-maths-core", "uvicorn", "eddy_maths_core.main:app", "--port", "8312"],
        {"MATHS_CORE_SERVICE_TOKEN": maths_token},
    )
    try:
        await wait_for(f"{API}/health")
        await wait_for(f"{MATHS}/health")
        limits = httpx.Limits(max_connections=args.concurrency * 2)
        async with httpx.AsyncClient(limits=limits) as client:
            students = await make_students(client, args.students)
            times: dict[str, list[float]] = {}
            until = time.monotonic() + args.duration
            started = time.monotonic()
            results = await asyncio.gather(
                *(
                    student_loop(client, students[n % len(students)], until, times)
                    for n in range(args.concurrency)
                )
            )
            elapsed = time.monotonic() - started
    finally:
        for process in (api, maths):
            stop(process)
    errors: dict[str, int] = {}
    for result in results:
        for path, count in result.items():
            errors[path] = errors.get(path, 0) + count
    total = sum(len(v) for v in times.values())
    report: dict[str, Any] = {
        "concurrency": args.concurrency,
        "duration_s": round(elapsed, 1),
        "requests": total,
        "requests_per_second": round(total / elapsed, 1),
        "errors": errors,
        "routes": {
            path: {
                "count": len(values),
                "p50_ms": round(statistics.median(values), 1),
                "p95_ms": round(percentile(values, 0.95), 1),
                "max_ms": round(max(values), 1),
            }
            for path, values in times.items()
        },
    }
    out = ROOT / "e2e-artifacts" / "load"
    out.mkdir(parents=True, exist_ok=True)
    (out / "report.json").write_bytes(json.dumps(report, indent=2).encode())
    print(json.dumps(report, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv[1:])))
