# Architecture decision records

Short ADRs. SPEC.md and PLAN.md were approved on 3 November 2026, which accepted ADR-0001 to ADR-0015. A decision is changed by adding a new ADR that supersedes the old one, never by editing history.

---

## ADR-0001: The product is called Eddy

Status: Accepted (chosen in interview, 3 November 2026)

- **Decision:** Product, repo and code use "Eddy". Package scopes `@eddy/*`; Python packages `eddy_api` and `eddy_maths_core`.
- **Consequences:** The brief's "Margin" and "Primer" are not used. A trademark search is still worth doing before launch.

## ADR-0002: Student-first accounts for everyone aged 13 and over

Status: Accepted (chosen in interview)

- **Context:** The audience is Year 10 and 11 students and post-16 resitters, some of them adults. The brief allowed parent-first or student-first.
- **Decision:** Students create their own accounts. Under-13s are blocked by a neutral age check (birth month and year only). Parent links need the student's acceptance, show a permanent indicator, and either side can end them. Every account gets Children's Code defaults regardless of age.
- **Consequences:** One flow for all ages. The DPIA has to justify the lawful basis for 13 to 15 year olds (legitimate interests proposed, legal review needed). Parents cannot see transcripts in the MVP.

## ADR-0003: `services/api` owns the domain and the tutor; maths-core stays stateless

Status: Accepted (default approved with SPEC.md)

- **Context:** The brief named `services/tutor` and preferred FastAPI with LangGraph.
- **Decision:** One stateful Python service, `services/api` (FastAPI, SQLAlchemy, Alembic, LangGraph), owns the database, learner model, tutor graph, safety pipeline, scene orchestration and privacy jobs, with a separate worker process from the same codebase. `services/maths-core` is a stateless FastAPI and SymPy service with no database. Next.js is a BFF only.
- **Consequences:** One place for every Claude call, prompt version and trace. maths-core can scale and be tested in isolation. The tutor loop is an explicit state machine in which code decides transitions and the model only writes words.

## ADR-0004: MathLive for answer input, MathJSON to SymPy for checking

Status: Accepted (chosen in interview)

- **Decision:** MathLive maths fields everywhere, themed with our tokens, with a custom Foundation virtual keyboard. The client sends MathJSON. maths-core validates it against an allow-list and converts it to SymPy with a tree walker.
- **Consequences:** No string parsing or `eval` of student input, which removes a whole injection class. Heavier client bundle than a keypad, so the learning route needs a JavaScript budget. Mobile and screen reader behaviour must be tested in M1 and M8.

## ADR-0005: Claude Opus 4.8 and Haiku 4.5 through the Anthropic API with zero data retention

Status: Accepted (chosen in interview)

- **Decision:** Opus 4.8 (`claude-opus-4-8`) for tutor turns, scene specs and vision critique. Haiku 4.5 (`claude-haiku-4-5`) for safety classifiers, the misconception fallback classifier and bulk eval judging. Direct Anthropic API with ZDR and no training on inputs. Model IDs only in `config/models.yaml`.
- **Consequences:** Opus 4.8 needs adaptive thinking set explicitly; Haiku 4.5 does not take an effort parameter. Sampling parameters and assistant prefill are never sent. Newer models (Opus 5.5 at $4 / $20, Haiku 5.5 at $0.10 / $0.50) are cheaper than this pair; switching any route is a config change plus an eval run. ZDR must be in place before real student data.

## ADR-0006: Scenes are deterministic first, Claude-personalised second

Status: Accepted (default approved with SPEC.md)

- **Context:** The brief has Claude fill every SceneSpec, with a hand-authored default as fallback. Research shows LLM-built scenes fail mostly on layout, and the cold path has an 8-second budget.
- **Decision:** Every seeded misconception has a parametric Tier D scene that starts from the student's actual answer with no model call. Claude-personalised Tier L variants are used when the student asks for another explanation, when a misconception recurs, for unmatched wrong answers on nodes with a generic template, and for build-time precompute.
- **Consequences:** Personalisation to the student's own answer is always available, verified and fast. Tier L still exists and is measured against Tier D in evals and the pilot, so the evidence decides how much of each to use.

## ADR-0007: Keyframe rendering and vision critique run after serving

Status: Accepted (default approved with SPEC.md)

- **Context:** A headless render plus a vision-model critique cannot fit inside the 8-second cold budget alongside generation.
- **Decision:** The hot path ends after schema validation, maths verification, layout and static checks. Keyframe rendering, DOM confirmation and critique run in the background; failures evict the spec from the cache and trigger regeneration, with Tier D shown meanwhile. Precomputed variants go through the full pipeline before they are ever served.
- **Consequences:** A small chance that a student sees a Tier L scene that later fails critique. The static checks catch the layout failures that matter most, because layout is computed, not guessed.

## ADR-0008: Auth.js with Next.js as the backend-for-frontend

Status: Accepted (chosen in interview)

