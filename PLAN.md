# Eddy: delivery plan, M0 to M10

Status: **approved** (v0.1, approved 3 November 2026)

What we are building is in [SPEC.md](SPEC.md). Why each choice was made is in [DECISIONS.md](DECISIONS.md). This file says in what order, how, and what "done" means. Checkboxes are ticked as work lands, with evidence.

---

## How each milestone runs

1. **Plan:** re-read SPEC.md and this file; refine the milestone's checklist; note new decisions as ADRs.
2. **Failing tests first** for each behaviour.
3. **Implement.**
4. **Check:** unit, integration and typecheck for changed packages (the Stop hook enforces this from M0).
5. **Run the app** and drive it with Playwright: screenshots at 375, 768 and 1280 px in light, dark and reduced motion, plus axe.
6. **Look at the screenshots myself**, compare them with the design system, fix what I see.
7. **Fresh-context review** with `/code-review` and the `reviewer` subagent (plus `security-reviewer` or `pedagogy-critic` where relevant).
8. **Commit** with a conventional message on the milestone branch. Update CHANGELOG.md and the checkboxes here.
9. **Evidence block** at the end of the milestone: commands run, output summary, screenshot paths, open issues.

Git: one branch per milestone (`m0-foundations`, `m1-design-system` and so on), merged to `master` by pull request. I never push or open a PR without asking first.

I never claim something is done without the evidence. If a check fails or a step is skipped, the evidence block says so.

---

## Approval gates (I stop and ask)

| Gate | Needed by | What I need from you |
|---|---|---|
| Anthropic API key in local `.env` (never read by me) and CI secrets | M6 | The key, plus a ZDR arrangement with Anthropic before any real student data |
| ElevenLabs account, plan, DPA and a British voice | M6 | Account and key; voice choice |
| Remotion licence | M5 | Confirmation that 3 or fewer people work on Eddy commercially, or a licence decision |
| LLM evals in CI (they cost money) | M6 | OK to run labelled PR evals, and a monthly cap |
| AWS account and any deployment | M10 | Account, budget alarm, explicit go-ahead per deploy |
| Amazon SES production access | M10 | Sending domain |
| Edits to `/compliance` | Any | Explicit instruction each time (enforced by a permission rule) |
| Safeguarding lead and process | Before real students | A named person and professional advice |
| Legal review (DPIA, lawful basis, notices) | Before launch | A reviewer |
| Anything destructive or irreversible | Any | Deleting files or data, dropping or rewriting migrations, infra changes, paid services, licence changes, force-pushing, production |

---

## Timeline

About 17 weeks of work if done strictly in sequence; **about 14 to 15 weeks** with the parallel tracks below (each track can run in its own session and worktree, merged by PR).

```
Week:        1    2    3    4    5    6    7    8    9   10   11   12   13   14   15
Track A    [M0][---M3---][-----M5-----][--M6--][---M7---][---M8---][M9][--M10--]
Track B         [--M1--][--M2--][M4]
```

Critical path: M0, M3, M5, M6, M7, M8, M9, M10. M1 must finish before M5 starts; M2 and M4 before M7.

---

## Folder structure (refined from the brief)

```
/apps/web                 Next.js app (student, parent, admin) and the BFF
/packages/ui              design tokens, components, MathField, Maths (KaTeX), Storybook
/packages/scenes          primitives, templates, layout engine, Remotion compositions, static checks
/packages/schemas         zod schemas (SceneSpec, TutorMessage, LLM outputs) -> JSON Schema -> pydantic
/packages/api-client      TypeScript client generated from services/api OpenAPI
/services/api             FastAPI: domain API, learner model, tutor graph, safety, scenes, Alembic
/services/maths-core      FastAPI + SymPy: generation, equivalence, steps, distractors, verification
/workers/scene-check      Node + Playwright: keyframes and DOM layout confirmation
/curriculum               versioned YAML seeds and their JSON Schemas
/prompts                  versioned prompt files (semver front matter)
/config                   models.yaml and other non-secret runtime config
/evals                    golden sets, judges, thresholds.yaml, runners
/compliance               DPIA, DfE matrix, Children's Code checklist, governance, runbooks
/infra                    AWS CDK (TypeScript), eu-west-2
/scripts                  seed, precompute, banned-cliche lint, contrast report
/docs                     brief.md and other reference material
/.claude                  settings.json, hooks/, skills/, agents/, rules/
```

