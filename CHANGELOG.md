# Changelog

## Unreleased

### M2: Curriculum and data (5 November 2026)

Added:

- SQLAlchemy models and the first Alembic migration for every table in SPEC.md section 6 (32 tables), including the Auth.js tables in our own conventions (ADR-0023) and an `audit_log` that a trigger keeps append-only. Enums are checked strings; constraints have stable names.
- The curriculum as YAML with a JSON Schema per file (ADR-0021): all 97 DfE maths statements with tiers and visual suitability; the AQA 8300, Edexcel 1MA1 and OCR J560 paper structures; the prerequisite DAG for the 13 MVP topics and every ancestor; 85 misconceptions with student and teacher wording, detection rules, scene, re-check family and evidence; English set texts with copyright status and display policy, question types and level descriptors in our own words.
- A rule language for misconception detection (ADR-0022): `distractor`, `structure` and `classifier` rules. 82 distractor and 2 structure rule names for maths-core to implement in M3.
- `python -m eddy_api.seed` (`pnpm db:seed`, `pnpm curriculum:check`): schema and cross-file validation, cycle detection, then an idempotent upsert by natural key with a `--dry-run` diff. The second run reports zero changes.
- A read-only curriculum API (`/v1/curriculum/specs`, `nodes`, `nodes/{code}`, `topics`, `misconceptions`) for every role, and the regenerated TypeScript client.
- A read-only admin curriculum browser at `/admin/curriculum`, with a page per node. Development or `EDDY_ADMIN_PREVIEW=1` only until M8.
- The `/new-misconception` skill and `curriculum/README.md`.
- Tests: YAML validity and planted faults (a cycle, unknown codes, duplicate keys, an en dash, in-copyright full text), seed idempotence and dry run, migrations up, down and up again, models matching migrations, the audit trigger, the API and its auth.
- CI: a Postgres service for the checks and E2E jobs, database tests required there, and a curriculum check step. `pnpm dev` and the E2E API server migrate and seed first; E2E uses its own `eddy_e2e` database.

Fixed during M2 (found by the fresh-context, security and pedagogy reviews):

- The admin pages rendered and fetched data behind a layout `notFound()` in a production build. They are now gated in `src/proxy.ts`, in every page and `generateMetadata`, and before any token is signed; an E2E server without the flag proves the 404 for HTML and RSC requests. The preview signs as `admin`, not `system` (ADR-0018 amended), and only runs under `next dev` or with the flag.
- The seed left edges touching a removed node, and left removed rows live. It now deletes those edges and retires removed nodes, topics, misconceptions and set texts, which the API no longer serves.
- Migration 0002: deleting an account no longer deletes safeguarding or erasure records; sessions store a token hash; OAuth token columns removed; integrity checks on parent links and invite codes. Audit grants, the age check before email storage and retention move to M8 (ADR-0024).
- Students and parents no longer receive teacher wording or detection rules from the curriculum API.
- The YAML loader refuses aliases and non-scalar keys, reports impossible dates as problems, and checks codes with a full match.
- Student-facing misconception text no longer uses one item's numbers or gives an answer away; two duplicate misconceptions were replaced (EQ_SIGN_CHANGED_NOT_MOVED, RATIO_FRACTION_WRONG_WAY_ROUND); order of operations moved to N3; two structure rules and two new distractor rules; English level descriptors rewritten further from the board's wording, with the Literature ladder realigned.
- N16 is Foundation with a Higher extension and G8 is Higher only; two modern set texts added.

### M1: Design system (5 November 2026)

Added:

- The "Paper and Ink" design system in `packages/ui`: tokens from one TypeScript source with generated CSS and a drift test, and a Tailwind v4 theme limited to those tokens.
- A contrast-safe palette approved during M1 (ADR-0019). The marker-orange accent is a fill with ink text (light #F08C4A, dark #FFA552), well apart from the misconception red. New `--field-border` and `--on-accent` tokens, and a darker dark-mode highlighter. Every allowed colour pairing is tested in light, dark and dyslexia modes.
- Self-hosted Fraunces, Atkinson Hyperlegible Next, Caveat and OpenDyslexic (regular and bold), plus dark, dyslexia and reduced-motion modes. Reduced motion turns movement into 150ms cross-fades.
- 20 components: Button, Link, Card, QuestionCard, WorkingPad, Maths (KaTeX with MathML), MathField (MathLive with a Foundation keyboard including units), Feedback with LiveRegion, ConfidencePicker, ProgressMapNode, Chip, Toggle, Dialog and Sheet, Tabs, Toast, form fields, Skeleton, EmptyState, ErrorState and the explanation player controls.
- Storybook stories for every component and state, and Playwright checks of every story at 375, 768 and 1280 px in light, dark, reduced motion and dyslexia, plus a forced-dark theme and dyslexia on dark. Each check runs axe and saves a screenshot (ADR-0020). A new CI job runs them.
- Keyboard and screen reader checks for MathField, the dialog, a busy button, the toggle and the confidence picker, and a manual checklist in `docs/accessibility/screen-reader-checklist.md`.
- A cliché lint (`scripts/lint-cliches.mjs`) for the banned design patterns, as part of `pnpm check`.

Changed:

- The web app uses the design system instead of M0's placeholder styles.

Fixed during M1 (found by the checks and the fresh-context review):

- MathField's hint and error now reach the textbox that has focus inside MathLive's shadow DOM, and a new error is announced.
- External links read "Childline (opens in a new tab)" with a space; the speed buttons' names match their visible text.
- A busy button keeps keyboard focus; the toggle's name is no longer read twice; toasts pause while hovered or focused; pressable chips are 44px tall.
- Feedback no longer relies on a live region that arrives already filled.

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