- **Decision:** Auth.js with email magic links and the Postgres adapter. The browser only talks to Next.js. Next.js calls `services/api` with a 60-second JWT signed by its own private key; the api verifies it with the public key.
- **Consequences:** Fully on-brand sign-in and linking flows. Python services are never public. Auth tables are created by Alembic (ADR-0010). Email goes through Mailpit locally and Amazon SES in production.

## ADR-0009: LLM traces in Postgres plus OpenTelemetry, not self-hosted Langfuse

Status: Accepted (default approved with SPEC.md)

- **Context:** Self-hosted Langfuse now needs ClickHouse, Redis and object storage, which is heavy for local development on Windows and adds another system holding children's data.
- **Decision:** An `llm_call` table holds metadata for every model call (route, model, prompt version, tokens, cache reads, latency, cost, stop reason, safety flags). OpenTelemetry spans for request tracing. Raw text stays only in `tutor_message`, under its retention policy.
- **Consequences:** Everything stays in our UK database. We lose Langfuse's UI; the admin area and the cost dashboard (M10) cover what we need. Langfuse can be added later if it earns its place.

## ADR-0010: Alembic is the only schema source

Status: Accepted (default approved with SPEC.md)

- **Decision:** All tables, including the Auth.js tables, are created by Alembic migrations in `services/api`. TypeScript reads domain data through the generated API client, never directly. Scene and LLM schemas go the other way: zod in `packages/schemas` is the source, with JSON Schema and pydantic generated from it.
- **Consequences:** One migration history to review. Two clearly separated generation directions, each covered by contract tests.

## ADR-0011: ElevenLabs narration first, Polly fallback

Status: Accepted (chosen in interview)

- **Decision:** ElevenLabs with timestamps, converted to word timings for beat sync, cached in S3 by a hash of provider, voice, model and text. AWS Polly behind the same interface as a fallback. Captions always come from the same text.
- **Consequences:** Another processor in the DPIA, outside the UK; narration text must never contain personal data. Until audio is ready, scenes play captions-first.

## ADR-0012: No billing in the MVP

Status: Accepted (chosen in interview)

- **Decision:** Access by invite code for a closed beta and a school pilot. No payment provider, no upsell anywhere.
- **Consequences:** The DfE manipulation standard is trivially met for now. Billing is designed after evidence of learning gains, and will only ever be shown to parents or schools.

## ADR-0013: Remotion Player for scenes, on the free licence tier

Status: Superseded by ADR-0027 on 5 November 2026: the licence cannot be obtained. (Accepted 3 November 2026, pending confirmation of team size.)

- **Decision:** Scenes are Remotion compositions of plain SVG primitives, played in the browser with `@remotion/player`. No server rendering on the normal path; Remotion Lambda only for a future MP4 export.
- **Consequences:** Deterministic, frame-addressable timelines, which the keyframe checker relies on. Free while 3 or fewer people work on Eddy commercially; a company licence is needed above that.

## ADR-0014: No AWS deployment until approved

Status: Accepted (default approved with SPEC.md)

- **Decision:** CDK stacks for eu-west-2 are written and synthesised in CI from M0. Nothing is deployed until you approve it, planned for a staging environment in M10.
- **Consequences:** No cloud cost during the build. Local development relies on docker compose with S3Mock, ElasticMQ and Mailpit (ADR-0016).

## ADR-0015: Storybook for the design system

Status: Accepted (default approved with SPEC.md)

- **Decision:** Storybook for component development, with its accessibility checks and Playwright-driven visual snapshots in CI. (The brief allowed Storybook or Ladle.)
- **Consequences:** Heavier than Ladle, but a larger ecosystem and better accessibility tooling.

## ADR-0016: S3Mock and ElasticMQ for local S3 and SQS, not LocalStack

Status: Accepted (4 November 2026, during M0)

- **Context:** PLAN.md M0 named LocalStack. Its current image (2026.10.4) refuses to start without a LocalStack account and licence key, and its free plan is for non-commercial use.
- **Decision:** Local S3 is Adobe S3Mock (`adobe/s3mock:5.2.3`, port 9590, bucket `eddy-assets` created at start-up). Local SQS is ElasticMQ (`softwaremill/elasticmq-native:1.7.1`, port 9324). Both are free, need no account, and speak the AWS APIs the services will use through boto3 or the AWS SDK.
- **Consequences:** No third-party account for local development. Each emulator covers one service only, so anything beyond S3 and SQS (SES is already covered by Mailpit) needs its own stand-in or a real AWS sandbox account, which needs approval.

## ADR-0017: TypeScript 5.9 and ESLint 9

Status: Accepted (4 November 2026, during M0)

- **Context:** The latest releases at M0 were TypeScript 7.0 and ESLint 10. typescript-eslint 8.72 supports TypeScript below 6.1 only, and openapi-typescript expects TypeScript 5. eslint-config-next depends on eslint-plugin-react, eslint-plugin-import and eslint-plugin-jsx-a11y, whose newest supported ESLint is 9.
- **Decision:** Pin TypeScript 5.9.3 and ESLint 9.39.5 across the workspace. Next.js 16.4.5, React 19.3.1, Vitest 5.1, Playwright 1.64 and the CDK are on their latest releases.
- **Consequences:** Revisit when typescript-eslint supports TypeScript 6 or 7 and eslint-config-next supports ESLint 10. Upgrading is a single commit across all package.json files.