Changes from the brief: `services/tutor` becomes `services/api`; new `packages/api-client`, `workers/scene-check`, `config` and `docs`.

---

## M0: Foundations

Depends on: nothing. Estimate: 1 week.

Deliverables:

- [x] pnpm workspace (`apps/web`, `packages/*`, `workers/scene-check`) and uv workspace (`services/api`, `services/maths-core`). Node 22 and Python 3.12 pinned. `.gitattributes` with LF line endings, `.editorconfig`.
- [x] Next.js hello page, FastAPI hello endpoints for api and maths-core, and a web to api call carrying a signed service token (proves the BFF boundary from day one).
- [x] `docker compose`: PostgreSQL 16, Redis 7, S3Mock (S3) and ElasticMQ (SQS) in place of LocalStack (ADR-0016), Mailpit. One command starts everything.
- [x] Tooling: ESLint and Prettier, TypeScript strict, Vitest; ruff, mypy (strict for maths-core), pytest; Playwright with `@axe-core/playwright`.
- [x] Root commands: `pnpm check` (lint, typecheck, unit), `pnpm e2e`, `pnpm evals`, `uv run pytest`.
- [x] GitHub Actions CI: JS checks, Python checks, Playwright with axe, `cdk synth`.
- [x] `infra/` CDK app with network, data and services stacks for eu-west-2 that synthesise. No deploy.
- [x] `CLAUDE.md` under 200 lines: exact commands, gotchas, decisions not visible in code, definition of done.
- [x] `.claude/settings.json` permission rules: deny reading `.env*`; ask before editing anything under `compliance/`.
- [x] Hooks written in Node (they must run on Windows and on Linux CI):
  - PreToolUse guard denying `rm -rf` outside temp folders, dropping databases, Alembic against a non-local `DATABASE_URL`, and `git push --force`.
  - Stop hook running typecheck and unit tests for changed packages, blocking the end of a turn on failure.
- [x] `.claude/rules/` with `paths:` filters: maths-core verification rules, scenes colour semantics, prompt versioning, compliance edits.
- [x] `.claude/agents/`: `reviewer`, `pedagogy-critic`, `security-reviewer`. `.claude/skills/milestone-review`. (`/new-misconception` arrives in M2 and `/new-template` in M5, when their targets exist.)
- [x] `/compliance` skeletons: `DPIA.md`, `dfe-standards.md`, `childrens-code.md`, `governance.md`, `runbooks/`.
- [x] `CHANGELOG.md`.

Definition of done:

- [x] `pnpm check` and `uv run pytest` pass locally and in CI. (CI run 41906393567 on 4f6e484: both jobs passed.)
- [x] The hello page passes axe with zero serious or critical violations; screenshots at 3 viewports saved as CI artifacts. (CI artifact `e2e-artifacts`, 576 KB, run 41906393567.)
- [x] A scripted test shows the PreToolUse guard denying each listed command and the Stop hook blocking on a deliberately failing test.

---

## M1: Design system

Depends on: M0. Estimate: 1.5 weeks. Runs alongside M3.

Deliverables:

- [ ] Tokens as CSS variables for light, dark, dyslexia mode and reduced motion. Tailwind v4 theme mapped to our tokens only (no default palette available to components).
- [ ] Self-hosted fonts: Fraunces (variable), Atkinson Hyperlegible Next, Caveat, OpenDyslexic (optional download). Type scale with `clamp()`, tabular numerals.
- [ ] Components: Button, Link, Card, QuestionCard (margin rule, small-caps command word), WorkingPad, MathField (MathLive themed, custom Foundation keyboard), Maths (KaTeX with MathML), Feedback (kind misconception naming), ConfidencePicker, ProgressMap node, Chip, Toggle, Dialog and Sheet, Toast (no confetti), Skeleton, EmptyState, ErrorState, Tabs, form fields, Captions panel, Player controls.
- [ ] Storybook with every component in every theme, plus Playwright visual snapshots.
- [ ] Contrast test computing every token pair actually used, in both themes. Resolves the four issues flagged in SPEC.md section 11 (token changes proposed to you before they land).
- [ ] `scripts/lint-cliches`: fails on purple or blue-to-purple gradients, `backdrop-filter` or blur glass, emoji in UI copy, Inter-only font stacks, "Unlock your potential", sparkle icons, text shadows, neon glows, pill buttons outside toggles, confetti packages.

Definition of done:

- [ ] Contrast test passes for all pairs.
- [ ] Cliché lint passes and runs in CI.
- [ ] Storybook snapshots at 3 viewports in light, dark, reduced motion and dyslexia mode; I review them against the brief's section 6 and log findings.
- [ ] MathField works by keyboard only and announces its content to screen readers (automated checks plus a manual checklist for you).

---

## M2: Curriculum and data

Depends on: M0. Estimate: 1.5 weeks. Runs after M1 on track B.

Deliverables:

- [ ] SQLAlchemy models and Alembic migrations for every table in SPEC.md section 6, including the Auth.js tables and the append-only `audit_log`.
- [ ] `curriculum/` YAML with a JSON Schema per file:
  - the full DfE maths map (N1 to N16, A1 to A25, R1 to R16, G1 to G25, P1 to P9, S1 to S6) with tiers and visual suitability;
  - specification mappings for AQA 8300, Edexcel 1MA1 and OCR J560 (papers, marks, calculator rules), versioned;
  - prerequisite edges for the 13 MVP nodes and all their ancestors, with strengths;
  - at least 60 misconceptions (about 5 per MVP node), each with student-facing and teacher descriptions, detection rules in the rule language, an evidence source, and a planned re-check item family;
  - English: set texts with copyright status and display policy, question types, paraphrased level descriptors.
- [ ] Seed loader: idempotent upsert by natural key, with a dry-run diff mode.
- [ ] Read-only admin curriculum browser in `apps/web` (local-only access until M8 auth).
- [ ] `/new-misconception` skill (YAML entry, detection rule, re-check item, default scene stub).

Definition of done:

- [ ] DAG cycle test passes (and fails on a planted cycle).
- [ ] Seed runs twice; the second run reports zero changes.
- [ ] YAML schema validation runs in CI.
- [ ] Admin browser screenshots reviewed; axe clean.

---

## M3: Maths core

Depends on: M0 (misconception codes from M2 are wired in as they land). Estimate: 2 weeks.

Deliverables:

- [ ] MathJSON validator and SymPy converter (allow-list, size and depth limits). No `eval`, `sympify` on strings or `parse_expr` anywhere near user input.
- [ ] Equivalence engine: symbolic plus numeric sampling; answer-format rules (exact, dp, sf, units, simplest form).
- [ ] Step checker for expressions and equations.
- [ ] At least 3 item templates per MVP node, with parameter constraints that give clean numbers, command words, marks and calculator flags.
- [ ] Distractor generation from misconception rules, and the reverse: wrong answer to matched misconceptions.
- [ ] Verification endpoints for scene specs and tutor messages (claims lists).
- [ ] Golden set: 300 items in `evals/golden/maths`, with a hand-checked sample recorded.
- [ ] Hypothesis property tests for every template; a fuzz test for the MathJSON converter.

Definition of done:

- [ ] All property and fuzz tests pass; the converter never crashes and never executes input.
- [ ] Golden set 100% verified.
- [ ] p95 verification under 150 ms (benchmark output in the evidence block).
- [ ] Coverage at least 85%.

---

## M4: Learner model

Depends on: M2, M3. Estimate: 1 week.

Deliverables:

- [ ] BKT per node with aided-attempt weighting; prerequisite propagation; the two-failure prerequisite diagnostic.
- [ ] Elo for items and per-strand student ability; target-band item selection.
- [ ] FSRS scheduling with the `fsrs` package; rating from correctness, confidence, hints and time.
- [ ] Misconception state machine; node selection; interleaving rules.
- [ ] Synthetic student simulator (hidden mastery and hidden misconceptions).

Definition of done:

- [ ] Simulated learnable students reach SECURE within a bounded number of attempts.
- [ ] Simulated students with a persistent misconception are falsely marked SECURE less than 2% of the time.
- [ ] Prerequisite fallback triggers correctly after 2 failures.
- [ ] Coverage at least 85%.

---

## M5: Scenes engine

Depends on: M1, M3. Estimate: 2.5 weeks. Gate: Remotion licence confirmation.

Deliverables:

- [ ] SceneSpec v1 in zod, with generated JSON Schema and pydantic models.
- [ ] 11 primitives: number line, bar model, balance, coordinate grid, transformation grid, angle diagram, area model, Pythagoras squares, probability tree, data chart, place-value slider.
- [ ] Layout engine with font-metric text measurement and 16:9 and 4:5 region maps.
- [ ] Remotion compositions and the Player wrapper with all controls, captions, transcript, reduced-motion stepped mode and the static annotated diagram.
- [ ] Static checks library (overlap, off-canvas, margins, overflow, font size, contrast, colour roles, moving-element count, flash rate).
- [ ] 13 Tier D scenes, one per MVP node for its most common misconception, with reviewed narration templates.
- [ ] `workers/scene-check`: headless keyframes and DOM box confirmation.
- [ ] Admin scene gallery.
- [ ] `/new-template` skill.

Definition of done:

- [ ] All 13 default scenes pass static and DOM checks at 3 viewports in light, dark and reduced motion.
- [ ] Captions and transcript present for every scene; keyboard control of the Player works.
- [ ] Gallery passes axe; I review every keyframe screenshot.

---

## M6: Animation generation loop

Depends on: M3, M5. Estimate: 1.5 weeks. Gates: Anthropic key, ElevenLabs account, CI eval budget.

Deliverables:

- [ ] Claude client module in `services/api`: model routing from `config/models.yaml`, prompt registry with semver, `llm_call` logging, typed error handling and retries, prompt caching. Confirm structured-output support and cache minimums for both models against the current docs.
- [ ] `prompts/scene-spec.md` and `prompts/scene-critique.md`.
- [ ] Tier L generation with validation, verification, layout, static checks and structured-feedback retries.
- [ ] Background keyframe render and vision critique with cache eviction on failure.
- [ ] Narration: ElevenLabs with timestamps converted to word timings, S3 cache, Polly fallback adapter, captions-first until audio is ready.
- [ ] Cache and the precompute job (top 3 variants per seeded misconception).
- [ ] Eval suite: 100 misconception cases.

Definition of done:

- [ ] At least 95% of the 100 cases pass on the first or second attempt.
- [ ] Cache-hit p95 under 300 ms; Tier L cold p95 under 8 s (critique excluded, as it runs after serving).
- [ ] Cost per generated variant and per narration reported in the evidence block.

---

## M7: Tutor

Depends on: M4, M6. Estimate: 2 weeks.

Deliverables:

- [ ] LangGraph graph for Loop 1 with the Postgres checkpointer and every state and interrupt in SPEC.md section 7.1.
- [ ] `prompts/tutor.md` written from the brief's tutor behaviour spec; the hint ladder; structured `TutorMessage`.
- [ ] Safety pipeline: deterministic tripwires, Haiku 4.5 input and output classifiers, answer-leak check, maths verification, regeneration and templated fallback.
- [ ] Safeguarding flow with the static approved script, `safeguarding_event`, and a draft runbook (lands in `/compliance` with your go-ahead).
- [ ] Redis rate limits.
- [ ] Pedagogy eval: 50 scripted conversations, Haiku 4.5 judge, Opus 4.8 calibration sample.
- [ ] Loop 4 scaffolding: English marking output schemas and QWK, exact and adjacent agreement metrics with tests.

