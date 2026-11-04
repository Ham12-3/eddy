# Changelog

## Unreleased

### M0: Foundations (4 November 2026)

Added:

- pnpm and uv workspaces: `apps/web`, `packages/ui`, `packages/scenes`, `packages/schemas`, `packages/api-client`, `workers/scene-check`, `infra`, `services/api`, `services/maths-core`.
- Next.js 16 hello page that calls services/api through the backend-for-frontend boundary, with a 60-second ES256 service token (ADR-0008). FastAPI services with health and hello endpoints; maths-core checks a shared service token.
- TypeScript API client generated from the services/api OpenAPI document, with a CI drift check.
- `docker compose`: PostgreSQL 16, Redis 7.4, S3Mock, ElasticMQ and Mailpit, on ports that avoid 3000, 5432 and 8000.
- `pnpm keys:dev` to create local service-token keys and the maths-core token without printing them.
- Tooling: ESLint, Prettier, a no-dash check, TypeScript strict, Vitest, ruff, strict mypy, pytest, Playwright with axe across 375, 768 and 1280 px in light, dark and reduced motion.
- GitHub Actions CI: checks, API client drift, CDK synth, E2E with screenshots as artifacts.
- AWS CDK skeleton for eu-west-2 (network, data, services stacks), synthesised only.
- Claude Code setup: CLAUDE.md, permission rules, a PreToolUse guard hook and a Stop hook (both tested), path rules, review agents and the `milestone-review` skill.
- Compliance skeletons: DPIA, Children's Code checklist, DfE standards matrix, governance, runbooks.
- ADR-0016 (S3Mock and ElasticMQ instead of LocalStack), ADR-0017 (TypeScript 5.9 and ESLint 9) and ADR-0018 (the `system` role; routes name the roles they accept).

Changed after the M0 code and security reviews: stricter service-token verification, safer maths-core token handling, `server-only` on secret-handling modules, a stronger guard hook that fails closed, a Stop hook that reports when it gives up, wider `.gitignore` coverage of secrets, and an infra skeleton that synthesises without AWS lookups. Details are in the PLAN.md evidence log.
