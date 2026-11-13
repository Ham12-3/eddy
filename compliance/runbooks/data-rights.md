# Runbook: data rights requests

**Status: DRAFT, 12 November 2026, for review by the product owner and a lawyer.** Not approved, and not yet used on a real request. Owner when approved: the data protection lead (to be named, `compliance/governance.md`).

This runbook describes how the code works at commit `3642fa8` (M9) on branch `m10-hardening`, and what a person still has to do by hand. Sources: SPEC.md section 4.5, ADR-0032, ADR-0033, `services/api/src/eddy_api/privacy.py`, `services/api/src/eddy_api/jobs.py`, `services/api/src/eddy_api/routes/me.py`, `services/api/src/eddy_api/routes/parents.py`, `apps/web/src/app/(site)/settings/`. Where uncommitted work on the same branch changes a gap, it is labelled as uncommitted; update this runbook when it is committed and reviewed.

---

## 1. Time limits

- Deletion: SPEC.md section 4.5 sets "deactivates immediately and completes within 30 days".
- Other rights requests: UK GDPR sets one month, extendable in some cases. **Open:** confirm the limits and how an extension is decided (owner: a lawyer).
- The clock starts when the request is received by any route, not only in the app.

## 2. How requests arrive

| Route | Who | What happens |
|---|---|---|
| Settings, "Download" (`/settings/my-data`) | Signed-in student | Self-service (section 4) |
| Settings, "Delete my account" (type DELETE to confirm) | Signed-in student | Self-service (section 5) |
| Report a concern, category PRIVACY (`POST /v1/me/concerns`) | Signed-in student | Stored in `concern_report` only. **Gap:** `jobs alerts` emails the safeguarding lead about SAFETY concerns only, so a PRIVACY concern alerts nobody and there is no queue to read it. Someone must query the table (section 8) |
| Email, letter, a school, or anyone else | Anyone | Manual (section 3). **Open:** no privacy contact address is published; the full notice says it "will be named here before Eddy opens to everyone" (`apps/web/src/content/privacy.tsx`) |
| A parent account | Parent | **Gap at commit `3642fa8`:** parents have no download or delete route ("Parents' own data rights (download and delete) and a parent privacy acknowledgement (M10)", ADR-0033). Uncommitted work adds `/v1/parent/export`, `/v1/parent/delete` and a parent account page, citing an ADR-0034 that is not yet in DECISIONS.md. Until that is committed and reviewed, handle parent requests manually (section 6) |

Owner of every gap in this table: the data protection lead, with engineering.

## 3. Verifying identity

- **In-app requests** are made from a signed-in session. Sign-in is by an email link that works once and expires after 30 minutes (ADR-0032), so the requester has shown control of the account's email address. No further check is needed for self-service download or deletion.
- **Requests from outside the app:**
  1. Ask the person to sign in and use Settings, if they can. This is the strongest check and keeps the request self-service.
  2. If they cannot, confirm by replying only to the email address on the account (`users.email`), never to a different address given in the request, and wait for the reply.
  3. Ask for no more information than that. Do not ask a child for identity documents. Eddy holds only an email address and birth month and year, so it cannot verify anything else.
  4. Never confirm or deny to an unverified requester that an address has an account; the app itself never reveals this (ADR-0032).
- **A parent asking for their child's data:** a student aged 13 or over exercises their own rights in Eddy, and a parent link gives only the dashboard view (ADR-0033). Do not release a child's data to a parent. **Open:** the rule for when a parent may act for a child (owner: a lawyer and the data protection lead).
- **A request about a safety record,** or one that suggests the child is at risk: pass it to the safeguarding lead before acting (ADR-0033).

**Open:** no tool records that identity was verified for a manual request (owner: the data protection lead; see section 8).

## 4. Access: download my data

How it works (ADR-0033, `privacy.export`, `routes/me.py` `export_my_data`):