Definition of done:

- [ ] Pedagogy suite meets `evals/thresholds.yaml`.
- [ ] Zero answer leaks across every "demand the answer" scenario.
- [ ] Every distress scenario produces the approved response and a `safeguarding_event`.
- [ ] Prompt-injection scenarios do not change the tutor's behaviour.
- [ ] Measured tutor turn p95 and cost per session reported.

---

## M8: Student app

Depends on: M1, M5, M7. Estimate: 2 weeks.

Deliverables:

- [ ] Auth.js email magic links (Mailpit locally), invite codes, the age gate, child-friendly and full privacy notices with versioned acknowledgement.
- [ ] Onboarding, diagnostic, learning session (question card, MathField, confidence, feedback, scene player, tutor panel), review queue, progress map.
- [ ] Settings: accessibility preferences, download my data, delete my account, report a concern.
- [ ] Designed empty, error and loading states for every screen.

Definition of done:

- [ ] Playwright journeys: sign-up, diagnostic, a learning loop that includes a scene, a review.
- [ ] Screenshots at 375, 768 and 1280 px in light, dark and reduced motion, reviewed by me.
- [ ] axe clean on every page; the core journey completed by keyboard only.
- [ ] A manual screen reader checklist (NVDA and VoiceOver) prepared for you to run.

---

## M9: Parent dashboard and accounts

Depends on: M8. Estimate: 1 week.

Deliverables:

- [ ] Parent linking both ways with student acceptance, the permanent indicator, the "what my parent sees" preview, and unlinking by either side with notification.
- [ ] Parent dashboard (SPEC.md section 4.4), with every parent view written to `audit_log`.
- [ ] Data export and deletion jobs: immediate deactivation, completion within 30 days.

Definition of done:

- [ ] E2E tests for linking, unlinking, export and deletion.
- [ ] Children's Code checklist evidence complete for everything built so far.

---

## M10: Hardening and launch prep

Depends on: M9. Estimate: 1.5 weeks. Gates: AWS account and any deploy, SES.

Deliverables:

- [ ] Rate limit review; OWASP ASVS Level 2 checklist; an automated baseline security scan; a prompt-injection red-team pass.
- [ ] k6 load test against a production-like local stack.
- [ ] Cost dashboard from `llm_call`, narration and infrastructure estimates.
- [ ] DPIA and DfE standards matrix complete; Children's Code checklist complete; governance roles; runbooks for incidents, safeguarding and data breaches.
- [ ] Staging deployment plan with CDK. Deploy only with your explicit go-ahead.

Definition of done:

- [ ] Launch checklist signed off by you.

---

## M11 (after the MVP): English formative feedback

Language Paper 1 Q2 to Q4 on public-domain extracts (*A Christmas Carol*, *Jekyll and Hyde*, *Macbeth*), with a calibration study against a teacher-marked set. Levels shown only above confidence 0.7, never as a definitive grade.

---

## Evidence log

Each milestone appends its evidence block here when it closes.

### M0: Foundations (4 November 2026)

Environment: Windows 11, Node 22.15, Python 3.12.10, pnpm 10.6.5, uv 0.11.14, Docker 28.1.

**Checks run (final run, after review fixes)**

| Command | Result |
|---|---|
| `pnpm check` | Exit 0. ESLint clean (root and 7 packages); Prettier clean; dash check clean over 115 text files; typecheck clean (root and 7 packages); Vitest 26 tests passed across 7 packages; hook tests 140 passed; ruff and ruff format clean; mypy strict clean (10 files); pytest 32 passed. |
| `pnpm e2e` | 27 passed: 3 tests across 9 projects (375, 768 and 1280 px in light, dark and reduced motion). Zero serious or critical axe violations. Security headers checked. |
| `pnpm --filter @eddy/infra synth` | 3 stacks (Network, Data, Services) in eu-west-2. No AWS lookups, no warnings. |
| `docker compose up -d --wait` | Postgres 16, Redis 7.4, S3Mock (bucket `eddy-assets`), ElasticMQ and Mailpit all up. |
| `pnpm dev` smoke test with `pnpm keys:dev` keys | Web 200 with the API "Connected"; api and maths-core health OK; both reject calls without a token (401). (Run before the review fixes; the E2E run covers the same path afterwards.) |
| `pnpm keys:dev` | Refuses to overwrite existing files without `--force`; writes all three with it. Prints no values. |

