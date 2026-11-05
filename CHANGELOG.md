# Changelog

## Unreleased

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
