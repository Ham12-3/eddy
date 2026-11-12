# Eddy

Adaptive GCSE Maths tutor that explains a student's own mistake with a short animation. SPEC.md says what we build, PLAN.md the order and each milestone's definition of done, DECISIONS.md why. docs/brief.md is the original brief; SPEC.md wins where they differ.

## Commands

| Task | Command |
|---|---|
| Install | `pnpm install` then `uv sync` |
| Local secrets (first run) | `pnpm keys:dev` (writes git-ignored .env files) |
| Run everything | `pnpm dev` (docker compose, migrate, seed, then web :3300, api :8300, maths-core :8310, scene-check :8320, the worker) |
| Database | `pnpm db:local` (creates the database, lets the runtime role log in), `pnpm db:migrate`, `pnpm db:seed` (`--dry-run --verbose` shows the diff) |
| Invites and jobs | `uv run --package eddy-api python -m eddy_api.invites CODE --uses 30`; `python -m eddy_api.jobs purge\|alerts\|all` (privacy purges, safeguarding alerts) |
| Curriculum YAML | `pnpm curriculum:check` (schemas and cross-file checks, no database) |
| Maths core | `pnpm evals` (golden set, 100%), `pnpm maths:coverage` (85% or more), `pnpm maths:bench` (p95 under 150 ms) |
| Learner model | `pnpm learner:coverage` (85% or more), `pnpm learner:report` (the synthetic-student numbers behind ADR-0026) |
| Scenes | `pnpm scenes:check [key]` (static and DOM checks, keyframes in `e2e-artifacts/scenes/`), `pnpm scenes:golden` (scene maths verified), `/admin/scenes` gallery |
| Tutor | `pnpm evals:tutor` (72 scripted conversations; a dry run unless `-- --live --max-gbp 8`, ask first; `--only <ids or scenarios>`, `--no-calibration`) |
| Tier L scenes | `pnpm evals:tier-l` (dry run; `-- --live --max-gbp 20` calls Claude, ask first), `pnpm scenes:precompute` (dry run likewise), `pnpm scenes:cache-bench` |
| Generated schemas | `pnpm schemas:generate` after changing `packages/schemas` (SceneSpec JSON Schema and pydantic; CI checks) |
| All checks | `pnpm check` (ESLint, Prettier, dash check, typecheck, unit tests, ruff, mypy, pytest) |
| One TS package | `pnpm --filter @eddy/web test` (or `typecheck`, `lint`) |
| One TS test file | `pnpm --filter @eddy/web exec vitest run src/lib/service-token.test.ts` |
| Python | `uv run pytest`, `uv run pytest services/api/tests/test_auth.py`, `uv run mypy`, `uv run ruff check .` |
| E2E with axe | `pnpm e2e` (first time: `pnpm e2e:install`); screenshots in `e2e-artifacts/screenshots/` |
| Regenerate API client | `pnpm api-client:generate` after changing any services/api route (CI checks it) |
| Infra | `pnpm --filter @eddy/infra synth` (never deploy without explicit approval) |
| Hook tests | `node --test ".claude/hooks/*.test.mjs"` |
| Format | `pnpm format` |

Local services (`docker compose up -d --wait`): Postgres 127.0.0.1:5442 (eddy/eddy), Redis :6390, S3Mock :9590 (bucket `eddy-assets`), ElasticMQ (SQS) :9324, Mailpit UI :8025 and SMTP :1025.

## Gotchas

