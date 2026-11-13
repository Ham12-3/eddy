# Runbook: security incident response

Status: **DRAFT, 12 November 2026, for review by the product owner.** Written by the build team from the repository on branch `m10-hardening`. Eddy is not deployed (ADR-0014): every command here is checked against the code for the **local** stack. The production equivalents (AWS Secrets Manager, logs, alarms) do not exist yet and must be added when the staging deployment is approved. This runbook has not been exercised.

If the incident involves personal data, start [data-breach.md](data-breach.md) at the same time: the 72-hour clock for telling the ICO may already be running. If it involves a child at risk, follow [safeguarding.md](safeguarding.md) first.

## Roles

| Role | Who | Responsibility |
|---|---|---|
| Incident lead | To be named (the security lead in [../governance.md](../governance.md)) | Declares the incident, decides containment, owns the timeline |
| Engineering on call | To be named | Runs the containment steps below |
| Data protection lead | To be named | Decides whether it is a personal data breach and whether to report it |
| Accountable owner | The product owner | Approves anything destructive, irreversible or costly, and external communication |

Contact details and an out-of-hours route: to be named.

## 1. Detection

What exists today:

- **Audit log** (`audit_log`): append-only, written for sign-ups, sessions created, notice acknowledgements, set-up, parent link codes, requests, accepts and ends, parent dashboard views, data exports, deletion requests and concern reports. The runtime role `eddy_app` can only read and add rows; a trigger blocks changes (migration 0006; `services/api/tests/test_migrations.py`).
- **Claude usage** (`llm_call`): one row per call with route, model, tokens, latency, cost estimate, safety flags and the student id. A sudden rise in calls or cost for one student or overall is a sign of abuse. Daily cost guards stop the tutor's Claude calls past `TUTOR_GBP_PER_STUDENT_PER_DAY` (0.5) or `TUTOR_DAILY_BUDGET_GBP` (20), and Tier L past its own limits (`services/api/src/eddy_api/config.py`).
- **Rate limits**: tutor messages (12 a minute, 400 a day per student, in Redis), sign-in links (3 a minute, 10 a day per address), invite checks and sign-ups per visitor. Repeated 429 responses in the API logs show someone hitting them.
- **Concern reports** (`concern_report`, category PRIVACY or OTHER) from students.
- **Process logs** of web, API and worker (stdout locally).
- **Dependency advisories**: not checked in committed CI yet (an audit step is uncommitted M10 work).

What does not exist yet: central logging, alerting on errors or unusual traffic, an automated security scan, uptime monitoring. Until they do, detection depends on someone looking.

## 2. Triage

1. Write down when and how it was noticed, and by whom. Start a timeline (UTC) in the incident record (location to be decided) and keep it for the whole incident.
2. Classify:

   | Severity | Examples |
   |---|---|
   | Critical | A secret leaked (service-token private key, `AUTH_SECRET`, database password, `ANTHROPIC_API_KEY`); someone reading other students' data; the audit log or safeguarding pipeline bypassed |
   | High | Account takeover of one user; prompt injection that changes tutor behaviour; runaway Claude spend; alerts not reaching the safeguarding lead |
   | Medium | Abuse held by rate limits; a vulnerable dependency with no sign of use |
   | Low | A failed attack with no effect |

3. Ask: is personal data involved (read, changed, lost, or unavailable)? If yes, open [data-breach.md](data-breach.md) now.

## 3. Containment (local stack; production steps to be written at deployment)

Each step below is checked against the code. Steps that delete data or sign everyone out are destructive: get the accountable owner's go-ahead first, unless waiting would let harm continue, and record who decided.