## ADR-0018: A `system` role for machine callers, and routes that name their roles

Status: Accepted (4 November 2026, during M0 review)

- **Context:** SPEC.md section 6.2 lists the user roles `student`, `parent` and `admin`. The M0 hello page needs to call services/api with no signed-in user, and the security review flagged that an undefined `system` role, minted by a public page, could quietly gain trust later.
- **Decision:** `system` is a service-token role for machine callers only (diagnostics now, scheduled jobs later). It is never stored on a user or given to a browser session. Every services/api route names the roles it accepts with `require_roles(...)`, so a role is trusted only where a route says so. The hello page's system check runs only in development or when `EDDY_SYSTEM_CHECK=1` (the E2E suite), never for production visitors. The signer checks role and subject at runtime as well as in types.
- **Consequences:** Adding a route forces an explicit decision about who may call it. Jobs inside services/api do not need web-minted tokens at all.
- **Amended in M2 (5 November 2026):** the admin preview pages serve a person, so they sign as `admin` with the subject `preview:admin-curriculum`, never as `system`. The preview exists only under `next dev` or with `EDDY_ADMIN_PREVIEW=1`, and is checked in `src/proxy.ts`, in every page and `generateMetadata`, and before a token is signed. A layout's `notFound()` alone does not stop its pages rendering. M8 replaces the preview subject with the signed-in admin's own id.

## ADR-0019: Contrast-safe "Paper and Ink" tokens

Status: Accepted (4 November 2026, approved by Abdulhamid during M1)