- Dev machine is Windows, CI is Linux. Scripts and hooks are Node or Python, never bash-only. LF line endings everywhere: Python's `write_text` writes CRLF on Windows, so write bytes or pass `newline="\n"`.
- Ports 3000, 5432 and 8000 are taken on the dev machine; that is why Eddy uses the ports above. E2E uses 3301 and 8301 with throwaway keys.
- You cannot read `.env` files (permission rule plus the guard hook). The keys each one holds are listed in the matching `.env.example`.
- Edits under `compliance/` always ask the user first. Never write evidence that does not exist.
- Workspace packages export TypeScript source; Next compiles them via `transpilePackages`. There is no package build step.
- E2E creates, migrates and seeds its own `eddy_e2e` database; the seed refuses a non-local database unless `--allow-remote` is passed. Database tests make and drop their own `eddy_test_*` database. They skip when Postgres is down, except with `EDDY_REQUIRE_DB=1` (CI), where they fail. The API suite is slow on the dev machine; run it in the background.
- The curriculum is YAML in `curriculum/`, seeded by natural key (ADR-0021). Add misconceptions with `/new-misconception`. The admin pages under `/admin` exist only in development or with `EDDY_ADMIN_PREVIEW=1` until sign-in in M8.
- The Python workspace root is virtual. Tests run with `--import-mode=importlib` because both services have a `tests/` folder.
- TypeScript is pinned to 5.9 and ESLint to 9 (ADR-0017). Do not upgrade either without checking typescript-eslint and eslint-config-next support.
- LocalStack now needs a licence, so local S3 and SQS are S3Mock and ElasticMQ (ADR-0016).
- `next typegen` runs before `tsc` in apps/web because `next-env.d.ts` is git-ignored.
- The Stop hook runs typecheck and tests for changed packages and blocks the turn on failure (3 tries max). It skips the run when nothing changed since the last pass. `EDDY_STOP_HOOK_DISABLE=1`, set before starting Claude Code, switches it off.
- The guard hook (`.claude/hooks/lib/guard.mjs`) also blocks recursive `grep` over directories (use `rg` or the Grep tool, which skip `.env`), recursive deletes outside temp folders, and `git clean -f`. It fails closed: an error in the guard denies the command.
- The hello page's system check only renders in development or with `EDDY_SYSTEM_CHECK=1` (ADR-0018). Routes in services/api name their accepted roles with `require_roles(...)`.
- `next dev` would write an `AGENTS.md`; `agentRules: false` in `next.config.ts` stops it.
- The API and worker connect as the runtime role `eddy_app` (`RUNTIME_DATABASE_URL`), which cannot change the schema or the audit log; migrations and the seed use the owner (`DATABASE_URL`). API tests run as `eddy_app` too (ADR-0024, ADR-0032).
- Sign-in links point at `AUTH_URL`, which must use `localhost` (`http://localhost:3300` locally), and the app must be opened there: Next.js reports 127.0.0.1 as localhost, so Auth.js redirects to localhost and a cookie set on 127.0.0.1 is lost. Read sign-in emails in Mailpit at http://127.0.0.1:8025. E2E reads them there too, so Mailpit must be running.
- E2E runs the tutor with no Claude key (templated messages), so it never costs money.
- Claude calls need `ANTHROPIC_API_KEY` in services/api/.env, which the user adds and nobody reads. Without it Tier L is off and Tier D is served. Live evals and precompute cost money: always ask before `--live`.
- The safeguarding script and tripwires (`services/api/src/eddy_api/tutor/safeguarding.py`, `config/safeguarding/tripwires.yaml`) are drafts until Eddy's named safeguarding lead approves them; never change the script's wording without that approval.
- `pnpm keys:dev` only adds missing keys to existing .env files; `--force` replaces the ones it manages and keeps the rest. It writes `EDDY_ENVIRONMENT=development` for services/api: settings default to production, where the ZDR gate's local-database exception and the unapproved safeguarding draft are off.
- The tutor's checkpointer runs on the request's own connection inside its transaction (`routes/tutor.py` `graph_for`); never give it its own pool or autocommit, or a failed turn leaves the lesson stuck.
- Run Prettier from the repo root only: from a package directory it skips `.prettierignore` and reformats generated files such as `font-metrics.json`, which then fail CI.
- Scene text is measured with `packages/scenes/src/layout/font-metrics.json` (regular weight only); run `pnpm --filter @eddy/scenes fonts:generate` if a font changes. Scenes play on our own renderer, not Remotion (ADR-0027).

## Rules that never bend

- UK English. Never an en or em dash in code, comments, copy or docs (`scripts/check-dashes.mjs` fails the build). No emoji in UI copy.
- Student input is never evaluated: MathJSON, then an allow-list, then SymPy. No maths reaches a student without maths-core verification.
- Model IDs live only in `config/models.yaml`. Never send temperature, top_p or top_k. No assistant prefill.
- No AQA, Pearson or OCR material anywhere, including prompts and evals.
- Ask before anything destructive or irreversible, infra changes, paid services or accounts, licence changes, and before any push or PR.
- Never claim a check passed without running it. Report failures with their output.

## Definition of done (every milestone)

1. The milestone's PLAN.md checklist is ticked only where evidence supports it.
2. `pnpm check` is green; `pnpm e2e` is green with zero serious or critical axe violations.
3. Screenshots at 375, 768 and 1280 px in light, dark and reduced motion have been looked at and fixed.
4. Fresh-context review done (`reviewer` agent, plus `security-reviewer` or `pedagogy-critic` where relevant); findings fixed or recorded.
5. Evidence block appended to PLAN.md, CHANGELOG.md updated, conventional commit on the milestone branch.

The `milestone-review` skill walks through all of this.