- The student opens Settings, then My data. The page shows everything as a readable page; viewing it records nothing.
- "Download" fetches `GET /v1/me/export?download=true` and returns `eddy-my-data.json` with `Cache-Control: no-store` (`apps/web/src/app/(site)/settings/my-data/download/route.ts`). The file is built on request and never stored.
- Each download adds a `data_request` row (kind EXPORT, status COMPLETED) and an audit row `data.export`. At most 5 downloads an hour; past that the student is told to try later (`EXPORT_DOWNLOADS_PER_HOUR`).
- Contents: account (email, role, join date), profile (birth month and year, board, tier, exam series, target grade, resitting, preferences), notices acknowledged, answers with the question, correctness, confidence, hints and time, mastery estimates, misconceptions noticed, reviews due, lessons with message text (or "(deleted after 90 days)"), concerns reported, parent links, data requests, invite code, explanations watched, the diagnostic, and current sign-in sessions.
- **Left out:** safety records (safeguarding events). The download gives their count and says to ask through Report a concern. Whether and how to release them is the safeguarding lead's decision (ADR-0033). **Open:** that decision process (owner: the safeguarding lead with the data protection lead).
- Tested: `test_download_my_data_holds_everything_and_records_the_request` (`services/api/tests/test_parents.py`), `e2e/parents.spec.ts` "a student downloads their data, then deletes their account".

Manual access request (outside the app): ask the student to use Settings (section 3). **Gap:** there is no operator command that produces an export for someone who cannot sign in; `privacy.export(session, user_id)` is a library function only (owner: engineering).

## 5. Erasure: delete my account

### 5.1 What happens at once

The student types DELETE in Settings, which calls `POST /v1/me/data-requests` with `kind: DELETE, confirm: true` (`apps/web/src/app/(site)/settings/actions.ts`). In one transaction (`routes/me.py` `create_data_request`):

1. `users.deactivated_at` is set. A deactivated student is refused by every student route (`services/api/src/eddy_api/students.py`).
2. Every session row is deleted, so the account is signed out everywhere.
3. Every REQUESTED or ACTIVE parent link is ENDED (`parents.end_links`); each parent whose link was active is emailed "a parent link has ended", with no other details. Parent routes also ignore a deactivated student (ADR-0033).
4. A `data_request` row (kind DELETE, status RECEIVED) is made, or the open one reused, and an audit row `account.delete_request` is written.

Tested: `test_deleting_the_account_deactivates_it_and_signs_it_out_at_once` (`test_accounts.py`), `test_asking_to_delete_ends_parent_links_at_once` (`test_parents.py`).

**Gap:** there is no way for a student to cancel a deletion request once made. **Open:** whether to offer one, and how to handle a request to cancel by hand (owner: the data protection lead).

### 5.2 Completing it: the erasure job

Run from the repository root (as the runtime role, which the job uses by default):

```
uv run --package eddy-api python -m eddy_api.jobs alerts
uv run --package eddy-api python -m eddy_api.jobs erase
```

or `python -m eddy_api.jobs all`, which runs purge, then alerts, then erase. Run alerts before erase, so the safeguarding lead hears of a concern before anything is erased (ADR-0033, `jobs.main`). Each run prints "erasures completed: N". The job is safe to repeat and two runs do not process the same request (`with_for_update(skip_locked=True)`).

For each DELETE request in RECEIVED or IN_PROGRESS (`jobs.erasures`, `privacy.erase`):

1. **If the person has an unreviewed safeguarding event, or an unreviewed SAFETY concern,** nothing is erased. The request is set to IN_PROGRESS and waits. Deleting the lesson or the way to reach the student "could cost a child their help" (`privacy.erase`).
2. Otherwise:
   - the lesson checkpoints are deleted by thread id (they have no foreign key);
   - concern reports other than SAFETY are deleted;
   - sign-in links for the email address are deleted;
   - `llm_call` rows lose the student id.
3. **No safety record at all:** the `users` row is deleted and everything else goes with it through the foreign keys; the `data_request` keeps no user id. Result "deleted".
4. **A reviewed safety record exists** (a safeguarding event, or a SAFETY concern): all learning, lesson, scene, profile, notice, invite, link code, session and auth rows are deleted, parent links are deleted, data requests lose the user id, and the `users` row stays only as an anonymous anchor (email replaced with `erased-<id>@erased.invalid`, name and email verification removed). The safety records stay until their retention is set (ADR-0024). Result "anonymised".
5. The request is set to COMPLETED with `completed_at`. A request that fails for another reason is logged and left for the next run.

Tested: `test_erasure_deletes_an_account_without_safety_records`, `test_erasure_waits_for_review_then_keeps_an_anonymous_anchor` (`test_parents.py`), `test_deleting_an_account_keeps_safeguarding_and_erasure_records` (`test_migrations.py`).

