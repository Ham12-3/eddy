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

Status: Accepted, pending confirmation of team size (ADR set accepted 3 November 2026)

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
- **Decision:** `pnpm e2e:storybook` opens every story at 375, 768 and 1280 px in light, dark, reduced motion and dyslexia mode. For each it runs axe (zero serious or critical violations allowed) and saves a full-page screenshot, which CI uploads as an artifact. A gallery story puts every component on one page for review by eye. Pixel-diff regression (`toHaveScreenshot`) is deferred until baselines can be produced on the CI platform, for example in the Playwright Docker image.
- **Consequences:** Visual regressions are caught by review and axe, not automatically. Revisit when the scene engine (M5) adds many more visuals.
