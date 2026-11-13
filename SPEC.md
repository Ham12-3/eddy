# Eddy: product and technical specification

Status: **approved** (v0.1, approved 3 November 2026)
Owner: Abdulhamid

Source brief: [docs/brief.md](docs/brief.md) (research report plus the Claude Code build prompt). Where this spec and the brief disagree, this spec wins. Every deliberate deviation is listed in section 15 and recorded as an ADR in [DECISIONS.md](DECISIONS.md). Delivery order and definitions of done live in [PLAN.md](PLAN.md).

---

## 1. The product in one paragraph

Eddy is an adaptive GCSE Maths tutor for students around the grade 3/4 boundary. When a student gets something wrong, Eddy works out which misconception caused it and plays a short animated explanation that starts from the student's own wrong answer, shows why it fails, builds the correct idea, then checks understanding with a fresh question. It supplements teachers. It never gives the answer to the question in front of the student.

---

## 2. Users and scope

### 2.1 MVP users

- **Students** aged 13 and over. Core audience: Year 10 and 11 (aged 14 to 16) sitting AQA GCSE Maths Foundation, predicted grade 3 or 4.
- **Post-16 resit students** of any age.
- **Parents**, linked to a student account only with the student's agreement. Read-only dashboard.
- **Internal admins**: read-only curriculum browser, scene gallery, safeguarding queue (named staff only).

### 2.2 MVP scope

- AQA 8300 Foundation by default. Edexcel 1MA1 and OCR J560 paper structures and calculator rules are stored, so the tutor can speak about the student's own board.
- 13 curriculum nodes covering the brief's 12 shortlisted topics (ratio and percentages are split into separate nodes):

| # | Topic | DfE codes | Main scene primitive |
|---|---|---|---|
| 1 | Negative numbers | N1, N2 | number line |
| 2 | Fractions and decimals on a number line | N1, N2, N10 | number line, hundred grid |
| 3 | Standard form | N9 | place-value slider |
| 4 | Percentages, including reverse percentages | N11, N12, R9 | bar model |
| 5 | Ratio | R4 to R7 | bar model |
| 6 | Linear equations | A17 | balance |
| 7 | y = mx + c | A9, A10 | coordinate grid |
| 8 | Angles and parallel lines | G3 | angle diagram |
| 9 | Transformations | G7 | transformation grid |
| 10 | Area and perimeter | G16, G17 (perimeter, circles, composite area only) | area model |
| 11 | Pythagoras | G20 | Pythagoras squares |
| 12 | Probability trees | P7, P8 | probability tree |
| 13 | Averages | S4 | data chart |

- Student flow: sign-up, onboarding, diagnostic, learning loop, practice, spaced review, progress map.
- Parent dashboard: progress, time spent, topics secured, support and safeguarding contacts. No tutor transcripts and no per-question answers in the MVP.
- English: data model and curriculum seed only, plus Loop 4 output schemas and calibration maths. Nothing student-facing.
- No billing. Access is by invite code (closed beta and school pilot).

### 2.3 Non-goals for the MVP

- User-to-user content or messaging, and live web search (keeps us out of Online Safety Act user-to-user and search scope).
- Grade predictions presented as fact. Grade-boundary context is only ever shown as a range with a caveat.
- Any AQA, Pearson or OCR questions, mark schemes, examiner reports or logos, anywhere, including prompts and evals.
- Higher tier content, teacher view, English marking, billing, native mobile apps.
- MP4 download. An export path is designed (section 8.6) but not built.

---

## 3. Decisions

### 3.1 From the interview (3 November 2026)

| Topic | Decision |
|---|---|
| Name | **Eddy**. Package scopes `@eddy/*`, Python packages `eddy_api`, `eddy_maths_core`. |
| Account model | **Student-first for everyone aged 13+.** Under-13s blocked. Parent link only with the student's agreement, with a permanent visible indicator. |
| Billing | **None in the MVP.** Invite codes. |
| Answer input | **Full maths editor (MathLive)** everywhere, with a custom Foundation virtual keyboard on touch devices. |
| Claude access | **Anthropic API with zero data retention (ZDR)** and no training on inputs. Pseudonymous IDs only in prompts. |
| Models | **Claude Opus 4.8** (`claude-opus-4-8`) for tutoring, scene specs and vision critique. **Claude Haiku 4.5** (`claude-haiku-4-5`) for safety classification, misconception fallback classification and bulk eval judging. |
| Auth | **Auth.js** in Next.js. Next.js is the backend-for-frontend (BFF). |
| Narration | **The device's own voice** (on-device speech synthesis in the browser, ADR-0029) until a paid voice is chosen. ElevenLabs first with a Polly fallback stays the plan for that (ADR-0011). |

### 3.2 Defaults I chose (override any of these in review)

Each has an ADR in [DECISIONS.md](DECISIONS.md).

