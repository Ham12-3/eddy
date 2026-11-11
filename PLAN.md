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
| ElevenLabs account, plan, DPA and a British voice | Deferred (ADR-0029) | Account and key; voice choice, when a paid voice is wanted |
| Remotion licence | M5 | Resolved: no licence, so scenes use our own renderer (ADR-0027) |
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
/packages/scenes          primitives, templates, layout engine, time-based renderer and Player, static checks
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

- [x] Tokens as CSS variables for light, dark, dyslexia mode and reduced motion. Tailwind v4 theme mapped to our tokens only (no default palette available to components).
- [x] Self-hosted fonts: Fraunces (variable), Atkinson Hyperlegible Next, Caveat, OpenDyslexic (optional download). Type scale with `clamp()`, tabular numerals.
- [x] Components: Button, Link, Card, QuestionCard (margin rule, small-caps command word), WorkingPad, MathField (MathLive themed, custom Foundation keyboard), Maths (KaTeX with MathML), Feedback (kind misconception naming), ConfidencePicker, ProgressMap node, Chip, Toggle, Dialog and Sheet, Toast (no confetti), Skeleton, EmptyState, ErrorState, Tabs, form fields, Captions panel, Player controls.
- [x] Storybook with every component in every theme, plus Playwright visual snapshots. (Screenshots plus axe for every story; pixel-diff baselines deferred, ADR-0020.)
- [x] Contrast test computing every token pair actually used, in both themes. Resolves the four issues flagged in SPEC.md section 11 (token changes proposed to you before they land).
- [x] `scripts/lint-cliches`: fails on purple or blue-to-purple gradients, `backdrop-filter` or blur glass, emoji in UI copy, Inter-only font stacks, "Unlock your potential", sparkle icons, text shadows, neon glows, pill buttons outside toggles, confetti packages.

Definition of done:

- [x] Contrast test passes for all pairs.
- [x] Cliché lint passes and runs in CI.
- [x] Storybook snapshots at 3 viewports in light, dark, reduced motion and dyslexia mode; I review them against the brief's section 6 and log findings.
- [x] MathField works by keyboard only and announces its content to screen readers (automated checks plus a manual checklist for you). (Automated checks pass; the manual checklist is in `docs/accessibility/screen-reader-checklist.md` and has not been run yet.)

---

## M2: Curriculum and data

Depends on: M0. Estimate: 1.5 weeks. Runs after M1 on track B.

Deliverables:

- [x] SQLAlchemy models and Alembic migrations for every table in SPEC.md section 6, including the Auth.js tables and the append-only `audit_log`.
- [x] `curriculum/` YAML with a JSON Schema per file:
  - the full DfE maths map (N1 to N16, A1 to A25, R1 to R16, G1 to G25, P1 to P9, S1 to S6) with tiers and visual suitability;
  - specification mappings for AQA 8300, Edexcel 1MA1 and OCR J560 (papers, marks, calculator rules), versioned;
  - prerequisite edges for the 13 MVP nodes and all their ancestors, with strengths;
  - at least 60 misconceptions (about 5 per MVP node), each with student-facing and teacher descriptions, detection rules in the rule language, an evidence source, and a planned re-check item family;
  - English: set texts with copyright status and display policy, question types, paraphrased level descriptors.
- [x] Seed loader: idempotent upsert by natural key, with a dry-run diff mode.
- [x] Read-only admin curriculum browser in `apps/web` (local-only access until M8 auth).
- [x] `/new-misconception` skill (YAML entry, detection rule, re-check item, default scene stub).

Definition of done:

- [x] DAG cycle test passes (and fails on a planted cycle).
- [x] Seed runs twice; the second run reports zero changes.
- [x] YAML schema validation runs in CI.
- [x] Admin browser screenshots reviewed; axe clean.

---

## M3: Maths core

Depends on: M0 (misconception codes from M2 are wired in as they land). Estimate: 2 weeks.

Deliverables:

- [x] MathJSON validator and SymPy converter (allow-list, size and depth limits). No `eval`, `sympify` on strings or `parse_expr` anywhere near user input.
- [x] Equivalence engine: symbolic plus numeric sampling; answer-format rules (exact, dp, sf, units, simplest form).
- [x] Step checker for expressions and equations.
- [x] At least 3 item templates per MVP node, with parameter constraints that give clean numbers, command words, marks and calculator flags.
- [x] Distractor generation from misconception rules, and the reverse: wrong answer to matched misconceptions.
- [ ] Verification endpoints for scene specs and tutor messages (claims lists).
- [x] Golden set: 300 items in `evals/golden/maths`, with a hand-checked sample recorded.
- [x] Hypothesis property tests for every template; a fuzz test for the MathJSON converter.

Definition of done:

- [x] All property and fuzz tests pass; the converter never crashes and never executes input.
- [x] Golden set 100% verified.
- [x] p95 verification under 150 ms (benchmark output in the evidence block).
- [x] Coverage at least 85%.

---

## M4: Learner model

Depends on: M2, M3. Estimate: 1 week.

Deliverables:

- [x] BKT per node with aided-attempt weighting; prerequisite propagation; the two-failure prerequisite diagnostic.
- [x] Elo for items and per-strand student ability; target-band item selection.
- [x] FSRS scheduling with the `fsrs` package; rating from correctness, confidence, hints and time.
- [x] Misconception state machine; node selection; interleaving rules.
- [x] Synthetic student simulator (hidden mastery and hidden misconceptions).

Definition of done:

- [x] Simulated learnable students reach SECURE within a bounded number of attempts. (All 5,000 within 60; median 7.)
- [x] Simulated students with a persistent misconception are falsely marked SECURE less than 2% of the time. (1.32% or less when the mistake shows on at least 80% of the items that could reveal it, on free answers and choice items; less consistent misconceptions are higher, see the evidence block and ADR-0026.)
- [x] Prerequisite fallback triggers correctly after 2 failures. (Unit tests for the count, the session reset, explained failures and once per session; the simulator offers it in nearly every session to students who cannot learn.)
- [x] Coverage at least 85%. (90.6%, gated in CI.)

---

## M5: Scenes engine

Depends on: M1, M3. Estimate: 3 weeks (half a week more than planned, for our own renderer). No gate (ADR-0027).

Deliverables:

- [x] SceneSpec v1 in zod, with generated JSON Schema and pydantic models.
- [x] 11 primitives: number line, bar model, balance, coordinate grid, transformation grid, angle diagram, area model, Pythagoras squares, probability tree, data chart, place-value slider.
- [x] Layout engine with font-metric text measurement and 16:9 and 4:5 region maps.
- [x] Scene renderer (each scene a pure function of time, ADR-0027) and the Player with all controls, captions, transcript, reduced-motion stepped mode and the static annotated diagram.
- [x] Static checks library (overlap, off-canvas, margins, overflow, font size, contrast, colour roles, moving-element count, flash rate).
- [x] 13 Tier D scenes, one per MVP node for its most common misconception, with reviewed narration templates.
- [x] `workers/scene-check`: headless keyframes and DOM box confirmation.
- [x] Admin scene gallery.
- [x] `/new-template` skill.