**Screenshots**: `e2e-artifacts/screenshots/hello-{mobile,tablet,desktop}-{light,dark,reduced-motion}.png` (git-ignored locally; CI uploads them). Reviewed by eye. Fixed: the margin rule stopped short of full height on tablet and desktop, and the subject id broke across lines on mobile.

**Fresh-context reviews** (general and security, run as subagents with the `reviewer` and `security-reviewer` briefs). The security review found no critical or high issues. Fixed from both:

- CRLF line endings in four files written by edit scripts; ruff now enforces LF.
- Next 16 writes `apps/web/AGENTS.md` under `next dev`, which failed the dash check: disabled with `agentRules: false`.
- `.gitignore` now covers every `.env` variant plus key files and `.claude/settings.local.json`.
- services/api: verification key loaded once and checked to be a P-256 public key; 5 s clock leeway; 60 s lifetime enforced against the current time; strict claim validation, so malformed signed tokens give 401 rather than 500; routes name the roles they accept (ADR-0018); secrets held as `SecretStr`.
- maths-core: token compared as bytes (no 500 on non-ASCII input); tokens under 32 characters or equal to the example placeholder are refused; `SecretStr`.
- apps/web: `server-only` on the env and token modules (Vitest aliases it); role and subject checked at runtime before signing; a clear message for bad keys; the system check hidden from production visitors; HSTS and COOP headers; `next dev` bound to 127.0.0.1.
- Guard hook: now sees commands inside if/then/do, script blocks, subshells, `$(...)`, `bash -lc`, `xargs`, `timeout` and `find -exec`. It blocks recursive deletes without `-f`, rimraf, rmtree and rmSync, `..` escapes from temp folders, every `git clean -f`, mirror and deleting pushes, `docker system prune --volumes`, Alembic through `export`, lowercase names, `--env-file` or `-x url`, recursive grep or Select-String over directories, and more ways of reading `.env` files. It no longer blocks heredoc or here-string bodies, commit messages, `process.env`, search patterns or copying out of `compliance/`. It fails closed.
- Stop hook: the warning after 3 blocks now reaches the user; checks are skipped when nothing changed since the last pass; `changedFiles` is tested against a real git repo.
- `scripts/dev-keys.mjs`: owner-only file mode, and it never overwrites without `--force`.
- Infra: account-agnostic synth (no AWS lookups); the VPC default security group is locked down; old asset versions expire after 30 days.
- compose: Postgres and Redis pinned to patch versions.
- The dash check scans every text file instead of a fixed list of extensions.

**Recorded, not fixed in M0**

- GitHub Actions pinned to major tags, not commit SHAs (M10).
- FastAPI `/docs` and `/openapi.json` enabled on the private services (M10).
- Strict nonce-based CSP deferred to M8, as planned.
- RDS final-snapshot retention to be recorded in the DPIA.
- Two `.claude/settings.json` suggestions are waiting on Abdulhamid's decision: widen the Read deny list to every `.env` variant, and extend the guard hook to other shell-capable tools.

**Deviations**: ADR-0016 (S3Mock and ElasticMQ instead of LocalStack), ADR-0017 (TypeScript 5.9 and ESLint 9), ADR-0018 (the `system` role and route role lists).

**CI**: the first run (41906393567, commit 4f6e484, PR #1) passed both jobs, "Lint, typecheck, unit tests, synth" and "Playwright E2E and axe", and uploaded the `e2e-artifacts` bundle (576 KB). Every M0 definition-of-done item is now met.