- Tutor orchestration in **FastAPI + LangGraph** (the brief's stated preference).
- The brief's `services/tutor` becomes **`services/api`**: it owns the whole domain API, not just tutoring. `services/maths-core` stays a stateless verifier.
- **Alembic is the only schema source**, including the Auth.js tables. TypeScript never writes domain tables directly.
- **Deterministic-first scenes**: every seeded misconception has a parametric scene that needs no model call. Claude-personalised variants are a second tier.
- **Vision critique runs off the hot path.**
- **LLM traces in our own Postgres table plus OpenTelemetry**, not self-hosted Langfuse.
- **Storybook** for the design system.
- **Our own scene renderer** (ADR-0027, replacing Remotion, whose licence could not be obtained): each scene is a pure function of time, played by our own React Player. No third-party animation runtime.
- **No AWS deployment until you approve it.** CDK synthesises in CI from M0; first staging deploy planned for M10.

---

## 4. User journeys

### 4.1 Sign-up and onboarding (student-first)

1. **Invite code**, then email address, then a magic link (Auth.js email provider; Mailpit locally, Amazon SES in production).
2. **Age check.** Month and year of birth on a neutral screen that does not reveal the cut-off. Under 13: a kind stop screen, nothing stored except a short-lived cookie that prevents an immediate retry. Only birth month and year are stored (enough for age and school year).
3. **Privacy notice.** Child-friendly version (reading age about 12) with a link to the full notice. The acknowledged notice version is recorded.
4. **Set-up.** Exam board (AQA default), tier (Foundation; Higher shown as "coming later"), exam series, target grade (4 or 5), resitting yes or no, accessibility preferences (dyslexia mode, reduced motion, dark mode, captions-only, narration speed). No school name, no address, no phone number.
5. **Diagnostic** (about 15 minutes, can stop and resume). Adaptive multiple-choice items across the 13 nodes and their prerequisites. Every wrong option maps to a named misconception (the Eedi pattern). Self-rated confidence (1 to 4) before each reveal. Output: initial mastery per node, suspected misconceptions, a first plan.
6. **Optional:** invite a parent, or accept a parent's request.

All accounts get Children's Code defaults regardless of age. Nothing in the product changes behaviour at 16 or 18, so age assurance only has to answer one question: is this person 13 or over?

### 4.2 A learning session

- **Session home:** "today's plan" (one new node, due reviews, one re-check) with an honest time estimate. No streaks, no flames, no loss-aversion copy.
- **Teach:** worked example revealed step by step, then a faded example (student completes the last step, then the last two), then independent practice.
- **Answer:** MathLive maths field. Confidence prompt before marking.
- **Correct:** specific feedback on the strategy used. Learner model updates.
- **Wrong:** misconception detected, then the animated explanation (Loop 2), then one Socratic follow-up question, then a re-check item (different surface, same misconception), then model updates.
- **Help** is available at any time through the tutor panel: the hint ladder, never the final answer.
- **Stopping:** after a configurable time (default 25 minutes) a gentle note: "Good place to stop. Your next review is due Thursday."

### 4.3 Review and progress

- Review queue scheduled by FSRS. Interleaved practice starts once 3 or more nodes are SECURE.
- Progress map: a hand-ruled topic network with nodes filled like ink. States are "not started", "learning", "secure" and "needs review". Percentages are never the main signal.

### 4.4 Parents

- Linking works both ways: the student sends an invite link, or a parent requests a link using a code the student gives them. **The student must accept either way.**
- The student always sees "Your parent can see your progress" while a link is active, and can open a "what my parent sees" preview.
- Either side can end the link. The other side is told.
- Dashboard: topics secured, time spent this week, recent activity, upcoming reviews, support and safeguarding contacts. Parent views are written to the audit log.

### 4.5 Data rights and concerns

- Download my data (JSON plus a readable HTML page) and delete my account, each reachable in two clicks from settings. Deletion deactivates immediately and completes within 30 days.
- "Report a concern" is always visible in the footer and in the tutor panel.

### 4.6 Admin (internal, read-only in the MVP)

- Curriculum graph browser, misconception library, scene gallery (every default scene at 3 viewports in light, dark and reduced motion), safeguarding event queue.

---

## 5. Architecture

```
                         Browser
   Next.js client components, the scene Player, MathLive, KaTeX
                            |
                 HTTPS, Auth.js session cookie
                            |
             apps/web  (Next.js App Router, the BFF)
     Auth.js, server components, route handlers, generated API client
                            |
        signed service token (JWT, 60 s, aud = eddy-api)
                            |
                 services/api  (FastAPI, Python 3.12)
     domain API, learner model, tutor graph (LangGraph), safety
     pipeline, scene orchestration, safeguarding, privacy jobs,
     Alembic migrations, background worker process (SQS)
        |                 |                  |                |
        v                 v                  v                v
 services/maths-core   Anthropic API     (narration is   workers/scene-check
 (FastAPI, SymPy,      (Opus 4.8,        spoken on the   (Node + Playwright:
  stateless, no DB)     Haiku 4.5, ZDR)   device, 0029)    keyframes, DOM checks)

 Data: PostgreSQL 16, Redis 7, S3, SQS
 Local: docker compose (postgres, redis, S3Mock for S3, ElasticMQ for SQS (ADR-0016), mailpit)
 Target hosting (only with approval): AWS eu-west-2 via CDK (ADR-0014), or as proposed in
 ADR-0035, Vercel (web), Supabase (Postgres) and Fly.io (the rest), all in London
```

### 5.1 Components

| Path | Stack | Responsibility |
|---|---|---|
| `apps/web` | Next.js (App Router, latest stable at M0, pinned), React 19, TypeScript strict, Tailwind v4 driven by our tokens | Student, parent and admin UI. Auth.js. BFF: the browser never calls a Python service directly. |
| `packages/ui` | React, CSS variables, Storybook | Tokens, components, `MathField` (MathLive wrapper), `Maths` (KaTeX with MathML output). |
| `packages/scenes` | React, SVG | Primitives, templates, layout engine (pure TypeScript), the time-based scene renderer (ADR-0027), static checks, Player and controls, reduced-motion stepped renderer, static diagram renderer. |
| `packages/schemas` | zod | Source of truth for SceneSpec, TutorMessage, every LLM output, English marking output. Emits JSON Schema; pydantic models are generated from it. |
| `packages/api-client` | generated | TypeScript client generated from the `services/api` OpenAPI document. |
| `services/api` | FastAPI, SQLAlchemy 2, Alembic, pydantic v2, LangGraph, `anthropic` SDK | Everything stateful. Owns the database. Runs an HTTP process and a worker process (critique jobs and privacy jobs). |
| `services/maths-core` | FastAPI, SymPy, Hypothesis | Item generation, answer equivalence, step checking, distractors, misconception detection rules, MathJSON to SymPy conversion, verification of every number in scenes and tutor messages. No database. |
| `workers/scene-check` | Node, Playwright | Serves the scene engine's checks to services/api over HTTP (context, assembly and static checks, ADR-0030). Renders scenes headless, confirms DOM boxes match the computed layout, and returns keyframes for the background critique. |

### 5.2 Schema directions

- **Domain API:** pydantic (FastAPI) is the source. OpenAPI, then `packages/api-client`. Contract tests in CI.
- **Scenes and LLM I/O:** zod (`packages/schemas`) is the source. JSON Schema, then generated pydantic models used by `services/api` and the structured-output requests to Claude.

### 5.3 Trust boundaries

- Only `apps/web` is public. `services/*` and workers run in private subnets.
- Browser to web: Auth.js session cookie (httpOnly, Secure, SameSite=Lax), CSRF protection on mutations, strict CSP.
- Web to api: a JWT signed by web with its private key, 60-second expiry, audience `eddy-api`, subject = user id, role claims. The api verifies against web's public key.
- Api to maths-core: private network plus a static service token.
- Student text, uploaded work and anything the student types is data, never instructions, at every LLM boundary.

---

## 6. Data model

The brief's tables (docs/brief.md, Deliverable B section 3) are adopted as written, with the additions and changes below. Full column definitions land with the M2 migrations.

### 6.1 Curriculum

- `curriculum_spec`, `curriculum_node`, `node_prerequisite` (a DAG; a test fails on any cycle), `misconception`, `item`: as in the brief.
- **New** `item_family(id, node_id, template_id, description)`: groups items from the same template. Used for FSRS cards and for picking re-check items with a different surface.
- `misconception.detection_rules` uses a small rule language (defined in M2, executed by maths-core in M3): `distractor` (the answer equals the misconception rule applied to the item params), `structure` (a pattern over the MathJSON tree, for example "numerators added and denominators added"), and `classifier` (eligible for the Haiku fallback, which can only ever mark SUSPECTED).

### 6.2 Accounts and access

- Auth.js tables `users`, `accounts`, `sessions`, `verification_token`, created by Alembic. `users.role` is `student`, `parent` or `admin`. Service tokens may also carry `system`, for machine callers only, never for a user (ADR-0018).
- **New** `student_profile(user_id, birth_year, birth_month, board, tier, exam_series, target_grade, is_resitter, preferences jsonb)`.
- **New** `invite_code(code, cohort, max_uses, used_count, expires_at)`.
- **New** `parent_link(id, student_id, parent_user_id, status [REQUESTED|ACTIVE|ENDED], requested_by, accepted_at, ended_by, ended_at)`.
- **New** `notice_acknowledgement(user_id, notice_key, version, acknowledged_at)`.

### 6.3 Learning

- `attempt`: as in the brief, plus `response_mathjson`, `session_id`, `is_diagnostic`, `aided` (hint used or scene watched before answering).
- `mastery_state`, `misconception_state` (plus `evidence_attempt_ids`), `review_card`: as in the brief.

### 6.4 Scenes and narration

- `scene_spec`: as in the brief, plus `tier [DETERMINISTIC|LLM]`, `prompt_version`, `model`, `variant_key` (template, misconception and item parameters, to find a cached variant) and the background review's claim columns (ADR-0030).
- `scene_instance`: as in the brief, plus `step_backs`.
- **New** `audio_asset(id, provider, voice_id, provider_model, text_hash, s3_key, word_timings jsonb, duration_ms)`.

### 6.5 Tutor, traces and governance

- `tutor_session`, `tutor_message`: as in the brief, plus `hint_level` and `state` (the Loop 1 state when the message was produced).
- **New** `llm_call(id, route, model, prompt_id, prompt_version, input_tokens, output_tokens, cache_read_tokens, latency_ms, cost_estimate_gbp, stop_reason, safety_flags, student_id, created_at)`. Metadata only. Raw prompt and response text live only in `tutor_message` and follow its retention.
- `safeguarding_event`: as in the brief.
- **New** `audit_log(id, actor_id, actor_role, action, target_type, target_id, created_at)`. Append-only, enforced by database grants and a trigger.
- **New** `data_request(id, user_id, kind [EXPORT|DELETE], status, requested_at, completed_at)`.

### 6.6 English (model only)

- `set_text`, `question_type`, `level_descriptor`: as in the brief. Level descriptors are paraphrased in our own words, never copied.

### 6.7 Retention

- Raw `tutor_message` content: deleted after 90 days (configurable). Anonymised aggregates kept.
- LangGraph checkpoints (the lesson's position, ids, items and validated answers, never free text, ADR-0031): deleted with the tutor session by a trigger, and after 90 days (an M8 job).
- `llm_call`: metadata kept 12 months, then aggregated.
- Scene specs (Tier D and Tier L) hold no personal data: no student text, and the wrong answer is the one the misconception predicts for the item. They are kept like curriculum content. Which student watched which scene (`scene_instance`) is deleted with the account.
- Keyframes are held in memory for the critique and never stored. Narration audio is spoken on the device and never stored (ADR-0029).
- Deleted accounts: personal data removed within 30 days; aggregates keep no user id.
- `safeguarding_event`: default 12 months with a minimised excerpt. **Open question**, to settle with safeguarding advice in the DPIA.

---

## 7. The loops

### 7.1 Loop 1: adaptive learning loop

**Code decides, the model speaks.** Every transition is a deterministic function of attempts and learner state. Claude writes the words inside a state; it never chooses the next state.

```
PLAN -> TEACH_WORKED -> PRACTISE_FADED -> PRACTISE_INDEPENDENT -> CONFIDENCE -> MARK
MARK (correct) -> UPDATE -> SCHEDULE -> NEXT
MARK (wrong)   -> DIAGNOSE -> EXPLAIN (scene) -> FOLLOW_UP (Socratic) -> RECHECK -> UPDATE -> SCHEDULE -> NEXT
Interrupts from any state: HELP (hint ladder), OFF_TOPIC (redirect), SAFEGUARDING (ends tutoring), PAUSE
```

Implemented as a LangGraph graph with a Postgres checkpointer, so a session survives refreshes and device switches. The checkpoint holds the lesson's position, ids and validated answers, never free text; it runs inside each request's transaction, and its tables come from Alembic (ADR-0031).

Rules (from the brief, made precise):

- **Node selection:** the lowest-mastery node whose prerequisites are all SECURE, weighted by Foundation mark density and the student's target grade.
- **Mastery:** `p_mastery >= 0.95` and at least 3 correct, unaided attempts spread over at least 2 sessions on different days.
- **Aided attempts** (hint used, or a scene watched before answering) update BKT at reduced weight and never count towards the 3 unaided.
- **Two failures** on a node trigger a short prerequisite diagnostic, lowest-mastery prerequisites first.
- **Interleaving** starts once 3 or more nodes are SECURE.
- **Confidence** is asked before correctness is revealed. "Confident and wrong" goes to the front of the remediation queue.

Learner model:

- **BKT per node.** Starting parameters: `p_init 0.2`, `p_learn 0.15`, `p_guess 0.2` (0.25 for 4-option multiple choice), `p_slip 0.1`. Refitted per node once pilot data exists.
- **Prerequisite propagation:** when node X becomes SECURE, each prerequisite P gets a capped prior boost proportional to `strength(X, P)`.
- **Elo** per item for difficulty (K shrinks as attempts grow) and per student per strand for ability. Practice items target roughly 70 to 85% predicted success.
- **FSRS** (the open-source `fsrs` Python package) per node review card, target retention 0.9. The rating comes from correctness, confidence, hints and time.
- **Misconception states:** SUSPECTED (one rule match, or the classifier) to CONFIRMED (second match or diagnostic) to REMEDIATED (scene plus follow-up done) to RECHECKED_OK, or RECURRED. A recurrence triggers a different scene variant.

### 7.2 Loop 2: animation generation (deterministic first)

Two tiers.

**Tier D, deterministic (the default).** Every seeded misconception has a hand-authored parametric scene. Given the item parameters and the student's actual answer, the template builds a complete SceneSpec with no model call. Narration comes from reviewed sentence templates with slots. Always available, always verified, under 300 ms.

**Tier L, Claude-personalised.** Opus 4.8 fills a SceneSpec using only the same template vocabulary, to adapt the narration and beat choice to this student (their answer, confidence, history, and which variant did not work last time). Used when:

- the student asks to see it another way,
- the misconception has RECURRED,
- a wrong answer matches no deterministic rule but the classifier suggests a misconception (only for nodes with a generic template),
- precomputing variants at build time.

Tier L pipeline:

1. Pick the template for (node, misconception).
2. Claude returns the beats through structured output: each beat's kind, the elements it points at and its narration, from enums built for the template. The server keeps the template, misconception, parameters and answers from the Tier D spec (ADR-0030). No coordinates, colours or styling.
3. Validate: schema; at most 6 beats; at most 25 narration words per beat; reading-age check (target UK reading age 13 or below); UK spelling, tone and no-dash lint; numbers in digits; different from what the student has seen (ADR-0030).
4. maths-core verifies every number and expression: parameters, labels and every numeric claim extracted deterministically from the narration. Any mismatch is a hard fail.
5. The layout engine places every element in template-defined regions for 16:9 and 4:5, measuring text with real font metrics.
6. Static checks on the computed layout: overlap, off-canvas, 6% safe margins, text overflow, minimum font size, contrast of every colour role on both themes, colour semantics, at most 3 moving elements per beat, no flashing above 3 per second.
7. **Serve.** The route never waits for Claude: it serves a reviewed Tier L variant this student has not seen, or the Tier D scene at once, and queues a request that the worker generates through steps 2 to 6; the student's app fetches it when it is ready. The Player renders it in the browser. Scenes narrate the answer the misconception predicts, after maths-core confirms the student's answer equals it (ADR-0030).
8. **Background:** the scene-check worker renders keyframes (end state of each beat, both aspect ratios, light and dark) and confirms DOM boxes match the layout. Opus 4.8 critiques the light keyframes at a laptop and a phone width, with the scene's facts, against the checklist (the maths is true, signalling, coherence, one idea per beat, matches narration). Other students get a variant only once it has passed. On failure the spec is evicted from the cache and regenerated with structured feedback (at most 3 generations); the Tier D scene is used meanwhile. The queue is the `scene_spec` table itself (ADR-0030).
9. **Narration:** the device's own voice (ADR-0029). The Player speaks each beat's line with on-device speech synthesis, and a beat holds until its line is spoken. Captions always come from the same text and carry the scene on devices with no voice. A paid voice (ElevenLabs with word timings, cached by `hash(provider, voice, model, text)`, ADR-0011) can replace it behind the same interface.
10. **Cache key:** `hash(template@version, misconception, params, beats)` for one scene, and `variant_key = hash(template@version, misconception, params)` to find every variant for an item and mistake; a student never sees the same variant twice. Precompute (`pnpm scenes:precompute`): 3 Tier L variants per seeded misconception, through the full pipeline including critique.
11. **Telemetry:** watch time, replays, step-backs and re-check result per variant, so we can compare variants, and Tier D against Tier L, in evals and the pilot.

Latency targets: cache hit under 300 ms; Tier D under 300 ms, shown immediately while a Tier L variant is built ("Building another way to see it"); a new Tier L variant ready within 20 s at p95 (it was 8 s; changed on 7 November 2026 because one Opus 4.8 call already takes 12 s at p95, and the student is never left waiting). No spinner for longer than 2 s without content.

### 7.3 Loop 3: maths verification

Nothing mathematical reaches a student unless maths-core has verified it: questions, answer keys, distractors, worked steps, tutor messages and scenes.

- **Input:** MathLive produces MathJSON. maths-core validates it (size and depth limits, an allow-list of operators and symbols) and converts it to SymPy with a tree walker. User input never goes through `eval`, `sympify` on strings, or `parse_expr`.
- **Equivalence:** symbolic `simplify(a - b) == 0`, plus numeric sampling at 20 random points that avoid singularities. Then answer-format rules: exact fraction or decimal, decimal places, significant figures, units, simplest form when the question asks for it.
- **Steps:** each step must be equivalent to the previous one, or a valid transformation of an equation (same solution set). The tutor comments on the first invalid step only.
- **Distractors:** each distractor must equal the result of applying its misconception rule to the item parameters. Property tests also assert that no distractor equals the answer and that distractors are distinct.
- **Tutor messages:** the structured output lists every maths claim; maths-core verifies them. A deterministic answer-leak check compares every expression in the message against the current item's answer and its equivalent forms. Failure means regenerate (at most 2 times), then fall back to a templated hint at the same ladder level.
- **Targets:** p95 verification under 150 ms. Release gate: 100% of the golden set verified.

### 7.4 Loop 4: English marking (scaffolding only)

zod and pydantic output schemas (`ao_scores`, `next_step`, `confidence`), plus QWK, exact and adjacent agreement metrics with unit tests. No prompts run against students. Ships in M11.

### 7.5 Loop 5: how I work

See PLAN.md, "How each milestone runs".

### 7.6 Loop 6: evaluation

`/evals`:

| Suite | What | When it runs |
|---|---|---|
| maths | 300 golden items and 100 scene specs, 100% required | Every PR (deterministic, no LLM cost) |
| misconception | 200 labelled wrong answers; precision and recall per misconception | Rules on every PR; classifier part on PRs touching prompts or rules |
| pedagogy | 50 scripted multi-turn conversations: stuck, guessing, demanding the answer, off-topic, distress disclosure, prompt injection in uploaded work | PRs touching prompts, the tutor graph or safety |
| animation | Static and DOM check pass rate; critique score | PRs touching templates or scene prompts |

- Judges: Haiku 4.5 for bulk scoring, Opus 4.8 on a 10% calibration sample, both validated periodically against your own ratings.
- Thresholds in `evals/thresholds.yaml`. CI blocks merges on regressions beyond them.
- Prompts live in `prompts/*.md` with semver front matter. The version is recorded on every message and every `llm_call`.
- LLM-backed suites need an API key in CI secrets and spend money, so they are opt-in per PR via a label until you say otherwise.

---

## 8. Scene language (SceneSpec v1)

### 8.1 Shape

```json
{
  "schema": "scene-spec/1",
  "template": "bar_model.share_in_ratio@1",
  "misconception": "RATIO_DIVIDE_BY_EACH_PART",
  "params": { "total": 45, "ratio": [2, 3], "unit": "GBP" },
  "studentAnswer": ["List", 22.5, 15],
  "correctAnswer": ["List", 18, 27],
  "beats": [
    { "kind": "show_given", "focus": ["total", "ratio"],
      "narration": "We need to share £45 in the ratio 2 to 3." },
    { "kind": "show_student_working", "focus": ["student.split"],
      "narration": "You worked out 45 divided by 2, and 45 divided by 3." },
    { "kind": "highlight_slip", "focus": ["student.sum"],
      "narration": "Check: £22.50 plus £15 is £37.50, not £45. Some money has gone missing." },
    { "kind": "build", "focus": ["bar.parts"],
      "narration": "Draw the bar. 2 parts plus 3 parts makes 5 equal parts." },
    { "kind": "transform", "focus": ["bar.partValue"],
      "narration": "£45 shared into 5 parts is £9 for each part." },
    { "kind": "reveal_correct", "focus": ["answer"],
      "narration": "So 2 parts is £18 and 3 parts is £27. Together they make £45." }
  ]
}
```

- `focus` refers to element ids that the template declares. The model can never invent an element.
- Beat kinds come from a closed vocabulary: `show_given`, `ask_prediction`, `show_student_working`, `highlight_slip`, `build`, `transform`, `compare`, `reveal_correct`, `recap`. Each template declares which kinds it supports.
- Colour is assigned by element role, never by the model: given = `--ink`, student = `--student`, faulty step = `--misconception`, corrected idea = `--correct`, "look here" = `--highlight`.

### 8.2 Primitives (M5)

Number line, bar model, balance, coordinate grid, transformation grid, angle diagram, area model, Pythagoras squares, probability tree, data chart, place-value slider.

### 8.3 Layout engine

Pure TypeScript. Each template declares named regions for 16:9 and 4:5 with 6% safe margins. Elements are assigned to regions; text is measured with the actual font files, so layout is identical in Node and in the browser. Layout output feeds the static checks before anything renders.

### 8.4 Playback and accessibility

- Each scene is a pure function of time: given the spec, the layout and a time in milliseconds, it gives the picture (SVG shapes plus DOM text). Our own Player drives the time in the browser; the keyframe checker sets it directly. No server render on the normal path (ADR-0027).
- Controls: play and pause, step back and forward one beat, replay, speed (0.75x, 1x, 1.25x), captions on and off, transcript.
- Never autoplays movement. Beat transitions 500 to 900 ms; holds of at least 1.2 s after each new idea.
- `prefers-reduced-motion` (or the in-app setting): stepped states with 150 ms opacity cross-fades.
- Every scene also renders as a static annotated diagram (each beat's end state with annotations) for print, slow devices and screen reader users.
- All text is real DOM text. Maths uses KaTeX with MathML output. Colour is never the only signal: the faulty step also gets a strike or bracket mark and a text label.

### 8.5 Rules the scenes package enforces

Objects persist and morph rather than cut. A quantity keeps its colour for the whole scene. One new idea per beat. At most 3 moving elements at once. Labels sit next to their objects. Caveat "teacher's pen" annotations only for signalling.

### 8.6 MP4 export (designed, not built)

The same scenes rendered frame by frame in headless Chromium (the time set for each frame, then captured) and encoded to MP4, as an SQS job in eu-west-2, stored in S3 behind CloudFront. Built after the MVP if parents or schools ask for it; the encoder and its licence are chosen then.

---

## 9. Tutor behaviour and safety

### 9.1 Behaviour

`prompts/tutor.md` is written from the brief's tutor behaviour spec (docs/brief.md, Deliverable B section 5) and is the source of truth. Highlights: one question at a time; smallest useful hint; hint ladder (nudge, pointed question, partial worked step, worked example of a different but parallel problem); never the final answer to the current problem; warm, direct, no emoji, no baby talk; 60 words or fewer unless showing a worked example; UK English; precise command words; clearly an AI; encourages asking their teacher.

Tutor output is structured:

```
TutorMessage {
  text: string                 // 60 words max unless kind = worked_example_parallel
  kind: question | hint | feedback | worked_example_parallel | redirect
  hint_level: 0 to 4
  maths: [{ expr: MathJSON, role: given | claim | step }]
}
```

### 9.2 Pipeline for every student message

1. **Limits:** length cap and per-student rate limit (Redis).
2. **Deterministic safeguarding tripwires** (a reviewed phrase list, high recall). A hit goes straight to step 4.
3. **Input classifier** (Haiku 4.5, structured): safeguarding, harmful request, off-topic, prompt-injection attempt, answer demand.
4. **Safeguarding:** stop tutoring for the session. Show the approved, static, human-written script (never model-generated) with Childline 0800 1111, Shout 85258 and 999 in an emergency. Create a `safeguarding_event`. In the B2C MVP there is no school DSL, so events go to a named Eddy safeguarding lead (see open questions). Parents are **not** notified automatically, because the parent may be the source of risk.
5. **Generate** with Opus 4.8. Student text is passed as clearly delimited data.
6. **Output checks:** maths verification (Loop 3), answer-leak check, word limit, UK spelling and no-dash lint, Haiku 4.5 output classifier for tone and safety.
7. **On failure:** regenerate (at most 2 times), then a templated hint at the same ladder level.

Tutor messages are not streamed: they are short, and they must pass the checks before the student sees them. Target p95 for a tutor turn: under 12 s, with a visible "Eddy is writing" state (it was 3.5 s; changed on 10 November 2026 because the input check, the message and the output check are three model calls in sequence, about 5.6 s even when the first draft passes; measured at 6.1 s at p50 and 11.0 s at p95).

---

## 10. Claude usage

Model IDs live only in `config/models.yaml`, so any route can switch model with a one-line change and an eval run.

| Route | Model | Thinking and effort | Output |
|---|---|---|---|
| `tutor.turn` | `claude-opus-4-8` | Adaptive thinking set explicitly (on Opus 4.8, leaving it out means no thinking). Effort starts at `low`, tuned by the pedagogy eval. | Structured `TutorMessage` |
| `scene.generate` | `claude-opus-4-8` | Adaptive, effort `high` | Structured `SceneSpec` |
| `scene.critique` | `claude-opus-4-8` | Adaptive, effort `medium`; keyframe images as input | Structured verdict |
| `safety.input`, `safety.output` | `claude-haiku-4-5` | No thinking. No effort parameter (unsupported on Haiku 4.5). | Structured verdict |
| `misconception.classify` | `claude-haiku-4-5` | No thinking | One candidate code or `NONE`; result can only be SUSPECTED |
| `eval.judge` | `claude-haiku-4-5` bulk, `claude-opus-4-8` on a 10% sample | As above | Rubric scores |

Rules:

- Official `anthropic` Python SDK only, with its structured-output helper and pydantic models generated from `packages/schemas`. All Claude calls happen in `services/api`; nothing else holds the key.
- Never send `temperature`, `top_p` or `top_k` (the API rejects them on every model since 21 October 2026). No assistant prefill.
- Prompt caching: stable prefix first (system prompt, tutor rules, template vocabulary, node context), student-specific content after the last breakpoint. Verified by `cache_read_input_tokens` in `llm_call`.
- Typed SDK exceptions; retry 429, 5xx and connection errors with backoff; never retry 400s.
- Data minimisation: no names, emails, birth dates or school names in any prompt. A per-student pseudonymous id only.
- ZDR must be confirmed with Anthropic before any real student data is processed (approval gate in PLAN.md).
- To confirm in M6 against current docs: structured-output support and minimum cacheable prefix for both models.

Rough cost per 25-minute session (to be measured in M7): about 15 tutor turns on Opus 4.8 at $5 / $25 per million tokens in / out, mostly cached prefix, plus about 30 Haiku 4.5 safety calls at $1 / $5, comes to roughly 25 to 35 US cents, assuming cache reads cost about a tenth of the input price. Scenes are mostly Tier D or cached. For the record: Opus 5.5 ($4 / $20) and Haiku 5.5 ($0.10 / $0.50) are cheaper than the chosen pair, and switching is a config change plus an eval run.

---

## 11. Design system: "Paper and Ink"

Adopted in full from the brief (docs/brief.md, Deliverable B section 6): concept, banned list, typography, colour tokens, spacing, radii, elevation, motion, components, scene visual language and accessibility requirements.

Additions:

- Fonts are self-hosted at build time (no runtime requests to Google from students' browsers).
- MathLive is themed with our tokens; the student's input renders in `--student`. A custom Foundation virtual keyboard (digits, fraction, power, root, negative, π, decimal point, brackets, units).
- KaTeX colours come from the scene colour roles.

**Token issues found while writing this spec** were confirmed by a full audit in M1 and resolved with Abdulhamid's approval (ADR-0019):

| Issue | Resolution |
|---|---|
| Light `--accent` #D9480F fails as text (3.9:1) and behind white labels (4.3:1); darkening it makes it look like the misconception red | Light accent #F08C4A, a marker-orange fill with ink text (6.5:1), never used as text |
| Dark accent #FF7A3D was nearly identical to dark misconception #FF7A66 (20.6 CIELAB units apart) | Dark accent #FFA552 with dark text (9.5:1); both accents now at least 30 units from the red |
| Coloured text on `--highlight` fails in both themes; dark ink on dark highlight fails (4.0:1) | Only ink text sits on a highlight; dark highlight #6B5410 (5.9:1) |
| `--rule` is too faint for input edges (1.35:1, 1.43:1) | New `--field-border` (light #8A8473, dark #6B7380); `--rule` is decorative only |
| White text on the dark accent fails (2.6:1) | New `--on-accent` token |

Every allowed pairing is listed in `packages/ui/src/tokens/contrast-pairs.ts` and tested in light, dark and dyslexia modes.

---

## 12. Safety and compliance

The brief's section 7 (Deliverable B) is adopted in full. Specifics that follow from the interview:

- **Children's Code:** all 15 standards apply to every account, whatever the age. Profiling only for the core adaptive-learning purpose, justified in the DPIA. No nudges, streaks or guilt copy. Geolocation never collected. Parental visibility always signalled to the student.
- **Lawful basis (proposed, needs legal review):** legitimate interests for the core tutoring service and adaptive profiling, with a documented balancing test in the DPIA. Parent linking is the student's own choice. Under-13s are blocked rather than routed to parental consent.
- **International transfers:** Anthropic is a processor outside the UK. Data processing agreements, UK transfer mechanisms (IDTA or the UK Addendum, or adequacy where it applies), ZDR with Anthropic, and only pseudonymous, minimised data sent. Narration is spoken on the student's device, so its text goes to no supplier (ADR-0029). If a paid voice is added, its supplier joins this list and narration text must never contain personal data.
- **No student data used to train any model**, ours or a supplier's.
- **DfE generative AI product safety standards:** compliance matrix in `/compliance/dfe-standards.md`, mapping each standard to features, tests and evidence.
- **Online Safety Act:** no user-to-user content and no live search in the MVP. Scoping decision documented.
- **Copyright:** original, template-generated items only. English set texts shown in full only when public domain.
- `/compliance` files are edited only with your explicit go-ahead (enforced by a permission rule from M0).

---

## 13. Non-functional requirements

| Area | Target |
|---|---|
| Web performance | LCP under 2.5 s on a mid-range Android phone over 4G; learning route JavaScript budget set in M8 |
| Scene start | Under 300 ms on cache hit or Tier D |
| Tutor turn | p95 under 12 s end to end, with an "Eddy is writing" state (section 9.2) |
| Maths verification | p95 under 150 ms |
| Accessibility | WCAG 2.2 AA; axe zero serious or critical on every page; full keyboard operation; 44 x 44 px targets |
| Security | OWASP ASVS Level 2; strict CSP; rate limits; prompt-injection test suite; secrets in AWS Secrets Manager; dependency scanning in CI |
| Privacy | No third-party analytics, trackers or ad tech. First-party product telemetry only |
| Browsers | Last 2 versions of evergreen browsers; iOS Safari 17 and later |
| Data residency | All databases, storage and queues in eu-west-2 |

---

## 14. Risks

| Risk | Mitigation |
|---|---|
| Model gets maths wrong | Loop 3 on every output; deterministic Tier D scenes; 100% golden-set gate |
| Tutor gives away answers | Deterministic answer-leak check plus classifier; "demand the answer" eval scenarios must score zero leaks |
| Missed distress disclosure | Deterministic tripwires before the classifier; recall threshold on the distress eval set; static safeguarding script |
| Layout defects in generated scenes | Template-only vocabulary; layout engine; static and DOM checks; critique off the hot path; Tier D fallback |
| Tutor latency | Prompt caching; low effort; short outputs; no streaming but a clear writing state; measured p95 |
| MathLive on small phones and with screen readers | Custom keyboard; M1 accessibility review; manual screen reader checks in M8 |
| Opus 4.8 costs more than newer models | One-line model switch per route, judged by evals |
| Student-first accounts for 13 to 15 year olds | All-users Children's Code defaults; DPIA; legal review before launch |
| Our own scene renderer | No licence or vendor risk, but we maintain it: kept small, pure and unit-tested (ADR-0027) |

---

## 15. Deviations from the brief

1. `services/tutor` renamed `services/api`, owning the domain API as well as tutoring. (ADR-0003)
2. Scenes are deterministic first, with Claude-personalised variants as a second tier. (ADR-0006)
3. Keyframe rendering and vision critique run after serving, not before. (ADR-0007)
4. LLM traces stored in Postgres plus OpenTelemetry rather than self-hosted Langfuse. (ADR-0009)
5. Models: Opus 4.8 and Haiku 4.5, as chosen in the interview. (ADR-0005)
6. Student-first accounts with student-consented parent links, as chosen in the interview. (ADR-0002)
7. MathLive input everywhere, with a MathJSON pipeline. (ADR-0004)
8. MP4 export designed but not built in the MVP.
9. 13 curriculum nodes (ratio and percentages split) and 13 default scenes, rather than 12.
10. Proposed token fixes for contrast (section 11), pending the M1 contrast test.
11. Scenes play on our own time-based renderer instead of Remotion, whose licence could not be obtained. (ADR-0027)

---

## 16. Open questions (none block M0)

1. **Safeguarding route for B2C:** who is Eddy's named safeguarding lead, what response time applies, and when do we contact emergency services? Needs advice from a safeguarding professional before any real student uses the tutor.
2. **Legal review** of the lawful basis, the DPIA and the privacy notices before launch.
3. **Remotion licence:** resolved. It could not be obtained, so scenes use our own renderer (ADR-0027).
4. **ZDR with Anthropic.** A paid voice (the ElevenLabs data processing agreement and a British voice) waits until one is chosen (ADR-0029).
5. **School pilot:** partner and timing, which decides when the teacher-facing reports in the DfE matrix matter.
6. **Retention** of safeguarding excerpts.