Definition of done:

- [x] All 13 default scenes pass static and DOM checks at 3 viewports in light, dark and reduced motion. (Static and DOM checks on every beat at 288, 343, 640, 704 and 1152 px in light and dark, plus all 104 golden variants; reduced motion changes only transitions, and the gallery tests run at 375, 768 and 1280 px in light, dark and reduced motion.)
- [x] Captions and transcript present for every scene; keyboard control of the Player works. (End-to-end tests for all 13 scenes at every viewport and mode, plus 8 player unit tests.)
- [x] Gallery passes axe; I review every keyframe screenshot. (Axe has zero serious or critical findings at every viewport and mode. Every beat of every scene was looked at in light at 1152 and 288 px, by the scene writers and twice by the pedagogy critic; dark and the other widths were sampled. The DOM check confirms every keyframe's text boxes.)

---

## M6: Animation generation loop

Depends on: M3, M5. Estimate: 1.5 weeks. Gates: Anthropic key, CI eval budget. (No ElevenLabs account: the device's own voice until a paid voice is chosen, ADR-0029.)

Deliverables:

- [x] Claude client module in `services/api`: model routing from `config/models.yaml`, prompt registry with semver, `llm_call` logging, typed error handling and retries, prompt caching. Confirm structured-output support and cache minimums for both models against the current docs. (Confirmed: both Opus 4.8 and Haiku 4.5 support structured outputs; the minimum cacheable prefix is 1,024 tokens on Opus 4.8 and 4,096 on Haiku 4.5.)
- [x] `prompts/scene-spec.md` and `prompts/scene-critique.md`. (Rewritten after the pedagogy review; not yet run against Claude.)
- [x] Tier L generation with validation, verification, layout, static checks and structured-feedback retries. (Every reviewed scene goes through the real scene engine and maths-core with no problems; the loop is tested with a stand-in for Claude.)
- [x] Background keyframe render and vision critique with cache eviction on failure. (The keyframe endpoint was run for real; the critique is tested with a stand-in and has not yet called Claude.)
- [x] Narration: the device's own voice in the Player (ADR-0029). On-device voices only, each beat held until its line is spoken, captions always, and one interface so a paid voice can replace it.
- [x] Cache and the precompute job (top 3 variants per seeded misconception). (Built and dry-run; the job has not yet been run against Claude.)
- [x] Eval suite: 100 misconception cases. (Cases and runner built; not yet run live.)

Definition of done:

- [x] At least 95% of the 100 cases pass on the first or second attempt. (97 of 100 at medium effort with prompt 1.1.0, the configuration kept; 96 of 100 at high effort.)
- [x] Cache-hit p95 under 300 ms; Tier L cold p95 under 8 s (critique excluded, as it runs after serving). (Cache hit 38.4 ms p95: met. Cold p95 16.6 s at medium effort, over 8 s because one Opus 4.8 call takes 12.2 s at p95. You accepted this on 7 November 2026, as Tier D shows at once; the target is now 20 s while Tier D plays, SPEC.md section 7.2.)
- [x] Cost per generated variant reported in the evidence block (narration on the device costs nothing, ADR-0029). (2.5p a variant at medium effort; about 4p more when the critique reviews it.)

---

## M7: Tutor

Depends on: M4, M6. Estimate: 2 weeks.

Deliverables:

- [x] LangGraph graph for Loop 1 with the Postgres checkpointer and every state and interrupt in SPEC.md section 7.1. (The checkpointer runs inside each request's transaction; tested on the real database.)
- [x] `prompts/tutor.md` written from the brief's tutor behaviour spec; the hint ladder; structured `TutorMessage`. (Version 1.6.0, tuned on the live eval.)
- [x] Safety pipeline: deterministic tripwires, Haiku 4.5 input and output classifiers, answer-leak check, maths verification, regeneration and templated fallback. (Tested with a stand-in for Claude, and run live in the pedagogy eval.)
- [ ] Safeguarding flow with the static approved script, `safeguarding_event`, and a draft runbook (lands in `/compliance` with your go-ahead). (The flow and events are built and evaluated; the runbook draft waits for your go-ahead, and the script and tripwires for Eddy's safeguarding lead.)
- [x] Redis rate limits. (With daily cost guards for the tutor's Claude calls.)
- [x] Pedagogy eval: 50 scripted conversations, Haiku 4.5 judge, Opus 4.8 calibration sample. (72 conversations, run live.)
- [x] Loop 4 scaffolding: English marking output schemas and QWK, exact and adjacent agreement metrics with tests.

Definition of done:

- [x] Pedagogy suite meets `evals/thresholds.yaml`. (The final run meets every threshold: turn p95 is 11.0 s against the 12 s target you accepted on 10 November 2026, which was 3.5 s. The judge's calibration, kappa 0.843, is from the run before, with the same judge prompt and models.)
- [x] Zero answer leaks across every "demand the answer" scenario. (And in all 72 conversations, by the independent check and the judge.)
- [x] Every distress scenario produces the approved response and a `safeguarding_event`. (14 of 14, each screened 3 times. The script is still a draft until Eddy's safeguarding lead approves it.)
- [x] Prompt-injection scenarios do not change the tutor's behaviour. (7 of 7.)
- [x] Measured tutor turn p95 and cost per session reported. (11.0 s at p95 and 6.1 s at p50 per student input; about £0.33 a session.)

---

## M8: Student app

Depends on: M1, M5, M7. Estimate: 2 weeks.

Deliverables:

- [ ] Auth.js email magic links (Mailpit locally), invite codes, the age gate, child-friendly and full privacy notices with versioned acknowledgement.
- [ ] Before any real sign-up (ADR-0024): a migrator role and a runtime role with SELECT and INSERT only on `audit_log`, tested; the age check before any email is stored, and expired verification tokens purged; the custom Auth.js adapter (ADR-0023) storing session token hashes; retention for `audit_log` and `safeguarding_event` from the DPIA.
- [ ] Onboarding, diagnostic, learning session (question card, MathField, confidence, feedback, scene player, tutor panel), review queue, progress map. The tutor panel shows "Eddy is writing" while a reply is checked (up to 12 s at p95).
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
- [ ] Tutor latency revisited with the pedagogy eval: a faster model for `tutor.turn` (ADR-0005) or two drafts written at once.
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

### M1: Design system (5 November 2026)

Environment: Windows 11, Node 22.15, pnpm 10.6.5, uv 0.11.14. Branch `m1-design-system`, stacked on M0; PR #2.

**Decisions with Abdulhamid during M1**: brand colours stay paper, ink and orange. Light accent #F08C4A and dark accent #FFA552, both fills with dark text and at least 30 CIELAB units from the misconception red. Dark highlighter #6B5410; new `--field-border` and `--on-accent` tokens (ADR-0019). Visual checks are screenshots plus axe, not pixel diffs (ADR-0020).

**Checks run (final run)**

| Command | Result |
|---|---|
| `pnpm check` | Exit 0. ESLint, Prettier, dash check (163 files), cliché lint (84 files); typecheck of every project; Vitest 118 tests (98 in `ui`, including 68 colour-pairing checks across light, dark and dyslexia); 186 hook and lint-rule tests; ruff, strict mypy, 32 pytest tests. |
| `pnpm e2e:storybook` | 25 stories in 14 modes: 3 widths in light, dark, reduced motion and dyslexia, plus a forced dark theme and dyslexia on dark. 350 story checks passed with zero serious or critical axe violations, and a screenshot each. The 6 keyboard and screen reader checks pass (MathField by keyboard with its name, hint and error on the focused textbox; label click; dialog focus and Escape; busy button focus; toggle; confidence picker). The first full run failed only the dialog check, whose rule was stricter than native `<dialog>` behaviour; it was corrected and rerun. |
| `pnpm e2e` (web app on the design system) | 27 passed. |
| CI run 42000300185 on b1be67e (PR #2) | All three jobs passed, including the new "Design system stories, axe and screenshots" job on Linux; `storybook-artifacts` uploaded (19.6 MB). |

**Screenshot review** (gallery and new stories, by eye): light, dark, phone-width dyslexia, the Foundation keyboard and the open sheet in dark mode. Fixed: KaTeX's italic `\pounds` (now an upright £), and the hello page's subject id wrapping on mobile after the move to the design system. Noted: the degree key's symbol is small on the on-screen keyboard.

**Fresh-context review** (`reviewer` agent). Fixed:

- MathField's hint and error never reached the focused textbox inside MathLive's shadow DOM (high). They are now set on it as `aria-description` and `aria-invalid`, a new error is announced through a live region, and the test checks the element that has focus.
- Feedback relied on a live region that arrives already filled: now there is a `LiveRegion` to keep mounted.
- Pressable chips were 32px tall (now 44px). A busy button dropped keyboard focus (now `aria-disabled`). The toggle's name was read twice. Toasts disappeared under focus (now they pause). Tabs with an unknown default were unreachable.
- The SPEC.md section 11 table had stale rows contradicting ADR-0019.
- Cliché lint gaps (Inter through next/font, Heroicons sparkles, confetti package variants, React shadow styles, `drop-shadow()`, `rounded-[9999px]`, named colours, .js/.jsx/.svg files) and false positives (`href="#add"`, the copyright sign): all covered by tests now.
- Missing states (open sheet, visible toast, the on-screen keyboard) now have stories; the theme override and dyslexia on dark have their own projects.
- KaTeX error colour, placeholder contrast, real OpenDyslexic bold, the 150ms reduced-motion cross-fade, the dialog backdrop in dark mode, `sideEffects` and barrel-import optimisation for `@eddy/ui`, the label click on MathField, a units row on the Foundation keyboard, and test hygiene.

**Recorded, not fixed in M1**

- MathLive's own animations sit in its shadow DOM, out of reach of the reduced-motion rules.
- Hover colour mixes (`bg-ink/85`, `bg-accent/85`) are not in `contrast-pairs.ts`; computed at 10.1:1 and 7.3:1.
- `aria-description` support varies by screen reader; the manual checklist covers it.
- The manual screen reader checklist has not been run yet (needs a person with NVDA and VoiceOver).

### M2: Curriculum and data (5 November 2026)

Environment: Windows 11, Node 22.15, pnpm 10.6.5, uv 0.11.14, PostgreSQL 16.15 in Docker. Branch `m2-curriculum-data`, stacked on M1; PR #3.

**What landed**: 32 tables and two migrations (0001 schema, 0002 review fixes); the curriculum YAML (97 DfE nodes, 6 specifications, 71 prerequisite edges, 13 topics, 85 misconceptions, 28 set texts, 16 English question types with 66 level descriptors), each file with a JSON Schema; the seed loader with dry run; the read-only curriculum API and admin browser; the `/new-misconception` skill; ADR-0021 to ADR-0024.

**Checks run (final run)**

| Command | Result |
|---|---|
| `EDDY_REQUIRE_DB=1 pnpm check` | Exit 0. ESLint, Prettier, dash check (218 files), cliché lint (93 files); typecheck of every project; Vitest (ui 98, web 9, infra 6, scenes 3, schemas 2, scene-check 2, api-client 1); 186 hook and lint-rule tests; ruff, strict mypy (33 files), 87 pytest tests including the database tests. |
| `pnpm e2e` | 81 passed across 3 widths in light, dark and reduced motion: the hello page, the curriculum browser and a node page (axe: zero serious or critical), unknown nodes as 404, and a second production server without the preview flag answering every admin path with a bare 404 for HTML and RSC requests. Run once more after a type-only fix to that test file. |
| `pnpm db:seed` twice on the dev database | First run: 99 changes (the review edits, 2 misconceptions retired). Second run: 0 changes. |
| `pnpm curriculum:check` | Valid. Planted faults are caught by tests: a cycle, an unknown code, an undeclared ancestor, a duplicate key, an alias, a code with a trailing newline, an impossible date, an en dash, an in-copyright text shown in full. |
| Migrations | Up, down to base and up again; 0002 down and up again; the models match the migrations (autogenerate finds no difference); the audit trigger refuses UPDATE, DELETE and TRUNCATE. |

**Screenshot review**: the curriculum browser and a node page at 375, 768 and 1280 px in light, dark and reduced motion, by eye. Fixed: rules on the node facts broke at the column gap on wide screens; evidence showed raw keys (`practice`) instead of words; topic numbers ran into their titles for screen readers.

**Fresh-context reviews**: `reviewer`, `security-reviewer` and `pedagogy-critic`. Fixed:

- High (security): in a production build the admin layout's `notFound()` did not stop its pages rendering, so the 404 still carried the curriculum and every visit signed a token. Now gated in `src/proxy.ts`, in every page and `generateMetadata`, and before any token is signed, and proven by the gated E2E server. The preview signs as `admin`, not `system` (ADR-0018 amended), and only runs under `next dev` or with the flag.
- The seed left edges touching a removed node, and removed rows stayed live. Edges are now deleted, and removed rows are retired and no longer served.
- Deleting an account would have deleted its safeguarding events and the record of the erasure request (migration 0002: RESTRICT and SET NULL). Session tokens are stored as hashes, OAuth token columns are gone, and parent links and invite codes have integrity checks.
- Students and parents no longer receive teacher wording or detection rules.
- E2E migrated and reseeded the developer's own database; it now has its own `eddy_e2e`. The seed refuses a non-local database without `--allow-remote`.
- Misconception text: student wording no longer uses one item's numbers or states an answer; one statement of wrong maths fixed; two duplicate misconceptions replaced; order of operations moved to N3; detection types corrected (two structure rules, two new distractor rules). English level descriptors moved further from the board's wording, and the Literature ladder realigned by one level.
- N16 is Foundation with a Higher extension and G8 is Higher only; two modern set texts added.

**Recorded, not fixed in M2**

- Audit log: the trigger is in place, but the database grants SPEC.md 6.5 also asks for (a runtime role with SELECT and INSERT only) arrive in M8 before any real row, with the age check before email storage and the retention rules (ADR-0024).
- Evidence: 43 of 85 misconceptions are tagged `practice` (widely documented, no specific citation yet). The admin page says "to confirm against Eddy's own data".
- N16 and G8 tiers follow two reviewers' reading of the DfE content; check them against the DfE PDF. The modern set texts are not yet checked against the board's current list (2024 additions).
- The node page has no loading state: a route-level loading boundary would stream a 200 before an unknown code could answer 404. It blocks on one fast API call instead.
- No `pip-audit` or `pnpm audit` step in CI yet (M10 hardening).

**CI**: the first run on this branch (42049930737, commit acbfdcd, PR #3) passed all three jobs. The checks job ran "Curriculum YAML matches its schemas", `pnpm check` with the database tests required against a Postgres service, and "API client matches services/api". E2E ran against its own `eddy_e2e` database. Every M2 definition-of-done item is now met.

### M3: Maths core (5 November 2026)

Environment: Windows 11, Node 22.15, pnpm 10.6.5, uv 0.11.14, Python 3.12.10, SymPy 1.14.0, Hypothesis and pytest-cov (dev). Branch `m3-maths-core`, stacked on M2; PR #4.

**What landed**: the MathJSON converter and its limits; equivalence, answer formats (exact, decimal places, significant figures, fraction, decimal, mixed number, standard form, simplest form, units), step checking, and claim verification with an answer-leak check; 87 templates (every MVP node at least three times, every re-check family covered); 82 distractor rules and 2 structure rules, each matching the YAML and each with a hand-worked example; five HTTP routes behind the service token, with a byte-counted 64 KB limit and no public docs; the 300-item golden set with a 30-item hand check; the benchmark and coverage gate in CI; ADR-0025.

**Checks run (final run)**

| Command | Result |
|---|---|
| `EDDY_REQUIRE_DB=1 pnpm check` | Exit 0. Lint, dash check (246 files), cliché lint, typecheck, Vitest (ui 98, web 9, infra 6 and the rest), 186 hook and lint-rule tests, ruff, strict mypy (59 files), 632 pytest tests (78 API, 554 maths-core). |
| maths-core suite with coverage | 554 passed. Property tests: 40 seeds per template. Fuzz: 1,500 random JSON trees through the converter; 400 hostile maths trees and 200 towers of powers through answer checks, step checks and claims, each under 3 seconds. Coverage 92%. |
| `pnpm evals` | maths golden set: 300/300 items verified (300 distinct items, 87 templates). |
| `pnpm maths:bench` | 1,489 verifications including expansion, quadratic solving and symbolic claims: p50 1.19 ms, p95 2.49 ms, max 25.04 ms. |
| `pnpm e2e` | 81 passed (the hello page, the curriculum browser with its gated production server, at 3 widths in light, dark and reduced motion; axe zero serious or critical). |

**Hand check**: every tenth golden item (30) worked out by hand by Claude, 30 of 30 correct (`evals/golden/maths/HAND-CHECK.md`). The first hand check, before the review, passed a wrong rule (one third coded as n/10); the file records it, and every rule now has an independent worked example. Not yet checked by a person.

**Fresh-context reviews**: `reviewer` and `security-reviewer`. Fixed:

- High: wrong answers that crashed the API (recurring decimals, square roots of negatives); "one third is 0.3" coded as n/10; correct answers marked wrong (unsimplified probabilities, an unrounded grouped mean); requests that took seconds (nested powers, high-degree equations), and the security review's sharper version: a letter in a power that froze the service for tens of seconds. Powers must now be numbers, numbers stay under 400 digits, expressions under degree 12 with at most 3 letters and 4 roots, and only polynomial or rational equations are solved.
- Medium: false givens and first steps came back verified (now checked against the answer); fixed public sample points and a 10^-9 tolerance on exact inputs (now fresh points and exact comparison for rational expressions); answer-leak bypasses; mixed numbers accepted in wrong forms; distractors not written in the answer's form; tests that could not fail (now a hand-worked example per rule); a benchmark that skipped the slow paths.
- Low: the body limit trusted the header (now counted as bytes arrive); public `/docs`; a 500 on long decimals, nested tuples and wrapped relations; the cube root of a negative was complex; odd stems ("7/1", "+ 0", unsimplified fractions, unclear scales).

**Recorded, not fixed in M3**

- Verification endpoints for scene specs: the claims endpoint exists, but checking a SceneSpec's maths through it is wired in M5, so that box stays unticked.
- No process sandbox with a hard time limit per verification yet (M10 hardening). The input limits are the only bound today; the fuzz tests hold every path under 3 seconds.
- The leak check only sees the maths a tutor message lists; services/api must send the item every time and scan the prose (M7). On choice questions any mention of the answer counts, so the tutor uses a templated hint there.
- Items with a `diagram` need the scene primitives (M5) before a student sees them.
- Equivalence accepts a non-rational answer when two fresh sets of 20 points agree and `simplify` cannot decide (ADR-0025).
- MathLive's exact MathJSON for units and currency is not yet pinned against MathLive itself (M8). Clients must send numbers as `{"num": "<as typed>"}`.

**CI**: the first run on this branch (42050023947, commit 6982bde, PR #4) passed all three jobs, including the new steps "Maths golden set (100% required)", "maths-core coverage (85% or more)" and "Verification latency (p95 under 150 ms)" on Linux.

### M4: Learner model (5 November 2026)

Environment: Windows 11, Node 22.15, pnpm 10.6.5, uv 0.11.14, Python 3.12.10, fsrs 6.3.2 (MIT). Branch `m4-learner-model`, stacked on M3; no PR yet.

**What landed**: `eddy_api.learner`, pure functions with no database access: BKT, node mastery and the two-failure diagnostic (`mastery.py`), Elo and item choice (`elo.py`), FSRS cards and ratings (`review.py`), the misconception state machine (`misconceptions.py`), node selection, interleaving and today's plan (`planner.py`), and the synthetic student simulator with its report (`simulator.py`, `pnpm learner:report`). The coverage gate `pnpm learner:coverage` runs in CI. ADR-0026 records every rule beyond SPEC.md and the evidence behind it. Two maths-core bugs found by M3's own fuzz and sampling tests during these runs are fixed (see the CHANGELOG).

**Checks run (final run)**

| Command | Result |
|---|---|
| `EDDY_REQUIRE_DB=1 pnpm check` | Exit 0. Lint, Prettier, dash check (258 files), cliché lint, typecheck, Vitest (ui 98, web 9, infra 6 and the rest), 186 hook and lint-rule tests, ruff, mypy (71 files), 717 pytest tests (161 API, 556 maths-core). |
| `pnpm learner:coverage` | 83 passed; coverage 90.6% (every module 99 to 100% except the report script). |
| `pnpm learner:report` | The table below; seeded, so it repeats exactly. |
| `pnpm evals`, `pnpm maths:bench`, `pnpm maths:coverage` | 300/300 golden items verified; p95 1.99 ms over 1,489 verifications; maths-core coverage 93.3%. |
| `pnpm e2e` | 81 passed, axe zero serious or critical. M4 changes no page, so the screenshots are M3's. |

**Synthetic students** (`pnpm learner:report`; free answers unless stated)

| Population | Result |
|---|---|
| Learnable (learn 0.1 to 0.3), 5,000 | All SECURE within 60 attempts: median 7, 99th percentile 31, max 57. 1.00% secured by lucky guessing. |
| Learnable, two-option items, 2,500 | All SECURE within 120: median 11, 99th percentile 66, max 101. 1.56% by lucky guessing. |
| Already know it, two-option items, every slip on the distractor, 2,500 | 21.1% shown a scene for a slip (46% if every slip counted as a full match). |
| Persistent misconception, 80% to 100% of revealing items | Falsely SECURE 1.32% at 80%, 0.20% at 90%, 0.00% at 100%; 0.40% on two-option and 1.32% on four-option items without confidence ratings. |
| Persistent misconception, less consistent | Falsely SECURE 2.76% at 70%, 8.04% at 60%, 16.68% at 50%. |
| Never learn the node | Falsely SECURE 21.64% when right by chance 1 time in 5, 2.96% at 1 in 10, 0.28% at 1 in 20, 8.08% on two-option items; the prerequisite diagnostic is offered in nearly every session. |

**Fresh-context reviews**: `reviewer`, `pedagogy-critic`, then `reviewer` again on the fixes. Fixed:

- High: with the real curriculum, 17 ancestor nodes have no item templates and would have locked most of the MVP. A root node falling due for review would also have locked everything after it. The gate now accepts secured nodes and looks through nodes without items to the practisable ones behind them; a test walks a perfect student through the real graph and templates. Also fixed: a review that had fallen due was cleared by any answer, even a wrong one.
- High: every slip on a two-option item became a misconception (guessing now follows the number of options, and an unsure first pick is only a weak suspicion). Misconceptions no item can reveal blocked SECURE for ever. A diagnostic match confirmed a misconception on first sight, against SPEC.md 4.1. The two-failure diagnostic ran on noise across sessions and found nothing when every prerequisite was secure.
- Medium: a well-practised node survived four wrong answers (BKT now caps at 0.99, and 2 unexplained wrong answers in a session lapse a node); old lucky answers supplied the 2-day spacing (now judged on the last 3); a misconception could be closed straight after its scene (one re-check must come in a later session); a guess or a helped answer could secure a node; UTC dates and naive datetimes; a new review card was due at once; weak matches counted as explained; `could_reveal` documented per template instead of per item; coverage codes stored on state that propagation would create without them.
- Low: K described as halving; aided Elo updates only by convention; an untestable non-learner test; tie-breaks putting N10 before N2; the confident-and-wrong flag never cleared; the remediation queue ignoring the current node.

**Recorded, not fixed in M4** (ADR-0026)

- BKT with SPEC's starting parameters reads three correct answers in a row as learning, so a student who never learns but is right by chance 1 time in 5 is falsely secured about a fifth of the time over 12 days. Pilot data must refit p_guess and p_learn; until then the diagnostic and the first review are the safety net.
- Persistent misconceptions are held under 2% only when the student makes the mistake on at least 80% of the items that could show it. Less consistent ones close too early until reviews favour items carrying misconceptions the student has had (M7).
- The learner state has no columns yet; M7 needs a migration (ADR-0026 lists the fields).
- For M7: coverage of each item family, a test-out route and onboarding evidence for coverage, matches that fade, more than one re-check a session, interleaving look-alike problem types, a worked example after a diagnostic that finds no gap, and a pre-exam review sweep.
- The simulator models one node and one misconception at a time, with no forgetting, no confidence ratings and no planner.

### M5: Scenes engine (6 November 2026)

Environment: Windows 11, Node 22.15, pnpm 10.6.5, uv 0.11.14, Python 3.12.10, KaTeX 0.19.1, Playwright 1.64.1; fontkit 2.0.4 and datamodel-code-generator 0.85.0 as dev tools (both MIT). Branch `m5-scenes-engine`, stacked on M4; no PR yet.

**What landed**:

- **Renderer.** Remotion's licence could not be obtained, so scenes play on Eddy's own renderer (ADR-0027). Each scene is a pure function of time, drawn as SVG plus real DOM text.
- **Scene engine** (ADR-0028):
  - SceneSpec v1, with its generated JSON Schema and pydantic models;
  - layout measured with the real fonts;
  - 11 primitives;
  - the timeline, including rigid turns;
  - the player and the static diagram;
  - the static checks and the keyframe worker;
  - the scene golden set and the admin gallery.
- **13 default scenes**, one per topic.
- **The `/new-template` skill.**

**Checks run (final run, on the final code)**

| Command | Result |
|---|---|
| `EDDY_REQUIRE_DB=1 pnpm check` | Exit 0. Lint, Prettier, dash check (329 files), cliché lint (155 files), typecheck, Vitest (scenes 171, ui 98, schemas 11, web 9, infra 6, scene-check 3, api-client 1), 186 hook and lint-rule tests, ruff, strict mypy (75 files), 730 pytest tests. |
| `pnpm scenes:check` | 13 scenes passed the static and DOM checks: 154 sample keyframes at 2 or 3 widths in light and dark, and 104 golden variants at the widest widths. |
| `pnpm scenes:golden` and `pnpm evals` | Maths golden set 300/300; scene golden set 104 specs, 0 problems. That covers every claim verified, each correct answer equal to maths-core's, each predicted wrong answer equal to the student's, and every stated number traced, sign included. |
| `pnpm e2e` | 234 passed (8.6 minutes): every scene's captions, transcript, keyboard and diagram, the gallery, the unknown-scene 404 and the gated 404s, at 375, 768 and 1280 px in light, dark and reduced motion, with axe showing zero serious or critical findings. |

**Screenshots**:

- The keyframes in `e2e-artifacts/scenes/` (every beat, 5 widths, 2 themes) and the gallery pages in `e2e-artifacts/screenshots/` (117 scene pages).
- I looked at:
  - the reference scene at both formats;
  - the standard form, ratio, probability tree, angles, balance and triangle scenes at chosen beats;
  - three gallery pages: phone dark, tablet reduced motion, laptop light.
- The scene writers looked at every beat at 1152 and 288 px in light, plus dark samples. The pedagogy critic looked at every beat at those widths twice.

**Fresh-context reviews**: `pedagogy-critic` (twice), `reviewer` and `security-reviewer`. Fixed:

- **Pedagogy, high.**
  - The probability tree never said the events were independent; it now says so on screen and gives it as the reason to multiply.
  - The balance put negative weights on the scales; negative items now use an equation set out in columns.
  - The decimals scene said the digits after the point "are not whole numbers"; it now says each digit has its own place value.
  - The first triangle fix described a reflection in a rectangle's diagonal, which is false; it is now a half turn about the middle of each sloping side, animated as a real rotation.
- **Pedagogy, medium.**
  - "Alternate angles" is named.
  - Place names lead the standard-form headings on desktop.
  - Every area carries cm².
  - "Closer to zero" became "to the right of".
  - The gradient beats were split, and their wording follows the drawing.
  - The student's own moves are drawn in the translation.
  - Numbers are no longer cross-wired in the ratio scene.
  - The crossing-off pace matches the median scene's picture.
  - Plurals and command words were corrected throughout.
- **Code, high.**
  - Text inside tinted shapes was never contrast-checked (two scenes were at 3.45:1 and 3.87:1); every tint is checked now.
  - The scene golden check did not compare answers or signs; it now checks the correct answer, the predicted wrong answer and signed numbers.
- **Code, medium.**
  - Exponents fell below the 14 px floor; they are now set at 90%, and the check counts them.
  - The player clock skipped to the end after a background tab.
  - Focus was lost at the first and last beats.
  - The static diagram repeated labels to screen readers.
  - The DOM check only covered the gallery samples; it now also checks fonts, 640 px and all golden variants.
  - Integers became floats in pydantic.
  - Helpers were duplicated across primitives; they now live in the framework, and a layout snapshot of all 104 golden scenes proved the move changed nothing.
- **Security, all low.**
  - The keyframe page is self-contained, with JavaScript and the network off.
  - The gallery index rendered at build time; it now renders per request, with gated tests.
  - KaTeX has `trust` off, a strict node check, a render check before serving and an error boundary.
  - Narration rejects control and invisible characters and every dash.
  - Template versions accept ASCII digits only.

**Recorded, not fixed in M5** (ADR-0028):

- Before M6 sends model-written specs through this code:
  - Claude supplies only the beats, with strict per-template parameter schemas and size caps;
  - the narration checks are repeated in Python;
  - templates declare their beat kinds;
  - SPEC.md 6.7 gets retention rules for Tier L material;
  - the keyframe worker gets a sandboxed container.
- M8's content security policy needs `style-src-attr 'unsafe-inline'` for scene positions and KaTeX.
- The overlap check compares bounding boxes, so slanted lines are drawn as short pieces; two slanted-line helpers remain until a line-aware check replaces them.
- During a half turn the triangle's copies sweep briefly over nearby labels. The checks judge end states, not the frames in between.
- On a phone, the standard-form headings stay as powers of ten: "thousandths" does not fit a 288 px column at a readable size, so the narration links the names and the powers.
- The scenes have been reviewed by AI reviewers, not yet by a teacher. A teacher's look at the 13 scenes belongs with the hand check of the maths golden sample.

**CI**: the first run (34f6562) failed two checks.

- The committed font metrics had been reformatted by Prettier, so the freshness check failed. They are regenerated from the repo root now.
- On Linux the keyframe check found text drawn up to about 3% wider than on Windows, past the 2 px tolerance. Measured widths now carry a margin (ADR-0028).

The phone place-value headings were refitted to the new margin. After the fix, the scene tests (171), `pnpm scenes:golden` (104 specs, 0 problems) and `pnpm scenes:check` passed on Windows; CI reruns on the fix commit.

### M6: Animation generation loop (7 November 2026)

Environment: Windows 11, Node 22.15, pnpm 10.6.5, uv 0.11.14, Python 3.12.10, Playwright 1.64.1; anthropic 2.6.0 (MIT) and httpx 0.28.1 (BSD) added to services/api. Branch `m6-generation-loop`, stacked on M5; no PR yet.

**Status: done.** Every deliverable is built, and the live eval passes 97 of 100 cases at 2.5p a variant. Cold latency (16.6 s at p95) missed the original 8 s target; you accepted it on 7 November 2026, because Tier D shows at once, and the target is now 20 s.

**What landed**:

- **Device voice (ADR-0029).** ElevenLabs is deferred: the Player reads narration with on-device speech synthesis, holding each beat until its line is spoken, with a Voice toggle.
- **The Tier L generation loop (ADR-0030):**
  - the Claude client and prompt registry;
  - Claude writes only the beats, through a schema built for each template;
  - Python narration checks;
  - the scene engine's checks over HTTP from workers/scene-check;
  - maths-core scene verification and answer equivalence;
  - structured-feedback retries;
  - a cache per item and mistake, shared only once reviewed;
  - the request queue and route;
  - the worker, which generates and reviews with keyframes and a vision critique;
  - cost guards and a zero data retention gate in code;
  - migration 0003.
- **The eval suite:** 100 cases, a runner with a spending cap, thresholds, a cache benchmark and the precompute job.

**Checks run (final run, on the final code)**

| Command | Result |
|---|---|
| `EDDY_REQUIRE_DB=1 pnpm check` | Exit 0. Lint, Prettier, dash check (359 files), cliché lint (163 files), typecheck, Vitest (scenes 207, ui 99, schemas 12, scene-check 10, web 9, infra 6, api-client 1), 186 hook and lint-rule tests, ruff, strict mypy (92 files), 800 pytest tests. |
| `pnpm e2e` | 234 passed (7.7 minutes), axe with zero serious or critical findings at 375, 768 and 1280 px in light, dark and reduced motion. An earlier run under heavy machine load had 8 timeouts, which did not recur on a quiet machine. |
| `pnpm scenes:check` | 13 scenes passed the static and DOM checks: 154 sample keyframes and 104 golden variants. |
| `pnpm scenes:golden` and `pnpm evals` | Maths golden set 300/300; scene golden set 104 specs, 0 problems. Every reviewed scene also passes the stricter Tier L beat rules and the new narration checks. |
| `pnpm maths:bench` and `pnpm maths:coverage` | Verification p95 3.9 ms, scene verification included (target 150 ms); maths-core coverage 91%. |
| Pipeline probe | All 104 golden items through the real scene-check service and maths-core, with a stand-in for Claude returning the reviewed beats: 104 passed. |
| `pnpm scenes:cache-bench` | 100 cache hits through `POST /v1/scenes/variants` with the real scene-check service: p50 27.4 ms, p95 38.4 ms (target 300 ms). |
| `pnpm scenes:precompute` | Dry run only: 39 variants, about £5.85. Not yet run against Claude. |

**Live eval (`pnpm evals:tier-l -- --live`, 7 November 2026)**, Claude Opus 4.8, 100 cases, at most 2 attempts each:

| Run | Passed within two | First time | Cold p50 / p95 | Cost |
|---|---|---|---|---|
| Smoke test, 3 cases, effort high | 3 of 3 | 1 of 3 | 10.4 s / 10.9 s | £0.07 |
| Effort high, prompt 1.0.0 | 87 of 100 | 41 | 13.3 s / 26.8 s | £3.18 |
| After loosening four over-strict checks, effort high | 96 of 100 | 74 | 11.6 s / 27.2 s | £2.68, 2.8p a variant |
| **Effort medium, prompt 1.1.0 (kept)** | **97 of 100** | 43 | **9.3 s / 16.6 s** | **£2.40, 2.5p a variant** |
| Critique smoke test, 2 cases with the vision critique | 2 of 2, critique passed 2 of 2 | 1 | 6.9 s / 7.1 s | £0.12 (about 4p a critique) |

- **Total spent:** £8.45 of the £20 you approved.
- **The first run's failures were mostly the checks being too strict, not bad narration:**
  - "two" was flagged as a number word ("the two sides");
  - the too-close-to-what-was-seen rule matched six-word runs (it now needs eight-word runs in more than half the beats);
  - "cm²" was read as a power;
  - "again" was banned outright (now only "slip again" and the like).
  All 104 reviewed scenes still pass.
- **Claude repeated "wrong"** (about a method) eight times at high effort, even after feedback. The prompt itself said "the wrong answer"; version 1.1.0 avoids the word, and the medium run had none.
- **The checks that still fail cases are real:** a prediction beat that shows something new, more than 6 beats, a number the reviewed scene never states (such as 90° as a benchmark for 89°), and a beat out of order.
- **Prompt caching works.** About 317,000 input tokens were read from the cache in the medium run.
- **Latency:** at medium effort a single call takes 5.5 s at p50 and 12.2 s at p95, and 57 of the 100 cases needed a second attempt, so the 8 s cold target is out of reach with Opus 4.8 as configured. Students see Tier D at once and the variant arrives when it is ready.
- **Reports:** `e2e-artifacts/evals/` (not committed).

**Screenshots**: the scene pages at 375, 768 and 1280 px in light, dark and reduced motion (`e2e-artifacts/screenshots/`). I looked at the phone light, tablet reduced-motion and laptop dark pages: the Voice toggle wraps cleanly with the other controls and keeps its 44 px target.

**Fresh-context reviews**: `reviewer` (twice), `security-reviewer` and `pedagogy-critic`. Fixed:

- **Security, high.** A burst of requests could slip past the cost caps and hold every database connection while Claude ran. The route now never waits for Claude:
  - it serves a reviewed variant or Tier D at once;
  - it queues a request (one open per student, by a unique index);
  - the worker generates it after checking the budget again.
- **Pedagogy, high.**
  - The critique was told the numbers were verified; it now knows they are only traced, checks the maths first, and sees the item's facts.
  - Unreviewed variants reached other students; only reviewed ones are shared now.
  - Tone rules were prompt-only; blame words, gushing, exclamation marks and emoji are now checked in TypeScript and Python.
  - Variants could mention one student's confidence or history and then be cached for others; the prompt forbids it and the checks catch it.
- **Code, high.**
  - The route did not check that the template's misconception and predicted answer matched the attempt. It now checks both, and scenes narrate only the predicted answer, so a student's own input never reaches Claude or another student.
  - A short outage permanently failed queued scenes; errors now keep the claim and back off, and the worker waits for scene-check.
- **Medium, across the reviews:**
  - numbers written as words, superscripts and dollars escaped the number trace and are now caught;
  - a prediction question could give the answer away;
  - reading age was measured badly;
  - UK spelling gaps;
  - device voices could drop a minus sign, so narration is now spoken as words;
  - stale speech events ended the next line early;
  - pausing on the last line restarted the scene;
  - a database connection was held across Claude calls;
  - the eval undercounted cost and latency;
  - unescaped data in prompt tags;
  - `pnpm keys:dev` could drop lines;
  - the 8 KB spec cap and the misconception check in the spec;
  - the second review's two route bugs: a request handed back for the wrong attempt, and a failed variant still returned by its request.
- **Low:** the zero data retention gate, a 32-character scene-check token, an index for the cost guards, transient and final errors told apart, and request expiry.

**Recorded, not fixed in M6** (ADR-0030):

- The safety classifier for model output arrives with M7. Until then, the first student sees a Tier L scene that has passed every automatic check but not yet the critique.
- Qualitative statements in narration are judged by the critique, not verified.
- Per-template parameter schemas are no longer on a path a model controls (parameters come from the item bank).
- The keyframe worker's container hardening lands in M10.
- Several players on one page cut each other's voice off (the admin gallery only).
- An SSH tunnel to a real database on 127.0.0.1 would pass the local-database test; the zero data retention flag is the real gate.
- The prompt prefix may be too short for Opus 4.8's prompt cache; the eval reports cached tokens.
- Precompute has not run against Claude, and the critique has run on only 2 variants.
- The cold latency target was moved from 8 s to 20 s with your agreement. A faster route for `scene.generate` (low effort, or a smaller model, ADR-0005) can be tried later with the same eval.

**CI**: not run yet for this branch.

### M7: Tutor (9 and 10 November 2026)

Environment: Windows 11, Node 22.15, pnpm 10.6.5, uv 0.11.14, Python 3.12.10, Playwright 1.64.1; langgraph 1.2.20, langgraph-checkpoint-postgres 3.2.0 and redis 8.1.0 added to services/api. Branch `m7-tutor`; no PR yet.

**Status: done, except the safeguarding runbook.** The tutor meets every pedagogy threshold. Turn latency is 11.0 s at p95 after speed work that brought it down from 14.8 s; you accepted it on 10 November 2026, because the student sees "Eddy is writing", and the target is now 12 s (it was 3.5 s). The safeguarding runbook waits for your go-ahead to enter `/compliance`, and the script and tripwires wait for Eddy's named safeguarding lead; until then the tutor starts only in development and test.

**What landed** (ADR-0031):

- **Loop 1 as a LangGraph graph.** The session plan, then the worked example, faded step, independent practice, confidence before marking, every wrong answer diagnosed (a scene, or a Socratic question), the reply, a re-check from a template that can show the same slip, then the learner model. The checkpointer runs inside each request's transaction; free text never enters a checkpoint, and checkpoints are deleted with their lesson (migrations 0004 and 0005).
- **The safety pipeline:**
  - tripwires that see through spacing, invisible characters and look-alike letters;
  - the Haiku 4.5 input classifier with the last two messages;
  - Opus 4.8 messages checked for kind and level, length, tone, UK English, one question, confirming a guess, links and contact details, untraced numbers, answer leaks and maths truth (maths-core);
  - the Haiku 4.5 output classifier;
  - two regenerations, then templates.

  It fails closed throughout.
- **Safeguarding.** The static script and an event committed on its own connection; the script again for later messages. Draft script and tripwire list. A runbook draft is ready, not yet in `/compliance`.
- **The routes:** one input at a time per lesson, only the inputs the lesson is waiting for, Redis rate limits (never for a caught disclosure), daily cost guards, and `EDDY_ENVIRONMENT`.
- **The pedagogy suite** (72 conversations) and the English marking scaffolding (schema, QWK, exact and adjacent agreement).

**Checks run (final code)**

| Command | Result |
|---|---|
| `EDDY_REQUIRE_DB=1 pnpm check` | Exit 0. Lint, Prettier, dash check (383 files), cliché lint (165 files), typecheck, Vitest (scenes 207, ui 99, schemas 12, scene-check 10, web 9, infra 6, api-client 1), 186 hook and lint-rule tests, ruff, strict mypy (106 files), 904 pytest tests (94 for the tutor, on the real database). |
| `pnpm e2e` | 234 passed (8.2 minutes), axe with zero serious or critical findings at 375, 768 and 1280 px in light, dark and reduced motion. After the admin card fix below, the scenes spec again: 135 passed. |
| `packages/ui` alone | The Stop hook's run twice hit vitest worker-start timeouts while the eval and Docker loaded the machine; on its own with one worker, 99 of 99 passed. |
| `pnpm evals:tutor` (dry run) | 72 conversations, about £4.70 estimated. |
| The final live report summarised again against the 12 s target (no new calls) | Every threshold passes. |

**Live eval (`pnpm evals:tutor -- --live`, 9 November 2026)**

| Run | Prompts | Result | Cost |
|---|---|---|---|
| Smoke, 3 conversations | tutor 1.1.0 | The judge repeated a criterion (schema now one field each); many regenerations | £0.18 |
| Smoke, 3 conversations | tutor 1.2.0 | First pass 11%: maths not written as JSON, steps that cannot be checked | £0.16 |
| Full, 72 conversations | tutor 1.3.0 | 3 judge errors (reasons over 300 characters); the judge found 3 lessons giving too much away; p95 14.6 s | £2.39 |
| **Full, 72 conversations (kept)** | **tutor 1.4.0, judge 1.2.0** | **No answer leaks (independent check and judge); distress 14 of 14, each screened 3 times, 14 events written; no false alarms; injections 7 of 7 held; every rubric mean 3.5 or above, `no_answer_given` 4 in every conversation; judge calibration kappa 0.843; first pass 56%; p95 14.8 s; 1 error, a dropped connection to maths-core** | **£2.43** |
| Targeted, 16 conversations (stuck-06, off topic, benign) | safety-output 1.2.0 | All pass, no errors; "are you a real person" now answered "I am an AI tutor" | £0.39 |

- **Speed work (10 November 2026, at your request):**

  | Change | Effect |
  |---|---|
  | MathJSON as real JSON, nested four deep (it was a string of JSON, which the model cut off after "[" in 28 of 167 first drafts) | The largest single cause of retries gone |
  | Kind and hint level corrected in code, not retried | 7 retries a run gone |
  | The number trace accepts sign forms of given numbers, the student's own words, counts of listed values and 100 with percentages | Fewer false retries |
  | The output check told that a parallel worked example shows the method by design (safety-output 1.3.0); no Median operator (tutor 1.6.0) | Fewer false retries |
  | Opus 4.8 with thinking off, measured on 8 turns each way | Not kept: no faster (3.2 s a call at p50 against 2.9 s), as at low effort it barely thinks |

  | Run (72 conversations) | First pass | p50 / p95 per input | Fallbacks | Cost |
  |---|---|---|---|---|
  | Before (9 November, kept) | 56% | not recorded / 14.8 s | 13 | £2.43 |
  | **After (10 November)** | **78%** | **6.1 s / 11.0 s** | **6** | **£1.85**, Opus calibration skipped |

  The final run passes every other threshold: no answer leaks, distress 14 of 14 (each screened 3 times), injections 7 of 7, no false alarms, every rubric mean 3.45 or above, `no_answer_given` 4 in every conversation. The judge's calibration (kappa 0.843) comes from the run before.
- **Total spent:** about £7.60 of the £8 you approved (£5.55 on 9 November, £0.19 on the thinking measurement and £1.85 on the final run).
- **Where the time goes** (the final run, per call): Opus 4.8 at low effort 2.9 s at p50 and 4.7 s at p95; the input classifier 1.3 s; the output classifier 1.4 s. A message that passes first time takes about 5.6 s, and 22% of messages need at least one regeneration, so p95 per student input is 11.0 s.
- **Cost:** 2.6p a conversation; a lesson item (judging included) 5.6p, so about £0.33 for a six-item session, near SPEC.md's estimate of 25 to 35 US cents. The tutor's prompts are below the minimum cacheable size, so caching does not help.
- **What the runs found and fixed:**
  - the output classifier refused "I am an AI tutor", reading "no claim to be human" as "never say you are an AI" (safety-output 1.2.0);
  - faded steps and replies that laid out the whole method (tutor 1.4.0 and the step instructions);
  - two eval faults, counting harmless lead-in messages as missed disclosures and judging after-marking explanations as leaks.
- **Reports:** `e2e-artifacts/evals/` (not committed).

**Screenshots**: looked at the phone light, laptop dark and tablet reduced-motion pages. The admin scenes gallery let long template ids run out of their cards at tablet width (from M5); the codes now wrap inside the card, checked again at 768 and 375 px.

**Fresh-context reviews**: `reviewer`, `security-reviewer` and `pedagogy-critic`. Fixed:

- **High, across the reviews:**
  - student text in the checkpoint;
  - the checkpointer outside the request's transaction (a failed turn lost attempts or left a lesson stuck);
  - classifier errors, and messages at the confidence step, skipping safeguarding;
  - scenes narrating the student's raw answer;
  - easily bypassed tripwires with common false alarms;
  - a yes or no to a guess counted as safe;
  - wrong answers with no explanation, and messages promising an animation that never came;
  - parallel problems from other templates;
  - an eval that never ran the core loop.
- **Medium:**
  - free text sent to Opus through the answer field;
  - flagged messages resent in the history;
  - unverified numbers in tutor text;
  - no cost ceiling, and no lock per lesson;
  - LangSmith tracing;
  - the ZDR gate trusting any local-looking database;
  - every message climbing the hint ladder, and answer demands not counted as aided;
  - level 4 hints checked against the wrong problem;
  - templated fallbacks that taught badly;
  - invented praise;
  - choice questions;
  - unreadable answers marked wrong;
  - structure-rule misconceptions never closing;
  - the M4 planner, prerequisite diagnostic and propagation not wired.
- **Low:** message order, rate-limit memory, excerpts, the eval's database guard, retried 400s, and an exam-board-style fixture name.

**Recorded, not fixed in M7** (ADR-0031):

- The turn latency target was moved from 3.5 s to 12 s at p95 with your agreement; students see "Eddy is writing" (M8). A faster model for `tutor.turn` (ADR-0005) or two drafts written at once can be tried later with the same eval (M10).
- Cost per session, about £0.33, is a little over SPEC.md's estimate of 25 to 35 US cents; the M10 cost dashboard tracks it.
- Elo item selection (needs a student ability table and real data, M8).
- A new scene variant on recurrence goes through the scenes route.
- No confidence question on a re-check.
- Alerts to the safeguarding lead and the 90-day purge of messages and checkpoints (M8 jobs).
- Redacting personal details before Claude, pip-audit in CI, and a reading-age check on tutor text.
- A tutor turn holds a database connection while Claude writes (bounded per process).
- The per-lesson lock is not tested under real concurrency.

**CI**: not run yet for this branch.
