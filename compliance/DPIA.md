# Data protection impact assessment

**Status: DRAFT, 12 November 2026 (updated 13 November 2026), for review by the product owner and a lawyer.** Not approved. Nothing in this document is a legal conclusion. Every lawful basis, retention period and risk rating below is a proposal until the legal review (SPEC.md section 16.2) and the sign-off in section 7.

Structure follows the ICO's DPIA template (steps 1 to 7). Every factual claim cites the file, migration, test or ADR that shows it, so a reviewer can check it. Anything not yet decided or not yet built is written as **Open:** with an owner. The state described is the code at commit `1f5a9c4` (M10) on branch `m10-hardening`; updated on 13 November 2026 for that commit.

---

## 1. Need for a DPIA

Eddy is an adaptive GCSE Maths tutor for students aged 13 and over in the UK (SPEC.md sections 1 and 2.1). A DPIA is needed because the processing:

- uses the personal data of children (13 to 17) as its core audience, and all accounts get Children's Code defaults whatever the age (ADR-0002). Standard 2 of the ICO Age Appropriate Design Code expects a DPIA for any online service likely to be accessed by children;
- profiles learners to adapt teaching: per-topic mastery estimates (BKT), misconception tracking and spaced review scheduling (FSRS) (SPEC.md section 7.1, ADR-0026, `services/api/src/eddy_api/db/models/learning.py`);
- uses an innovative technology: a large language model (Anthropic's Claude) reads students' free-text messages and answers (SPEC.md section 10, ADR-0005, ADR-0031);
- sends personal data to a processor outside the UK (Anthropic) (SPEC.md section 12);
- may capture special category data and data about risk to a child through safeguarding disclosures (ADR-0031, `services/api/src/eddy_api/tutor/safeguarding.py`);
- links a child's account to a parent's (ADR-0033).

---

## 2. Description of the processing

### 2.1 Nature: how data is collected, used, stored and deleted

**Collection.** Data comes only from the student or parent through the web app. There is no third-party data, no school data feed, no analytics, trackers or ad tech (SPEC.md section 13, Privacy row), and the web app sends `Permissions-Policy: camera=(), microphone=(), geolocation=()` (`apps/web/next.config.ts`).

**Architecture.** The browser talks only to the Next.js app (`apps/web`), which is the backend-for-frontend. It calls `services/api` (FastAPI) with a JWT it signs, valid 60 seconds, audience `eddy-api` (SPEC.md section 5.3, ADR-0008). `services/api` owns the PostgreSQL database and is the only process that calls Claude (SPEC.md section 10). `services/maths-core` verifies maths and holds no database. `workers/scene-check` renders scenes and holds no personal data (SPEC.md section 5.1).

**Data categories held** (from `services/api/src/eddy_api/db/models/*.py`, SPEC.md section 6):

| Category | Where | Notes |
|---|---|---|
| Email address, role, optional first name, join date, deactivation date | `users` (`models/accounts.py`) | The name column exists but no sign-up step collects it; it is "never sent to any model" (comment in `models/accounts.py`). |
| Birth month and year (never the day) | `student_profile`, `pending_signup` | Used for the 13+ check and school year (ADR-0032). |
| Exam board, tier, exam series, target grade, resitting, accessibility and display preferences | `student_profile` | No school name, address or phone number is collected (SPEC.md section 4.1, `routes/me.py` docstring). |
| Sign-in data: hashed session tokens (SHA-256), sign-in link tokens, auth provider rows | `sessions`, `verification_token`, `accounts` | No OAuth tokens are stored (`models/accounts.py`, migration 0002). |
| Invite code used | `invite_redemption`, `invite_code` | Cohort of a closed beta or pilot. |
| Pending sign-up (email, birth month and year or a parent link code id) | `pending_signup` | 24 hours, then purged (ADR-0032, `jobs.py`). |
| Answers (raw text, MathJSON, parsed), correctness, detected misconception, confidence (1 to 4), hints used, aided flag, time taken | `attempt` (`models/learning.py`) | |
| Learner model: mastery per topic, misconception states with evidence attempt ids, review cards | `mastery_state`, `misconception_state`, `review_card` | Profiling (section 4.4). |
| Diagnostic progress | `diagnostic_session` | Holds questions asked and the item on screen, "never free text" (`models/learning.py`). |
| Tutor lessons and messages (free text from the student and the tutor) | `tutor_session`, `tutor_message` (`models/tutor.py`) | Message text deleted after 90 days (section 2.2). |
| LangGraph checkpoints (lesson position, ids, items, validated answers) | `checkpoints`, `checkpoint_blobs`, `checkpoint_writes` | No free text (ADR-0031); deleted with the lesson by a trigger (migration 0005). |
| Scenes watched, watch time, replays | `scene_instance`; Tier L requests in `scene_request` | `scene_request` holds "no student text" (`models/scenes.py`). Scene specs hold no personal data (SPEC.md section 6.7). |
| Model call metadata: route, model, tokens, latency, cost, stop reason, safety flags, student id | `llm_call` | Never prompt or response text (ADR-0009). |
| Safeguarding events: category, severity, excerpt of the student's words (at most 280 characters), action taken, notified party, review fields | `safeguarding_event` (`models/governance.py`, `tutor/safeguarding.py` `MAX_EXCERPT`) | Likely to include special category data (section 4.1). |
| Concern reports: category (SAFETY, CONTENT, PRIVACY, OTHER), message (up to 2000 characters), page path, lesson id | `concern_report` | |
| Privacy notice acknowledgements (notice and version) | `notice_acknowledgement` | Notice version 0.2.0 (`apps/web/src/lib/notices.ts`). |
| Parent links (status, who asked, dates) and link codes (SHA-256 hash only, 7 days, single use) | `parent_link`, `parent_link_code` | ADR-0033, migration 0007. |
| Data rights requests (kind, status, dates) | `data_request` | Kept without the person's id after erasure (`models/governance.py`). |
| Audit log: actor id and role, action name, target type and id | `audit_log` | Never an email address or a student's words (`audit.py`). Append-only (section 6). |
| Visitor rate-limit keys: a keyed HMAC-SHA256 of the IP address, never the address | Redis (in-memory fallback) | `apps/web/src/lib/visitor.ts`, ADR-0032. |
| Cookies: a signed, http-only sign-up cookie (invite, birth month and year, 30 minutes); an under-13 retry cookie (24 hours); the Auth.js session cookie | Browser | ADR-0032. |

Narration is spoken by the device's own voice and never leaves the device; no audio is stored (ADR-0029). Keyframes for scene critique are held in memory only (SPEC.md section 6.7).

**Use.** Data is used to run the tutoring loop (choose the next question, detect misconceptions, play an explanation, schedule review), to run the safety pipeline, to show a linked parent a progress summary, and to keep the service secure (sections 2.4 and 4).

**Deletion.** See section 2.2 and `compliance/runbooks/data-rights.md`.

### 2.2 Scope: volume, retention, geography

**Volume.** Access is by invite code only (closed beta and school pilot, SPEC.md section 2.2). Invite codes have a maximum number of uses (`invite_code.max_uses`). **Open:** expected number of students and parents in the beta and pilot (owner: the product owner).

**Retention.** What is decided and built, decided but not built, and still open (SPEC.md section 6.7, ADR-0024, ADR-0032, ADR-0033, `services/api/src/eddy_api/jobs.py`):

| Data | Rule | State |
|---|---|---|
| Tutor message text | Deleted after 90 days (`TUTOR_MESSAGE_DAYS`, `config.py`); the row stays with `content_deleted_at` set | Decided and built (`jobs.purge`, `test_purge_removes_what_has_expired_and_old_message_text`) |
| LangGraph checkpoints | Deleted with the lesson (trigger, migration 0005) and after 90 days | Decided and built |
| Sign-in links | Expire after 30 minutes, work once; expired rows purged | Built (ADR-0032, `jobs.purge`) |
| Sessions | 7 days; expired rows purged | Built (M8 evidence in PLAN.md, `jobs.purge`) |
| Pending sign-ups | 24 hours, then purged | Built |
| Under-13 retry cookie | 24 hours, nothing else stored | Built (ADR-0032, `test_nothing_is_stored_for_someone_under_13`) |
| Deleted accounts | Deactivated at once; personal data erased within 30 days | Built as a job (`jobs.erasures`), which the worker runs every 15 minutes and once at start (`services/api/src/eddy_api/worker.py` `privacy_tick`, ADR-0034); the 30 days is not enforced or tracked by code (section 5, risk R10) |
| `llm_call` metadata | 12 months, then aggregated | Decided (SPEC.md section 6.7), **not built**: no job purges or aggregates `llm_call`. **Open** (owner: engineering) |
| Anonymised aggregates | "Aggregates keep no user id" | Decided, **not built**: no aggregation exists yet |
| `safeguarding_event` | SPEC.md proposes 12 months with a minimised excerpt | **Open** (SPEC.md sections 6.7 and 16.6, ADR-0024): to set with safeguarding advice. Until set, rows are never purged and block full deletion of the account row (`ondelete=RESTRICT`) |
| `concern_report` (SAFETY) | Kept as a safety record | **Open**, same as safeguarding events (ADR-0033) |
| `concern_report` (other categories) | Deleted at erasure (`privacy.erase`) | While the account is active: **Open** |
| `audit_log` | Append-only | **Open** (ADR-0024, ADR-0032). Rows keep the actor's UUID after erasure |
| `data_request` | Kept without the person's id after erasure, for accountability | Period **Open** |
| Ended `parent_link` rows; expired `parent_link_code` rows | Deleted at erasure | While the account is active: **Open**; expired codes are not purged by `jobs.purge` |
| Account and learning data of an inactive account | None | **Open**: no inactivity rule exists |
| Database backups, S3 object versions | CDK defines RDS backups of 7 days and S3 non-current versions expiring after 30 days (`infra/lib/eddy.ts`) | Not deployed (ADR-0014). **Open:** how erasure applies to backups (owner: data protection lead with a lawyer) |
| Application and access logs | None set | **Open.** M8 recorded that access logs can hold the email address in sign-in link URLs, to strip in M10 (PLAN.md M8 evidence) |

Owner for every open retention period: the data protection lead, with a lawyer, and the safeguarding lead for safety records.

**Geography.** Students are in the UK. Planned hosting is AWS eu-west-2 (London) for all databases, storage and queues (SPEC.md section 13, `infra/lib/eddy.ts` `EDDY_REGION`), but **nothing is deployed** (ADR-0014). Claude calls go to Anthropic, outside the UK (SPEC.md section 12).

### 2.3 Context

- **Who:** students aged 13 and over (core: Year 10 and 11, aged 14 to 16), post-16 resit students of any age, parents linked only with the student's agreement, and internal admins (SPEC.md section 2.1). Under-13s are blocked (ADR-0002, ADR-0032).
- **Relationship and control:** students sign themselves up (student-first, ADR-0002). There is no billing and no upsell (ADR-0012, SPEC.md section 2.2). Eddy supplements teachers and never gives the answer to the question in front of the student (SPEC.md section 1).
- **Expectations:** a 13 to 17 year old would reasonably expect their answers to be used to teach them, but may not expect their messages to be read by a third-party AI provider abroad, or a safety excerpt to be kept. The draft notices tell them both (`apps/web/src/content/privacy.tsx`).
- **Vulnerability:** children are vulnerable by default; students near the grade 3/4 boundary may also have low confidence. Safeguarding disclosures can come from children at risk, and a parent may be the source of risk (SPEC.md section 9.2 step 4).
- **Prior concerns and current issues of public concern:** generative AI and children. The DfE generative AI product safety standards apply (`compliance/dfe-standards.md`, skeleton).
- **Codes:** ICO Children's Code (`compliance/childrens-code.md`, skeleton). Online Safety Act user-to-user and search scope avoided by having no user-to-user content and no live web search (SPEC.md section 2.3, `compliance/README.md`).
- **State of development:** closed build. No real student data has been processed; the tutor starts outside development and test only once the safeguarding script is approved (`routes/tutor.py`, `SCRIPT_APPROVED = False` in `tutor/safeguarding.py`), and Claude runs outside a local development database only once ZDR is confirmed (`config.py` `tier_l_enabled`).

### 2.4 Purposes

1. Provide adaptive maths tutoring: diagnose, teach, explain the student's own misconception, re-check and schedule review (SPEC.md sections 4.2, 4.3, 7.1).
2. Keep students safe: tripwires, classifiers, the static safeguarding script, safeguarding events for review (SPEC.md section 9.2, ADR-0031).
3. Let a student choose to share progress with a parent (SPEC.md section 4.4, ADR-0033).
4. Meet data rights and accountability duties: download, deletion, audit log, request records (SPEC.md section 4.5, ADR-0033).
5. Keep the service secure and working, and control cost: rate limits, cost guards, model call metadata (SPEC.md sections 9.2 and 13, ADR-0009).

Not purposes: advertising, selling data, training any model (SPEC.md section 12: "No student data used to train any model"), or decisions with legal or similarly significant effects (draft full notice, `apps/web/src/content/privacy.tsx`).

---

## 3. Consultation

**Done so far:** none with data subjects or outside experts. Internal fresh-context reviews (`reviewer`, `security-reviewer`, `pedagogy-critic` agents) ran at M7, M8 and M9 and their findings are recorded in PLAN.md's evidence blocks. These are engineering reviews, not consultation.

**Open** (owner: the product owner unless stated):

- Students: how to consult a representative group of 13 to 16 year olds on the notices, the parent link design and the safeguarding flow.
- Parents and carers.
- A school pilot partner (SPEC.md section 16.5): partner and timing not decided.
- A safeguarding professional: required before any real student uses the tutor (SPEC.md section 16.1, PLAN.md approval gates).
- A lawyer: lawful basis, this DPIA and the notices (SPEC.md section 16.2).
- Whether a data protection officer is required, and if so their advice (owner: a lawyer).
- Anthropic: confirmation of ZDR and no training (SPEC.md section 16.4).

---

## 4. Necessity and proportionality

### 4.1 Lawful basis (proposed, needs legal review)

- **Core tutoring and adaptive profiling:** legitimate interests (UK GDPR Article 6(1)(f)), with a balancing test (SPEC.md section 12, ADR-0002). This is a proposal. **Open: legal review of the lawful basis for 13 to 15 year olds, and whether another basis (such as contract) fits better (owner: a lawyer).**
- **Draft balancing test** (for the lawyer to test, not a conclusion):
  - *Purpose:* teaching maths to a student who signed up for it; the student's own educational interest.
  - *Necessity:* adaptive teaching cannot work without answers and a learner model; data collected is limited (section 4.2).
  - *Balance:* the data subjects are children, which weighs heavily. Safeguards in favour: no advertising or sale; Children's Code defaults for everyone; no data used for training; parental visibility only with the student's acceptance and always signalled; download and delete two clicks from Settings; the student can stop using Eddy at any time. Against: free text reaches a processor abroad (risk R2); safety records are kept for an unset period (R5).
- **Parent linking:** the student's own choice (SPEC.md section 12). **Open:** the basis for processing the parent's data (owner: a lawyer).
- **Safeguarding events:** an excerpt of a disclosure may reveal health (including mental health and self-harm), sex life, or abuse. **Open:** the Article 9 condition (and any criminal offence data condition) for keeping safeguarding excerpts; a possible route is the Data Protection Act 2018 Schedule 1 condition for safeguarding children and individuals at risk, which would also need an appropriate policy document. This is for the lawyer to confirm (owner: a lawyer and the safeguarding lead).
- **Special category data in ordinary messages:** Eddy does not ask for it, but a student can type anything. Redacting personal details before Claude was recorded as not done in M7 (PLAN.md M7 evidence). **Open** (owner: engineering, then the data protection lead).
- **Under-13s** are blocked rather than routed to parental consent (SPEC.md section 12).
- **Automated decision-making:** the learner model chooses the next question only. The draft notice says Eddy makes no decisions with legal or similarly significant effects. **Open:** legal confirmation that Article 22 is not engaged (owner: a lawyer).

### 4.2 Data minimisation

- Birth month and year only, never the day (ADR-0002, `student_profile`); nothing stored for under-13s except a 24-hour retry cookie (ADR-0032, `test_nothing_is_stored_for_someone_under_13`, `e2e/student.spec.ts` "an under-13 is stopped kindly and nothing is kept").
- No school, address or phone number (SPEC.md section 4.1, `routes/me.py`).
- No identifier of any kind is sent to Claude: the request carries prompts and message content only, and the student id is used only for the local `llm_call` record (`services/api/src/eddy_api/llm/client.py` `structured`). The draft full notice now says the same: Anthropic receives "nothing that identifies you: no name, email or account id" (`apps/web/src/content/privacy.tsx`, corrected in M10, PLAN.md M10 evidence).
- Checkpoints hold no free text (ADR-0031); Tier L scene requests hold no student text (`models/scenes.py`); scenes narrate the answer the misconception predicts, not the student's input (ADR-0030, ADR-0031).
- `llm_call` stores metadata only (ADR-0009).
- Safeguarding excerpts are capped at 280 characters, centred on the matched phrase (`tutor/safeguarding.py` `excerpt`).
- Alert emails to the safeguarding lead carry ids, severity and time only, never the student's words (`jobs.py` `alerts`, `test_alerts_email_ids_never_words`).
- Parents see topics, minutes this week, lesson dates (never times), reviews due and support contacts; never messages, answers or safety records (ADR-0033, `services/api/src/eddy_api/parents.py`).
- The audit log holds ids and action names, never emails or student words (`audit.py`).
- Visitor rate limits use a keyed hash of the IP address, never the address (`apps/web/src/lib/visitor.ts`).
- Download my data is built on request and never stored (ADR-0033, `privacy.py` `export`).

### 4.3 Transparency

- A short notice at a reading age of about 12 and a full notice, both drafts, version 0.2.0, with the acknowledged version recorded; raising the version asks everyone again (ADR-0032, ADR-0033, `apps/web/src/content/privacy.tsx`, `test_a_notice_acknowledgement_is_recorded_once_per_version`).
- Parents acknowledge the full notice on their own account page (`/v1/parent/notices`, `apps/web/src/app/(site)/parent/account/page.tsx`, ADR-0034, `test_a_parent_has_their_own_notice_download_and_deletion`, `e2e/parents.spec.ts`). There is no separate parent notice; parents read the full notice's "Parents and carers" section.
- **Open:** the controller and the privacy contact are not named in the notice ("will be named here before Eddy opens to everyone") (owner: the product owner).
- **Open:** hosting and email providers are not listed in the notice (owner: the product owner, once chosen).
- **Open:** legal review of both notices (SPEC.md section 16.2).

### 4.4 Profiling

Profiling is used only for the adaptive-learning purpose (SPEC.md section 12, Children's Code standard 12). It produces mastery estimates and misconception states, which choose questions, explanations and reviews (ADR-0026). Misconceptions found by the Haiku fallback classifier can only ever be SUSPECTED (SPEC.md section 6.1, ADR-0022). The student can see what Eddy estimates in their download ("what_eddy_thinks_you_know", "slips_noticed", `privacy.py`). There are no streaks, guilt copy or loss-aversion nudges (SPEC.md section 4.2). Profiling is on by default because the service cannot adapt without it; this is the justification Children's Code standard 12 asks for, and it needs the lawyer's view.

### 4.5 Data subject rights

Download and delete are in Settings, two clicks from any page (ADR-0032, ADR-0033); details and gaps in `compliance/runbooks/data-rights.md`. In summary: download is built on request; deletion deactivates at once, signs out everywhere and ends parent links; the erasure job, run by the worker every 15 minutes (ADR-0034), completes it and waits while a safety record is unreviewed. Parents have their own download and deletion on their account page (ADR-0034). **Open** gaps there include a check on the 30-day limit, rectification of email and birth date, cancelling a deletion, and how other rights requests reach a person.

### 4.6 Processors and international transfers

| Processor | Data sent | Location | Safeguards in place | Status |
|---|---|---|---|---|
| Anthropic (Claude API): Opus 4.8 and Haiku 4.5 (`config/models.yaml`) | Student messages (up to 1000 characters, plus the last two earlier messages for the input classifier), answers, the question and its answer, tutor drafts (`tutor/turn.py`); Tier L scene parameters with no student text; scene keyframes. No email, name, birth date or id (section 4.2) | Outside the UK | Code gate: Claude runs only with `ANTHROPIC_ZDR_CONFIRMED`, or against a local database in development or test (`config.py` `tier_l_enabled`, `test_tier_l_needs_a_key_and_zdr_or_a_local_database`). LangSmith tracing forced off (`tutor/graph.py`) | **Open:** ZDR confirmation, no-training terms, a data processing agreement and a UK transfer mechanism (IDTA, UK Addendum, or adequacy where it applies) (SPEC.md sections 10, 12, 16.4; owner: the product owner with a lawyer) |
| AWS (RDS PostgreSQL, S3, SQS, ECS) | All stored data | eu-west-2, London (`infra/lib/eddy.ts`) | Planned in CDK: encrypted RDS storage, private isolated subnets, no public access, S3 block public access and SSL only, SQS encryption | **Not deployed** (ADR-0014). **Open:** account, DPA, deployment approval (owner: the product owner) |
| Amazon SES (email) | Email addresses; sign-in links; parent link notices; safeguarding alerts (ids and severity only) | Planned eu-west-2 | None yet. Locally, Mailpit (ADR-0008, `mail.py`) | **Not set up** (PLAN.md approval gate, M10). **Open** (owner: the product owner) |
| Redis (rate limits) | Rate-limit keys | Planned AWS (CDK says Redis is "filled in by M10") | | **Open:** hosting not defined |
| ElevenLabs or Polly (paid narration) | Narration text only, never personal data | Outside the UK (ElevenLabs) | Not used: narration uses the device's own voice and leaves no device (ADR-0029) | Deferred; choosing one reopens this row (ADR-0011) |

No other processors are used: no analytics, error-tracking or tracing service is configured (SPEC.md section 13; ADR-0009 keeps traces in Postgres). **Open:** confirm before launch that no other supplier receives personal data, for example through logging or monitoring in the deployed stack (owner: engineering).

### 4.7 Function creep and accuracy

- Model IDs live only in `config/models.yaml` and every route change needs its eval (ADR-0005), so a new model use cannot be added silently.
- Accuracy: no maths reaches a student without maths-core verification (CLAUDE.md, SPEC.md section 7.3). Students can update their set-up and preferences (`PUT /v1/me/profile`, `PUT /v1/me/preferences`, `routes/me.py`); there is no route to correct an email address or birth month and year (**Open**, see the runbook).

---

## 5. Risks

Draft ratings for review. Likelihood: remote, possible, probable. Severity: minimal, significant, severe. Overall: low, medium, high. Ratings are the drafter's judgement, made before mitigation and stated after mitigation in section 6.

| # | Risk to individuals | Likelihood | Severity | Overall (before measures) |
|---|---|---|---|---|
| R1 | A child under 13 gives a false birth month and year and uses Eddy | Probable | Significant | High |
| R2 | A student types personal or special category data (name, school, address, a disclosure) in a message, which reaches Anthropic outside the UK | Probable | Significant | High |
| R3 | Anthropic keeps or trains on student messages (ZDR and no-training terms not yet confirmed) | Possible | Severe | High |
| R4 | A safeguarding disclosure is missed, or caught but not acted on, so a child at risk gets no help | Possible | Severe | High |
| R5 | Safeguarding excerpts (likely special category data) are kept longer than needed, or read by people who should not | Possible | Severe | High |
| R6 | Someone who is not the student's parent uses a link code, or a parent pressures a child to accept, and sees the child's progress | Possible | Significant | Medium |
| R7 | Someone takes over an account (access to the student's email, a stolen session) and reads their data | Possible | Significant | Medium |
| R8 | A breach of the database exposes children's data | Possible | Severe | High |
| R9 | Records of who did what are changed or deleted, hiding misuse | Remote | Significant | Low |
| R10 | Erasure is not completed within 30 days | Probable | Significant | High |
| R11 | Data is kept longer than needed (open retention periods, backups, logs) | Probable | Significant | High |
| R12 | Profiling produces wrong or discouraging inferences, or is used against the student's interests | Possible | Significant | Medium |
| R13 | The tutor shows harmful content, gives away answers, or is steered by prompt injection | Possible | Significant | Medium |
| R14 | The sign-in and sign-up pages reveal whether an email address has an account | Possible | Minimal | Low |
| R15 | Students and parents are not told accurately what happens to their data | Possible | Significant | Medium |
| R16 | Personal data leaks into application or access logs | Probable | Significant | Medium |
| R17 | A parent, or a student, cannot exercise rights other than download and delete | Probable | Significant | Medium |

---

## 6. Measures to reduce risk

Only measures that exist in the code at commit `1f5a9c4`, or are recorded decisions, are listed as in place. Residual ratings are drafts.

| # | Measures in place (with evidence) | Measures still needed (**Open**) | Effect | Residual risk |
|---|---|---|---|---|
| R1 | Neutral age screen that does not reveal the cut-off; under-13s get a kind stop page, a 24-hour retry cookie and nothing stored; the API refuses them too; the birth month counts as not yet reached (ADR-0032, `test_nothing_is_stored_for_someone_under_13`, `test_age_counts_the_birth_month_as_not_yet_reached`, `e2e/student.spec.ts`). Invite-only access (SPEC.md section 2.2). | Self-declaration is the only age assurance. Decide whether it is proportionate for the risk (owner: the data protection lead with a lawyer). A process for an account found to belong to an under-13 (owner: the data protection lead). | Reduced | Medium |
| R2 | No identifiers in any prompt (`llm/client.py`); student text passed as delimited data (SPEC.md section 9.2); 1000-character cap (`tutor/turn.py`); flagged or unscreened messages never resent in history (ADR-0031); message text deleted after 90 days locally; code gate on ZDR (`config.py`). Notices tell students that messages go to Claude (`apps/web/src/content/privacy.tsx`). | Redacting personal details before Claude (recorded as not done, PLAN.md M7 evidence; owner: engineering). ZDR, DPA and transfer mechanism (R3). | Reduced | Medium |
| R3 | `tier_l_enabled` refuses Claude outside a local development or test database unless `ANTHROPIC_ZDR_CONFIRMED` is set (`config.py`, `test_tier_l_needs_a_key_and_zdr_or_a_local_database`); `EDDY_ENVIRONMENT` defaults to production (ADR-0031). | Written ZDR confirmation and no-training terms from Anthropic, a DPA and a transfer mechanism, before the flag is set (owner: the product owner with a lawyer). Who may set the flag in production (see `compliance/governance.md`). | Reduced once confirmed | Low if confirmed; High if not |
| R4 | Deterministic tripwires that see through spacing, invisible characters and look-alike letters, then a Haiku input classifier that also runs after a tripwire hit; a refusal to classify counts as a concern; a static, human-written script with Childline, Shout and 999; the event committed on its own connection; the tutor model can also flag a concern; fails closed (ADR-0031, `tutor/safeguarding.py`, `test_tripwires_catch_disclosures`, `test_tripwires_leave_ordinary_frustration_alone`). The pedagogy eval: 14 of 14 distress scenarios produced the script and an event, each screened 3 times (PLAN.md M7 evidence). `jobs alerts` emails the lead about each new event and SAFETY concern (`jobs.py`), and the worker runs it every 15 minutes, before purges and erasures, even with Claude off (`worker.py` `privacy_tick`, ADR-0034, `test_a_failing_job_does_not_stop_the_others`). A draft safeguarding runbook exists (`compliance/runbooks/safeguarding.md`). The tutor does not start outside development and test until `SCRIPT_APPROVED` (`routes/tutor.py`, `test_the_tutor_waits_for_the_safeguarding_lead_outside_development`). Parents are not told automatically (SPEC.md section 9.2). | A named safeguarding lead; their approval of the script and the tripwire list (`config/safeguarding/tripwires.yaml`); response times and when to contact emergency services (SPEC.md section 16.1); the lead's approval of the draft safeguarding runbook; `SAFEGUARDING_ALERT_EMAIL` set (empty means no alert, `config.py`); the worker deployed and running where real data is held (nothing is deployed, ADR-0014); the admin safeguarding queue (deferred, ADR-0032). Owners: the product owner, the safeguarding lead, engineering. | Reduced only once the lead, alerts and queue exist | High until then |
| R5 | Excerpt capped at 280 characters (`tutor/safeguarding.py`); alert emails carry no words (`jobs.py`); events cannot be deleted by deleting an account (RESTRICT, migration 0002, `test_deleting_an_account_keeps_safeguarding_and_erasure_records`); safety records left out of downloads, for the lead to decide (ADR-0033); parents never see them (`parents.py`). | Retention period (SPEC.md section 16.6); Article 9 condition and appropriate policy document (section 4.1); access control for who may read events (admin sign-in and queue not built, ADR-0032); a way to record review (no code sets `reviewed_at`). Owners: the safeguarding lead, the data protection lead, a lawyer, engineering. | Partly reduced | High until retention and access are set |
| R6 | Code is 10 characters from an unambiguous alphabet, stored only as a SHA-256 hash, 7 days, single use, replaced by a new one; nothing shared until the student accepts after seeing the parent's email; a permanent "Your parent can see your progress" indicator with a preview; either side can end a link and the other is told; links end at once when the student asks to delete; parent views audited; parents see dates, never times (ADR-0033, `e2e/parents.spec.ts`, `test_a_parent_signs_up_with_a_code_and_sees_nothing_until_accepted`, `test_either_side_can_end_a_link_and_the_other_is_told`). | Parent age and relationship are self-declared. Keyed hashing of link codes (recorded, not fixed, PLAN.md M9 evidence). Coercion by a parent cannot be prevented by design; the safeguarding route is the mitigation (owner: the safeguarding lead). | Reduced | Medium |
| R7 | Email magic links (30 minutes, once); sign-in links limited to 3 a minute and 10 a day per address; sessions hashed (SHA-256) and 7 days; cookie httpOnly, Secure, SameSite=Lax; deactivation signs out everywhere at once (ADR-0032, `test_sessions_are_looked_up_by_hash_and_end_with_the_account`, `test_sign_in_links_are_limited_per_address`). | Account security depends on the student's email account. A strict nonce CSP (deferred in ADR-0032, still open in `docs/security-review.md` and `docs/launch-checklist.md`) and the other gaps in the ASVS Level 2 review (`docs/security-review.md`). Owner: engineering. | Reduced | Medium |
| R8 | Only the web app is public (SPEC.md section 5.3); the API and worker connect as `eddy_app`, which owns nothing and cannot alter the schema (migration 0006, ADR-0032); every API test runs as that role; secrets kept out of logs (`SecretStr`, `config.py`); planned encrypted RDS in isolated subnets (`infra/lib/eddy.ts`); baseline CSP and security headers (`apps/web/next.config.ts`); dependency audits in CI, `pnpm audit --audit-level high` and `pip-audit` (`.github/workflows/ci.yml`, ADR-0034), which on 13 November 2026 found no high npm advisories and no Python advisories when run locally (PLAN.md M10 evidence); a security review against ASVS Level 2 (`docs/security-review.md`). | Deployment, network and secrets management (Secrets Manager, SPEC.md section 13) not built (ADR-0014); approval of the draft breach runbook (`compliance/runbooks/data-breach.md`); a strict nonce CSP and the gaps in `docs/security-review.md`; CI not yet run on this branch (PLAN.md M10 evidence). Owners: engineering and the security lead. | Reduced in design | High until deployment hardening is evidenced |
| R9 | `audit_log` append-only by trigger (migration 0001) and by grants: the runtime role may only read and add (migration 0006, `test_audit_log_is_append_only`, `test_the_runtime_role_only_reads_and_adds_to_the_audit_log`). | Retention period (ADR-0024). Protection of the owner credentials in production. | Reduced | Low |
| R10 | Deletion deactivates at once (`routes/me.py`, `test_deleting_the_account_deactivates_it_and_signs_it_out_at_once`); `jobs erase` completes it (`jobs.py`, `privacy.py`, `test_erasure_deletes_an_account_without_safety_records`, `test_erasure_waits_for_review_then_keeps_an_anonymous_anchor`). The worker runs the erasure job every 15 minutes and once at start; one job failing does not stop the others (`worker.py` `privacy_tick`, ADR-0034, `test_a_failing_job_does_not_stop_the_others`). | A deadline check, since no code tracks the 30 days; a way to record review so held requests can finish; the worker deployed and monitored where real data is held (ADR-0014). Owners: engineering and the data protection lead. | Partly reduced | Medium until tracked and deployed |
| R11 | Message text 90 days, expired links, sessions and pending sign-ups purged (`jobs.purge`). | The open retention periods in section 2.2, the `llm_call` 12-month job, backups and logs. Owner: the data protection lead. | Partly reduced | Medium |
| R12 | Misconceptions from the classifier are SUSPECTED only (ADR-0022, ADR-0026); no grade predictions as fact (SPEC.md section 2.3); no streaks or guilt copy (SPEC.md section 4.2); students can see the estimates in their download (`privacy.py`); learner model checked on synthetic students (ADR-0026). | Children's Code standard 12 review by the lawyer. | Reduced | Low |
| R13 | Output checks: maths-core verification, answer-leak check, word limit, tone and safety classifier, no links or contact details, regeneration then templated fallback; fails closed (ADR-0031). Eval: zero answer leaks in 72 conversations, injections 7 of 7 held (PLAN.md M7 evidence). | The prompt-injection red-team pass (PLAN.md M10). | Reduced | Low |
| R14 | Sign-in and sign-up pages say the same thing whether or not an address has an account; the raw Auth.js endpoint redirects either way (ADR-0032, PLAN.md M8 evidence). | Response timing differs when a link is sent (recorded, to queue the email in M10). | Reduced | Low |
| R15 | Two notices, versioned, acknowledged; they say "only what Eddy does today" (ADR-0032). | Controller, contact and processors not named; legal review. Owner: the product owner. | Partly reduced | Medium |
| R16 | Audit log and alert emails hold no words or emails; secrets as `SecretStr`. | Strip the email address from sign-in link URLs in access logs (recorded for M10, PLAN.md M8 evidence); a log retention period. Owner: engineering. | Not yet reduced | Medium |
| R17 | Students: download and delete in Settings; set-up and preferences editable (`routes/me.py`). Parents: notice acknowledgement, download and deletion on their account page (`/v1/parent/me`, `/v1/parent/notices`, `/v1/parent/export`, `/v1/parent/delete` in `routes/parents.py`; `apps/web/src/app/(site)/parent/account/`; ADR-0034; `test_a_parent_has_their_own_notice_download_and_deletion`). | No route to correct an email or birth date. No way to cancel a deletion request. A parent's download is not rate limited and is recorded in the audit log only, not as a `data_request` (`routes/parents.py` `parent_export`). PRIVACY concerns alert nobody (`jobs.alerts` covers SAFETY only). See `compliance/runbooks/data-rights.md`. Owner: the data protection lead and engineering. | Partly reduced | Medium |

---

## 7. Sign-off and outcomes

Left blank on purpose. Nobody has approved this DPIA.

| Item | Name and date | Notes |
|---|---|---|
| Measures approved by | | Integrate actions back into PLAN.md with dates and owners |
| Residual risks approved by | | If any high residual risk remains, consider consulting the ICO before processing (owner: a lawyer) |
| DPO advice provided | | **Open:** whether a DPO is required |
| Summary of DPO advice | | |
| DPO advice accepted or overruled by | | |
| Consultation responses reviewed by | | None yet (section 3) |
| Legal review | | SPEC.md section 16.2 |
| Safeguarding lead review of sections 4.1, R4 and R5 | | SPEC.md section 16.1 |
| This DPIA will be kept under review by | | **Open:** owner and review date |

### Summary of open items blocking real student data

1. ZDR, no-training terms, a DPA and a transfer mechanism with Anthropic.
2. A named safeguarding lead; approval of the script, the tripwires and the draft safeguarding runbook; the alert address configured.
3. Retention periods for `safeguarding_event`, SAFETY concerns, `audit_log`, `data_request`, ended links, inactive accounts, backups and logs; the `llm_call` 12-month job.
4. Legal review of the lawful basis (including the Article 9 condition for safeguarding excerpts), this DPIA and the notices; the controller and contact named.
5. Hosting and email processors chosen, contracted and deployed (none deployed, ADR-0014).
6. A deadline check for erasure, a way to record safety review, and the worker (which runs the scheduled jobs) deployed where real data is held.