### 5.3 What stays after erasure

- `audit_log` rows, which hold the person's UUID and action names but no email or words. Retention **Open** (ADR-0024).
- `data_request` rows, without the user id (accountability).
- `llm_call` rows, without the student id.
- Safety records and the anonymous anchor, where a safety record exists. Retention **Open** (SPEC.md section 16.6).
- Once deployed: database backups (7 days in the CDK definition) and S3 non-current versions (30 days) (`infra/lib/eddy.ts`). **Open:** how erasure is applied to backups (owner: the data protection lead with a lawyer).

### 5.4 What is still manual, and the gaps

- **Scheduling.** In committed code the jobs run only when someone runs the command (ADR-0033: "Scheduling the jobs is M10 infrastructure. Until then they run by command"). Until scheduling is committed, the engineering lead must run `alerts` then `erase` at least weekly. **Open:** the agreed frequency (owner: the data protection lead). Uncommitted work in `services/api/src/eddy_api/worker.py` runs alerts, purge and erasures every 15 minutes in the worker; not yet reviewed or committed.
- **The 30-day limit is not tracked by code.** Nothing warns when a request nears 30 days. Check by hand (section 8). **Open:** an automated check (owner: engineering).
- **Held requests cannot finish without a review record.** No code sets `safeguarding_event.reviewed_at` or `concern_report.reviewed_at`, and the admin safeguarding queue is deferred (ADR-0032). A request held for review therefore stays IN_PROGRESS until someone records the review directly in the database. **Open:** a review tool, and who may record a review (owner: the safeguarding lead and engineering). If a hold will pass 30 days, the data protection lead decides what to tell the student. **Open:** that wording, with a lawyer.

## 6. Parents

At commit `3642fa8` a parent account cannot download or delete its own data (ADR-0033). Until the parent routes are committed and reviewed:

- **Ending the link** is self-service: a parent can end any link from their pages, and the student is told (`routes/parents.py`, ADR-0033).
- **Deletion by hand:** an engineer would set `deactivated_at`, delete the parent's sessions, end their links, and add a `data_request` row (kind DELETE, status RECEIVED) for the parent, so that `jobs erase` completes it. `privacy.erase` handles any user id. **Open:** this procedure is not written as a tested command and needs review before use (owner: engineering).
- **Access by hand:** what Eddy holds about a parent is their `users` row, any `pending_signup`, `parent_link` rows, sessions and audit rows. **Gap:** no export exists for parents in committed code.

## 7. Other rights

| Right | What exists | Gap |
|---|---|---|
| Rectification | Students can change set-up and preferences (`PUT /v1/me/profile`, `PUT /v1/me/preferences`) | No route to change the email address or birth month and year. **Open:** manual procedure (owner: engineering and the data protection lead) |
| Restriction | None | **Open:** procedure (owner: the data protection lead) |
| Objection (to legitimate interests processing, including profiling) | Deleting the account stops all processing | **Open:** whether objection to profiling alone can be honoured while the service still works (owner: a lawyer) |
| Portability | The JSON download | **Open:** whether portability applies under the final lawful basis (owner: a lawyer) |
| Complaint to the ICO | Both notices give ico.org.uk and 0303 123 1113 (`apps/web/src/content/privacy.tsx`) | |

## 8. Checks and records

Read-only checks an engineer can run against the database (table and column names from `services/api/src/eddy_api/db/models/governance.py`):

```sql
-- Deletion requests still open, oldest first (look for any near 30 days)
SELECT id, status, requested_at FROM data_request
WHERE kind = 'DELETE' AND status IN ('RECEIVED', 'IN_PROGRESS')
ORDER BY requested_at;

-- PRIVACY concerns, which alert nobody
SELECT id, created_at, reviewed_at FROM concern_report
WHERE category = 'PRIVACY' ORDER BY created_at;
```

- In-app requests are recorded by the code (`data_request` and `audit_log`).
- **Open:** a register for manual requests: date received, route, how identity was verified, decision, date completed, and who handled it (owner: the data protection lead). It must not hold more personal data than the request needs.

## 9. Before this runbook is used on a real request

1. Name the data protection lead and the safeguarding lead.
2. Publish a privacy contact.
3. Close or accept the gaps above: parent rights, PRIVACY concern routing, the 30-day check, a way to record review, scheduling.
4. Legal review of sections 1, 3, 6 and 7.