| Threat | Action | Effect, from the code |
|---|---|---|
| Service-token signing key leaked, or anyone could mint API tokens | `pnpm keys:dev --force`, then restart web, API, maths-core, scene-check and the worker (`pnpm dev`) | Writes a fresh key pair (`SERVICE_TOKEN_PRIVATE_KEY_B64` in apps/web, `SERVICE_TOKEN_PUBLIC_KEY_B64` in services/api), a new `AUTH_SECRET` and new maths-core and scene-check tokens; keeps keys it does not manage, such as `ANTHROPIC_API_KEY` (`scripts/dev-keys.mjs`). Tokens signed with the old key stop verifying. Tokens live 60 seconds at most anyway. |
| `AUTH_SECRET` leaked | As above (`--force` replaces it) | Invalidates the signed sign-up cookies (`apps/web/src/lib/join.ts`). Sessions are database rows, so also revoke sessions (below). |
| Claude key leaked, or Claude misbehaving, or runaway spend | Remove `ANTHROPIC_API_KEY` from `services/api/.env` (or set it empty), then restart the API and the worker. Rotate the key in the Anthropic console. | With no key, Claude is off (`tier_l_enabled` in `config.py`): Tier D scenes are served, and every tutor message gets the static reply (ADR-0031). Settings are cached per process, so the restart is needed. In production, also unset `ANTHROPIC_ZDR_CONFIRMED`, which the gate needs outside local development. |
| A user's sessions compromised | `DELETE FROM sessions WHERE user_id = '<id>';` as the runtime role | That user is signed out everywhere; they sign in again by email link. |
| Every session suspect | `DELETE FROM sessions;` | Everyone is signed out. |
| An account must be stopped now | `UPDATE users SET deactivated_at = now() WHERE id = '<id>';` then delete its sessions | A deactivated account cannot sign in, and its live sessions stop at once (`/v1/auth/sessions/lookup` ignores deactivated accounts, `services/api/src/eddy_api/routes/accounts.py`). Parent routes ignore a deactivated student. Note: the student's own "delete my account" uses the same flag, so record why it was set. |
| Invite code abused | `UPDATE invite_code SET expires_at = now() WHERE code = '<code>';` (lowering `max_uses` below `used_count` breaks a check constraint) | New sign-ups with that code stop. |
| Sign-in link leaked | `DELETE FROM verification_token WHERE identifier = '<email>';` | Unused links stop working. `python -m eddy_api.jobs purge` removes expired ones. |
| Database password leaked | Change the role's password in Postgres, update `RUNTIME_DATABASE_URL` or `DATABASE_URL`, restart | Locally the passwords are the fixed development values (eddy/eddy, eddy_app/eddy_app). Production credentials are to be designed. |
| Vulnerable dependency | Upgrade or pin, run `pnpm check` and `pnpm e2e` | TypeScript and ESLint upgrades need the checks in ADR-0017. |

Preserve evidence before changing anything you can: copy the relevant `audit_log`, `llm_call`, `sessions` and log extracts with timestamps. Never edit or delete `audit_log` rows; the runtime role cannot, and the owner role must not.

## 4. Eradication and recovery

1. Find and fix the cause; add a test that would have caught it.
2. Run `pnpm check`, `pnpm e2e`, and the relevant evals (`pnpm evals:tutor` live costs money: ask first).
3. Restore the service in steps; watch `llm_call`, rate-limit responses and logs.
4. If keys were rotated, confirm services talk to each other again (the hello page's system check in development).

## 5. Communication

- Internal: the incident lead keeps the accountable owner informed at each change of severity.
- Users: if personal data is involved, [data-breach.md](data-breach.md) decides who is told and how. Messages to students are plain, calm and at a reading age of about 12; no message is sent without the accountable owner's approval.
- Suppliers: Anthropic if the Claude key or ZDR is involved; the hosting and email providers once contracted.

## 6. Post-incident review

Within 10 working days (proposed): what happened, the timeline, what worked, what did not, actions with owners and dates. Record it with the incident and, where a decision changes, in DECISIONS.md.

## Gaps

- Nothing is deployed, so there are no production procedures for secrets rotation (AWS Secrets Manager), log access, blocking traffic or restoring backups. Backups do not exist yet.
- No central logging or alerting; detection is manual.
- No kill switch for the tutor short of removing the key and restarting; lowering the cost guards to zero may also stop Claude calls but has not been tested.
- No admin accounts or admin sign-in exist; containment needs direct database access.
- Roles and contacts are to be named; the runbook has not been rehearsed.