- **Context:** The M1 audit of every colour pairing found that the brief's palette fails WCAG 2.2 AA in several places. The light accent #D9480F fails as text (3.9:1) and behind white button text (4.3:1). The dark highlighter fails behind ink (4.0:1) and badly behind coloured text. The `--rule` hairline is too faint to edge an input (1.35:1 and 1.43:1). White text on the dark accent fails (2.6:1). Darkening the light accent until it passes (#B8400D) makes it almost identical to the misconception red, and the brief's dark accent and dark misconception colours (#FF7A3D and #FF7A66) were already only 20.6 CIELAB units apart.
- **Decision:** The brand stays paper, ink and orange.
  - Light accent: #F08C4A, a highlighter-marker orange, used only as a fill with ink text (6.5:1), never as text.
  - Dark accent: #FFA552 with dark text (9.5:1).
  - Both accents sit at least 30 CIELAB units from their theme's misconception red (31.3 and 32.0).
  - New `--on-accent` token for text on the accent fill.
  - New `--field-border` token for input and control edges (light #8A8473, dark #6B7380, at least 3:1). `--rule` stays for decorative lines only.
  - Dark highlighter: #6B5410 (ink on it 5.9:1). Only ink text ever sits on a highlight.
  - Dyslexia mode on a light theme uses cream paper #FBF4E2.
- **Consequences:** `packages/ui/src/tokens/contrast-pairs.ts` lists every allowed pairing, and a test checks each in light, dark and dyslexia modes. The cliché lint bans raw colour values outside the token file, so new colours have to go through this test.

## ADR-0020: Visual checks in M1 are screenshots for review plus axe, not pixel diffs

Status: Accepted (4 November 2026, during M1)

- **Context:** PLAN.md M1 asks for Playwright visual snapshots of every component in every mode. Pixel-diff baselines are platform specific: font rendering differs between the Windows dev machine and Linux CI, so baselines from one fail on the other.
- **Decision:** `pnpm e2e:storybook` opens every story at 375, 768 and 1280 px in light, dark, reduced motion and dyslexia mode. For each it runs axe (zero serious or critical violations allowed) and saves a full-page screenshot, which CI uploads as an artifact. Two extra projects cover the `data-theme` override and dyslexia mode on dark. Every component, including open dialogs and sheets, a visible toast and the on-screen maths keyboard, has a story; a gallery story gathers the main ones on one page for review by eye. Pixel-diff regression (`toHaveScreenshot`) is deferred until baselines can be produced on the CI platform, for example in the Playwright Docker image.
- **Consequences:** Visual regressions are caught by review and axe, not automatically. Revisit when the scene engine (M5) adds many more visuals.

## ADR-0021: One curriculum node per DfE statement, seeded from YAML by natural key

Status: Accepted (5 November 2026, during M2)

- **Context:** AQA 8300, Edexcel 1MA1 and OCR J560 all teach the same DfE GCSE mathematics subject content (N1 to S6). Copying nodes per board would triple the graph, split mastery between duplicate nodes and make prerequisite edges drift. The curriculum also has to be reviewable in pull requests and reloadable without losing student data.
- **Decision:** `curriculum_node` holds one row per DfE statement (97), attached to a DFE `curriculum_spec`. Exam board specs are separate `curriculum_spec` rows whose `content_spec_id` points at the DfE spec; their papers, marks and calculator rules sit in `papers`. The curriculum lives in `curriculum/` as YAML, each file with a JSON Schema in `curriculum/schemas/`, and is loaded by `python -m eddy_api.seed`: schema validation, then cross-file checks (known codes, a prerequisite DAG, every MVP node's ancestors declared, at least four misconceptions per MVP topic), then an idempotent upsert keyed on natural keys (spec board, code and version; node code; misconception code; topic slug; set text board and title; question type spec, paper and number). Link rows (prerequisite edges, topic nodes, level descriptors) are kept exactly in step with the YAML. Entity rows missing from the YAML are reported as orphaned, never deleted, because attempts and states point at them. `--dry-run` runs the same upsert inside a transaction and rolls back. Node titles and descriptions are our own paraphrases of the DfE content (Open Government Licence v3.0). Two columns differ from the brief: `misconception.remediation_template` names a scene template (`primitive.template`) rather than an id, and `recheck_family` names an item family rather than listing item ids, because items are generated from families in M3.
- **Consequences:** Mastery is tracked once per idea whatever the board. Board-specific content differences (rare at GCSE) will need a node flag rather than a copy. Nodes, topics, misconceptions and set texts that leave the YAML are retired (`retired_at`, added after the M2 review) and no longer served; one that returns is restored. The seed and `pnpm dev` refuse a database that is not on this machine unless told otherwise, and E2E uses its own `eddy_e2e` database.

## ADR-0022: A three-part rule language for misconception detection

Status: Accepted (5 November 2026, during M2)

- **Context:** SPEC.md section 6.1 asks for detection rules that maths-core can run deterministically, with the Haiku classifier as a fallback that can only ever suspect. Rules must be data in the YAML, not free code, so a new misconception is a reviewed YAML change plus one named function.
- **Decision:** `misconception.detection_rules` is a list of rules, any of which may match:
  - `{type: distractor, rule: <name>}`: the student's answer equals `rule(item params)`. Every name must be implemented by maths-core (M3); a test lists every name the YAML uses. The same function generates the item's distractor for that misconception, so detection and distractors cannot drift.
  - `{type: structure, rule: <name>}`: a named pattern over the MathJSON of the student's working (for example both numerators and denominators added). Reserved in M2; maths-core adds the matchers when step checking needs them.
  - `{type: classifier}`: eligible for the Haiku fallback. A classifier match can only make the misconception SUSPECTED, never CONFIRMED.
  Rule names are snake_case identifiers, never expressions, so nothing from the YAML is ever evaluated.
- **Consequences:** The library has 85 misconceptions, 82 distinct distractor rules and 2 structure rules (`sf_not_normalised`, where the value is right and only the form is wrong, and `probability_over_one`, a range check that matches only when no distractor rule does) for M3 to implement. A wrong answer is matched only against the misconceptions of the item's own template, so two codes never claim the same answer in one item. Student text names the idea, not the item's numbers, so it never gives away an answer.

## ADR-0023: Auth.js tables in our own schema conventions

Status: Accepted (5 November 2026, during M2)

- **Context:** Auth.js (ADR-0008) ships adapters that expect its own table and column names (camelCase, text ids). The rest of the schema uses UUID primary keys, snake_case columns and named constraints, and Python owns the migrations.
- **Decision:** `users`, `accounts`, `sessions` and `verification_token` are created by our Alembic migrations with UUID keys and snake_case columns, alongside our own columns (role, deactivation, a unique index on `lower(email)`). In M8 apps/web gets a small custom Auth.js adapter that maps Auth.js fields to these columns, instead of the stock Postgres adapter creating its own tables. This amends the "Postgres adapter" wording in ADR-0008.
- **Consequences:** One migration history and one naming style. The custom adapter is roughly a hundred lines that M8 must test against the Auth.js adapter test suite.

## ADR-0024: Account and audit hardening that waits for M8

Status: Accepted (5 November 2026, after the M2 review)

- **Context:** The M2 security review found three things the schema alone cannot settle. The audit log is append-only by trigger, but SPEC.md 6.5 also asks for database grants, and every process connects as the table owner. Auth.js's email provider creates a `users` row when the magic link is used, which SPEC.md 4.1 puts before the age check, so an under-13's email would be stored. And the retention of `audit_log` and `safeguarding_event` rows is an open DPIA question.
- **Decision:** Fixed in M2 (migration 0002): deleting an account no longer cascades to `safeguarding_event` (RESTRICT) or `data_request` (SET NULL); sessions store a token hash; the OAuth token columns are gone; `parent_link` and `invite_code` have integrity checks. Moved to M8, before any real row is written: a migrator role that owns the schema and a runtime role with only SELECT and INSERT on `audit_log`, with a test that the runtime role cannot update it or disable the trigger; the age check before any email is stored (or a pending state that is hard-deleted on failure), with expired verification tokens purged; and the retention rule for `audit_log` and `safeguarding_event`, from the DPIA.
- **Consequences:** Until M8 the audit log's protection is the trigger only, which is enough while no real data exists. M8 cannot start sign-up until these are in place; PLAN.md M8 lists them.

## ADR-0025: Item templates in code, verified by property tests, worked examples and a frozen golden set

Status: Accepted (5 November 2026, during M3; revised after the M3 and security reviews)

- **Context:** PLAN.md M3 asks for at least three templates per MVP node, distractors that equal their misconception rule, and a 300-item golden set at 100%. Items could be stored in the database or generated on demand, and student input must be judged safely and quickly.
- **Decision:**
  - Templates live in maths-core as Python (`eddy_maths_core/items/`). Parameters come from a generator seeded by template id and seed, and are redrawn until the numbers are clean and every distractor is distinct. An item is reproducible from `(template_id, seed)`, so services/api stores those two values, not the maths.
  - Each template maps misconception codes to rules; a test holds the map equal to `curriculum/maths/misconceptions.yaml`, and detection considers only the item's own template, so two codes never claim one answer. Every rule also has a hand-worked example from the misconception's description (`test_rule_examples.py`), because a property test that compares a distractor with the rule that made it cannot catch a rule that models the wrong mistake.
  - A rule that gives an unending decimal matches the student's rounding of it. Answers and distractors are written in the form the question asks for (decimal, standard form, mixed number, 16.5 rather than 33/2 for a percentage).
  - Units are optional unless the question asks for them, because the answer box shows the unit; a different unit, or a unit on an answer that has none ("8%" for an amount), is a format issue. Clients send numbers as `{"num": "<as typed>"}`: a JSON number loses trailing zeros that decimal-place questions need.
  - Rational expressions (no roots, no pi) compare exactly with `cancel`, so 10.0000000001 is not 10. Anything else is sampled at 20 real points drawn afresh for every call (never fixed, public points), at 15 digits, then confirmed with `simplify` when the expression is small. When sampling agrees but `simplify` cannot decide, a second fresh set of points must agree too, and then the answer is accepted: refusing would mark correct answers wrong. Equations compare by constant multiple first, then by solution set (one unknown, up to degree 4, polynomial or rational only), then by sampling.
  - Input limits keep every request cheap: at most 400 nodes, depth 24, 40-digit numbers (ASCII digits only), powers that are numbers up to 64 (never a letter), no intermediate number above 400 digits, no expression above degree 12, at most 3 different letters and 4 roots or absolute values, and no non-real values (odd roots of negatives are real, as at GCSE). Requests over 64 KB are refused by counting the bytes as they arrive. Any unexpected error fails closed as "could not be checked". A process sandbox with a hard time limit per verification is still to come (M10 hardening): today the limits above are the only bound.
  - The answer-leak check is by value, over the whole statement, each side of a relation, each part of a tuple, and the solution of any linear equation in one unknown ("x - 10 = 0" pins x). A rounded answer also leaks through an unrounded value (49 pi for 153.9). A value equal to the answer is a leak unless the question states that value and the message writes it in a different form; on a choice (which of -7 and -3 is smaller?) any mention counts, so the tutor falls back to a templated hint. The check only sees the maths listed in a message's `maths[]`, so services/api must always send the item and also scan the prose (M7).
  - Claims: anything about numbers alone must be true whatever its role; a claim with letters must be an identity or true at the item's answer; a given, and the first step, must be true at the answer, or stay unverified when that cannot be checked.
  - The golden set freezes 300 distinct generated items with their answers and distractors. `pnpm evals` regenerates and verifies them, so a change to a template's maths fails until the golden file is rewritten and reviewed.
- **Consequences:** Adding a template is a code change with property tests and a worked example per new rule. Items with a `diagram` need the scene primitives (M5) before a student sees them. Scene spec verification uses the claims endpoint and is wired to SceneSpec in M5.

## ADR-0026: The learner model's rules, made precise and checked on synthetic students

Status: Accepted (5 November 2026, during M4)

- **Context:** SPEC.md 7.1 sets the learner model's shape: BKT per node, prerequisite propagation, a two-failure prerequisite diagnostic, Elo, FSRS, a misconception state machine, node selection and interleaving. PLAN.md M4 asks for two measured outcomes: learnable students reach SECURE within a bounded number of attempts, and students with a persistent misconception are falsely marked SECURE less than 2% of the time. Taken literally, SPEC's rules failed both in simulation: a single re-check let a student who made the mistake half the time close it with a lucky answer and secure the node 83% of the time. A code review and a pedagogy review then found that, wired to the real curriculum, the rules would lock most of the MVP: 17 ancestor nodes have no item templates, and a root node falling due for review would block everything after it.
- **Decision:** The model is pure functions in `services/api/src/eddy_api/learner/`, with no database access, so every transition is deterministic and tested. M7's tutor loop reads and writes the learning tables around it. These are the rules beyond SPEC.md.
  - **BKT:** SPEC's starting parameters. Guessing is 1 divided by the number of options on a choice item (0.25 for four, as SPEC says, and 0.5 for two). Aided attempts move the estimate half as far. Mastery never rises above 0.99, so wrong answers still move a well-practised node. Two in a row take a free answer from 0.99 to 0.70; on two-option items they reach only 0.85, which is why the lapse rule below exists.
  - **SECURE:**
    - p_mastery at least 0.95.
    - The last 3 counted correct answers span at least 2 sessions on 2 UK calendar dates, and at least 8 hours from first to last. A counted answer is unaided and not rated 1 out of 4 for confidence ("I guessed"). Spacing is judged on the latest answers, so old lucky guesses cannot supply it.
    - No open misconception on the node.
    - The answer that completes the bar is a counted one: a guess or a helped answer never secures a node.
    - Coverage: each misconception an item template on the node can reveal (by a distractor or structure rule) has been passed at least twice since it last showed itself. A misconception only the classifier can spot does not block SECURE. These codes are curriculum data, so M7 passes them in on every call rather than storing them on the learner's state. An item could reveal a misconception when the generated item has that misconception's distractor, or the template has its structure rule. The template's full list would credit items that could not have shown the mistake.
    - When a misconception shows itself on the node, the run of counted correct answers starts again.
  - **NEEDS_REVIEW:** a secured node moves here when its review falls due, after 2 wrong answers in a row in one session that no misconception explains (a lapse), when p_mastery falls below 0.80, or when a misconception on it opens; one slip alone does not move it. A review that has fallen due, or a lapse, stays owed until a counted correct answer.
  - **Two-failure diagnostic:** two wrong answers in a row in one session trigger it. A wrong answer that matched a misconception rule does not count, because remediation deals with it. It runs at most once per node per session. It probes direct prerequisites with items: those not yet secured first, lowest mastery first (SPEC); then secured ones, least likely to be remembered first by FSRS retrievability. It walks up the graph one level at a time.
  - **Misconception evidence:**
    - A diagnostic match makes a new misconception SUSPECTED, as SPEC.md 4.1 says of the onboarding diagnostic, and confirms one already suspected.
    - An unsure pick of the distractor on a choice item (confidence below 3) is only a weak suspicion when it is the first sign of that misconception: not open, not queued for a scene, and the run carries on. It still counts as a failure for the diagnostic and for a lapse, because nothing else deals with it. After that a choice match counts like a rule match.
    - The classifier can only ever suspect.
  - **Closing a misconception:** RECHECKED_OK needs 3 clean re-checks since the last match, 2 more for each further match (up to 9). At least one must come in a later session than the scene. The confident-and-wrong flag clears when it closes.
  - **Propagation:** a prerequisite not yet secured gets a boost of half its edge strength (capped at 0.3) of its remaining gap, never above 0.9, so only its own evidence can make it SECURE.
  - **Elo:** item K is 40 / (1 + n / 20): 20 after 20 attempts, 10 after 60, and 8 from 80 on. Student K is 32. Aided attempts update neither rating. Once mastery is near SECURE, item choice prefers items that test misconceptions not yet probed.
  - **FSRS:**
    - Target retention 0.9, scheduled in days (no minute-long learning steps), without fuzzing so schedules repeat, and never more than 120 days apart.
    - A node's card starts when it becomes SECURE, with the securing answer as its first review.
    - The rating is Again when wrong or guessed (confidence 1). It is Hard with any help, confidence 2, or more than twice the time a paper allows (72 seconds a mark, scaled by the student's extra time). It is Easy when sure and within half that time, and Good otherwise.
  - **Planning:**
    - A prerequisite is met once secured (SECURE or NEEDS_REVIEW). A prerequisite with no items yet is looked through: it is met when its own prerequisites are, so a student cannot skip the practisable nodes behind it.
    - The student carries on with a node already started, nearest to SECURE first. Otherwise SPEC's rule opens a new node: lowest mastery, weighted by mark density (flattened for a target grade of 5).
    - Reviews are due cards plus a repair for any node in NEEDS_REVIEW, at most 5 a session. They are interleaved by strand once 3 nodes have been secured.
- **Evidence:** `pnpm learner:report`, seeded. Free-answer items unless stated.
  - **Learnable students** (5,000): all secured within 60 attempts; median 7, 99th percentile 31, maximum 57. 1.00% were secured by lucky guessing without knowing the node.
  - **Two-option choice items** (2,500 learnable students): all secured within 120 attempts; median 11, 99th percentile 66, maximum 101. 1.56% were secured by lucky guessing.
  - **Students who already know the node**, two-option items, 10% slips, every slip on the distractor (2,500): 21.1% were shown a scene for a slip. Counting each slip as a full match would show 46%.
  - **Persistent misconceptions** (2,500 per rate), falsely SECURE by how often the student makes the mistake: 0.00% at 100%, 0.20% at 90%, 1.32% at 80%, 2.76% at 70%, 8.04% at 60% and 16.68% at 50%. At 80% to 100%, without confidence ratings, it is 0.40% on two-option items and 1.32% on four-option items.
  - **Students who never learn the node** (2,500 per row), by how often they are right by chance:
    - 1 in 5: 21.64% falsely SECURE within 60 attempts.
    - 1 in 10: 2.96%.
    - 1 in 20: 0.28%.
    - Two-option items: 8.08%.
    - The prerequisite diagnostic is offered in nearly every session.
- **Consequences:**
  - PLAN's "persistent" population is students who make the mistake on at least 80% of the items that could reveal it. The tests hold them under 2% on free answers and on choice items.
  - Less consistent misconceptions are often closed too early. Only later matches reopen them, and M7 still has to make reviews favour items that carry misconceptions the student has had.
  - BKT with SPEC's parameters reads any three correct answers in a row as learning. A student who never learns the node, but is right by chance 1 time in 5, is falsely secured about a fifth of the time over 12 days. In the tutor loop that student will have been offered the prerequisite diagnostic in nearly every session, and the first review comes 1 to 8 days after securing, depending on how the securing answer was rated (2 days for Good). Refitting p_guess and p_learn on pilot data is the real fix.
  - The simulator's limits: one node with one misconception, all items of one kind, 5 items every day, no forgetting, no confidence ratings, and no planner or prerequisites.
  - The model has not met real students; every parameter is a starting point for refitting on pilot data.
  - The state these functions keep has no columns yet, and losing any of it on reload changes behaviour: a weak suspicion would reopen as a real one, for example, or the later-session re-check rule would pass in the scene's own session. M7 needs a migration for:
    - on a node: the counted answers with their sessions and times, the failure count, the last session, the session the diagnostic last ran in, the review flag and the probes;
    - on a misconception: the match and clean re-check counts, the weak flag, the scene's session and whether a later re-check has come;
    - Elo ability per strand.
  - **Left to M7, from the reviews:**
    - Require each item family on a node once, not only each misconception.
    - Offer a test-out route, and let onboarding evidence count towards coverage, so able students are not ground through every family.
    - Let matches fade with time.
    - Allow more than one re-check a session.
    - Mix look-alike problem types when interleaving.
    - Return to a worked example when a diagnostic finds no gap.
    - Sweep reviews before the exam.

## ADR-0027: Scenes are pure functions of time, played by our own renderer

Status: Accepted (5 November 2026, start of M5). Supersedes ADR-0013.

- **Context:** ADR-0013 chose Remotion on its free tier, which covers organisations of up to 3 people. The licence cannot be obtained, so M5 needs another way to play scenes. The scene rules still apply: every word is real DOM text, maths is KaTeX with MathML, the Player steps beat by beat and never autoplays, reduced motion gets stepped states, and the keyframe checker must be able to show any moment exactly.
- **Options considered:**
  - Motion Canvas and its fork Revideo are MIT-licensed, but they draw onto a canvas, so text would be pixels. That breaks the DOM text rule, screen readers and the DOM box check.
  - GSAP is free under Webflow's own licence, which Webflow may change or revoke at its discretion: the same kind of risk as Remotion.
  - Framer Motion and the Web Animations API suit interface polish, but the browser owns their clock, which makes exact seeking, beat stepping and keyframe capture harder.
- **Decision:** Our own renderer in `packages/scenes`, with no animation dependency.
  - A scene is a pure function of time: given the spec, the computed layout and a time in milliseconds, it returns every element's state (shown or not, opacity, how far along its morph, colour role).
  - React renders that state as SVG shapes plus absolutely positioned DOM text.
  - The Player owns the clock: `requestAnimationFrame`, speeds 0.75, 1 and 1.25, pause, step to beat boundaries, replay. It never starts on its own.
  - Reduced motion uses the same function with each transition replaced by a 150 ms cross-fade. The static annotated diagram renders each beat's end time.
  - The keyframe checker sets the time directly in headless Chromium.
  - Easing is a few lines of our own.
- **Consequences:**
  - No licence or vendor risk, and every frame can be computed and tested in Node.
  - We maintain the timeline code, so it stays small, pure and unit-tested.
  - M5 grows by about half a week.
  - The MP4 export after the MVP will capture frames in headless Chromium and encode them; the encoder and its licence are chosen then.

## ADR-0028: The scene engine: measured layout, keyframe checks and verified scene maths

Status: Accepted (5 November 2026, during M5)

- **Context:** SPEC.md section 8 and PLAN.md M5 ask for primitives, a layout engine that measures text with real font metrics, static checks, headless keyframe and DOM checks, 13 default scenes, and verified maths. ADR-0027 settles how scenes play. This records how they are built and checked.
- **Decision:**
  - **One element model.** Primitives are pure geometry builders that return generic elements (line, rectangle, polygon, circle, arc, text, pen mark) in canvas units. One renderer draws them all, so morphing, fading, the static checks and the DOM comparison are written once.
  - **Frames, not instructions.** A template draws everything that belongs to the focus ids revealed so far, so each beat's end state is a frame. An element that keeps its id persists and morphs, so a Tier L spec (M6) can reorder or drop beats.
  - **Canvas sizes.** 1600 by 900 units for 16:9 and 800 by 1000 for 4:5. A scene switches to 4:5 below 640 px. Text is at least 14 px at the narrowest stage (288 px for 4:5, 640 px for 16:9), so labels are 40 units and working text 44.
  - **Measured text.**
    - Glyph advances come from the self-hosted font files (`font-metrics.json`, regular weight only, because fontkit cannot make instances of a variable WOFF2 font).
    - Scene text stays in Atkinson Hyperlegible in dyslexia mode, because the layout is measured with it; captions and the transcript follow the reader's font.
    - Maths labels are KaTeX, measured with KaTeX's fonts and centred in their boxes. The DOM check is the judge of the result.
  - **Faulty steps.** A faulty step is a misconception-coloured label with a pen mark. The student's own working is never recoloured, because a quantity keeps its colour.
  - **Tints and exponents.**
    - Highlight shapes are a 35% wash with no outline, and filled shapes a 16% tint. Text on any tint must reach 4.5:1 against the blended colour, in both themes.
    - Exponents are set at 90% of their label (KaTeX `\small`), not KaTeX's usual 70%, so they clear the 14 px floor on the narrowest phone; the font-size check counts them.
  - **Two layers of checks.**
    - The static checks run on every built scene, and render every maths label with KaTeX so maths that cannot draw fails before it is served.
    - `pnpm scenes:check` renders every beat's end state in headless Chromium. The gallery samples are drawn at 288 and 343 px (4:5) and at 640, 704 and 1152 px (16:9), in light and dark. All 104 golden variants are drawn at the widest width of each format.
      - It compares each DOM text box with its layout box, fails if a font did not load, and saves screenshots.
      - The page is self-contained (stylesheets inlined, fonts as data URIs) and loads with JavaScript off and every request aborted, so a spec could not make the checker fetch anything.
      - It needs no web server, and CI runs it in the end-to-end job.
    - Reduced motion changes only transitions, not end states, so the end-to-end tests cover it visually.
  - **Verified scene maths.**
    - Each template lists its claims as MathJSON relations.
    - The scene golden set is 8 real items per scene from maths-core, each with the student's real wrong answer (`evals/golden/scenes/inputs.json`, frozen).
    - Built specs are committed (`specs.jsonl`), so a narration change shows in review.
    - `pnpm evals` makes maths-core:
      - verify every claim;
      - check the scene's correct answer equals maths-core's answer, and the wrong answer the scene narrates (`predicted`) equals the student's actual one;
      - trace every number in the narration and in non-scale labels, sign included.
    - The tracing is a set-membership test: it catches a number nothing checked, not a wrong pairing of checked numbers. "minus" is subtraction, "negative 4" and "−4" are negative, and a bare number may be a stated negative's size only after a subtraction or before a direction word ("6 down").
    - The `structure` role is for axes and scales only, because their labels are skipped.
  - **Generated pydantic.** pydantic models are generated from the JSON Schema with datamodel-code-generator (0.85.0, MIT, dev only). Checks that JSON Schema cannot express (word counts, focus ids) are repeated in Python when Tier L arrives (M6).
- **Consequences:**
  - A font change means regenerating the metrics.
  - Maths boxes are estimates, so a scene that leans on unusual maths may need the DOM check's screenshots looked at.
  - Known limits, for later:
    - The overlap check uses whole bounding boxes, so a slanted line reserves its full rectangle; scenes split slanted lines into short pieces as a workaround.
    - A degree sign set as maths and a leading "=" are measured slightly off, so scenes write degrees as text.
    - `draw` runs once per beat, so heavy templates cache their geometry.
    - The flash-rate check cannot fail with today's timings (every beat lasts at least 1.35 s); it stays as a guard for audio-timed beats in M6.
    - At 0.75x a transition takes 933 ms and at 1.25x the shortest hold is 960 ms, just outside SPEC.md 8.4's ranges; the student chose the speed, so that is accepted.
  - The worker's M0 frame-number helper is gone: a keyframe is a beat's end state.
  - The SQS consumer that runs the checker after serving a Tier L scene arrives in M6.
  - **Before M6 sends model-written specs through this code** (from the M5 security review):
    - Claude supplies only the beats. The server fills the template, misconception, parameters and answers from the attempt and maths-core.
    - Each template gets a strict parameter schema that rejects unknown keys. The spec's misconception must match the template's, and specs get a size cap (about 8 KB) and a JSON depth cap.
    - The narration checks (words across zero-width spaces, control and invisible characters, every dash, NFC) are repeated in Python, with the reading-age and personal-data lints.
    - Templates declare the beat kinds they support (SPEC.md 8.1), and the spec check enforces them.
    - SPEC.md 6.7 gets retention rules for Tier L specs, narration, keyframes and TTS audio.
    - In its container the keyframe worker runs with Chromium's sandbox on, IMDSv2 with a hop limit of 1, and a role that can only write its screenshot prefix.
  - **For M8's content security policy:** scene positions and KaTeX output use inline `style` attributes, so the policy needs `style-src-attr 'unsafe-inline'` (and a KaTeX policy if Trusted Types arrive).
