# Runbook: safeguarding escalation

Status: **DRAFT, 12 November 2026, for review by the product owner.** First drafted in M7 (9 November 2026) and updated for what M8 and M9 added. Written by the build team, not by a safeguarding professional. It must be reviewed and approved by Eddy's named safeguarding lead, with professional advice, before any real student uses the tutor. Until then the tutor starts only in development and test (`SCRIPT_APPROVED = False` in `services/api/src/eddy_api/tutor/safeguarding.py`, checked in `services/api/src/eddy_api/routes/tutor.py`).

## Roles

| Role | Who | Responsibility |
|---|---|---|
| Safeguarding lead | To be named | Owns this runbook, the script and the phrase list; receives alerts; reviews every event and SAFETY concern; decides on referrals and on what is shared |
| Deputy | To be named | Covers when the lead is unavailable, including out of hours |
| Engineering on call | To be named | Keeps detection and alerting working; runs database queries for the reviewer until an admin queue exists; never decides on referrals |
| Data protection lead | To be named | Advises on what personal data may lawfully be shared with emergency services or children's social care |

Contact details for each role: to be named. The alert address (`SAFEGUARDING_ALERT_EMAIL` in `services/api/.env` locally, a secret in production) must be a mailbox the lead and deputy both read, and must be checked by sending a test alert before activation.

## What Eddy does automatically today

When a student's message suggests they, or someone they mention, may be at risk:

1. **Detection.**
   - A deterministic phrase list runs first (`config/safeguarding/tripwires.yaml`, version draft-2). Categories and severities: suicidal thoughts, self-harm and danger (IMMEDIATE); abuse, neglect and exploitation (HIGH); distress and bullying (MEDIUM). Matching sees through spacing, invisible characters, look-alike letters and common misspellings. Text hidden in an answer field is checked too.
   - The Haiku 4.5 input classifier then reads the message with the student's two earlier messages, also after a tripwire hit, so the more severe reading is kept. If it refuses to classify a message, that counts as a concern. If it cannot run, the tripwires still do and the student gets a static reply with the Childline number.
   - The tutor model can also flag a concern.
2. **Response to the student.** Tutoring stops for that lesson and the student sees this fixed script (version draft-1), never model-written text:

   > I am going to stop the maths here, because what you have said matters more. I am an AI, so I cannot help with this myself, but people can, right now.
   >
   > Childline: call 0800 1111 for free, any time, or talk to them online at childline.org.uk.
   > Shout: text SHOUT to 85258 for free, any time.
   > If you are in danger or hurt, call 999.
   >
   > You could also talk to a teacher, your school nurse or another adult you trust. You did the right thing by saying something.

   The footer of every page also shows Childline, Shout and 999 (`apps/web/src/components/SiteFooter.tsx`).
3. **Record.** A `safeguarding_event` row is committed on its own database connection, so it survives a failure in the rest of the turn. It holds the student's id, the lesson id, the category, the severity, an excerpt of at most 280 characters centred on what matched, how it was detected and what was done. `notified_party` is empty until an alert is sent.
4. **Later messages.** Anything the student sends to that lesson afterwards records a further event and shows the script again.
5. **Parents** are not told automatically, because a parent may be the source of risk. The parent dashboard never shows safety records (ADR-0033).

### Concern reports (M8)

"Report a concern" is in the footer of every page and in the tutor panel (`apps/web/src/app/(site)/concern/`, `services/api/src/eddy_api/routes/me.py`). A student chooses SAFETY, CONTENT, PRIVACY or OTHER and writes up to 2,000 characters. Each report is a `concern_report` row and an `audit_log` entry (`concern.report`). A SAFETY report is treated like a safeguarding event: it is alerted and it holds up erasure until reviewed. A student is limited to a number of reports a day; past it they see "If you are in danger, call 999."

### Alerts (M8)

`uv run --package eddy-api python -m eddy_api.jobs alerts` (or `jobs all`) emails `SAFEGUARDING_ALERT_EMAIL` once for each safeguarding event and each SAFETY concern whose `notified_party` is empty, then sets `notified_party` to `email:<address>`. The email carries **ids, severity and time only**, never the student's words or the category (`services/api/src/eddy_api/jobs.py`; `services/api/tests/test_jobs.py`, `test_alerts_email_ids_never_words`). If the address is not set, no alert is sent, a warning is logged, and events wait unnotified.

Today the job runs only when someone runs it. Scheduling it (every 15 minutes in the worker) is M10 work, not yet committed. **Until it is scheduled, alerts are not timely, and real students must not use the tutor.**

### Data rights and safety records (M9)

- **Erasure waits for review.** `python -m eddy_api.jobs erase` will not erase a student while any of their safeguarding events or SAFETY concerns has no `reviewed_at`; the deletion request stays IN_PROGRESS (`services/api/src/eddy_api/privacy.py`, `awaiting_review`). The account was deactivated and signed out when deletion was asked for, so the student cannot sign in meanwhile.
- **Deletion must still finish within 30 days** (SPEC.md 4.5). The lead must review in time for that.
- After review, a student with a safety record keeps only an anonymous anchor row (email replaced, name removed) so the record can stay until the DPIA sets its retention. Concern reports lose their link to the person.
- `jobs all` runs alerts before erasure, so the lead hears of a concern before anything is erased.
- **Download my data leaves safety records out**, with a note on how to ask for them. A request for them comes to the lead to decide (see [data-rights.md](data-rights.md)).

## Reviewing an event (proposed; for the lead to set)

| Severity | Proposed review time | Examples |
|---|---|---|
| IMMEDIATE | As soon as alerted, at any hour | Suicidal thoughts, self-harm happening or planned, being in danger now |
| HIGH | Within one working day | Abuse, neglect, exploitation |
| MEDIUM | Within three working days | Distress, bullying |
| SAFETY concern report | Within one working day, sooner if the text shows immediate risk | Anything a student reports as a safety worry |

There is no admin safeguarding queue yet (deferred in ADR-0032), so today review happens in the database:

1. Engineering on call looks up the event or concern by the id in the alert, using the runtime role, and shows the reviewer the excerpt (or the concern message) and the category.
2. Only if needed to judge risk, the reviewer reads the surrounding messages in that lesson (`tutor_message` for the `tutor_session_id`; message text is deleted after 90 days).
3. The reviewer decides: false alarm, concern to monitor, or concern needing action.
4. The decision is recorded: `reviewed_at` set, `reviewed_by` set to the reviewer's user id, and the outcome written in the case record (location to be decided). `reviewed_by` needs the reviewer to have an Eddy user account; no admin account flow exists yet.

## When to involve others (for the lead and professional advice to confirm)

- **Immediate risk to life:** contact emergency services (999). Eddy holds only an email address and birth month and year: no name, address, school or phone number (SPEC.md 4.1). The lead and the data protection lead must decide in advance what Eddy can lawfully share and how quickly engineering can retrieve it.
- **Abuse, neglect or exploitation:** refer to the local authority children's social care for the child's area, or the police. Online sexual exploitation can also be reported to CEOP (ceop.police.uk). Eddy does not know the child's area.
- **Below threshold:** no external action; note the decision and keep monitoring.

## Record keeping

- Safeguarding events are never deleted when an account is deleted (the foreign key is RESTRICT); concern reports are kept without the link to the person. How long both are kept is an open DPIA question (ADR-0024; SPEC.md 6.7 proposes 12 months for events).
- Every review decision and every external contact is recorded with who, when and why.
- Alerts are recorded in `notified_party`. Concern reports are in `audit_log`.

## Open questions for the safeguarding lead

1. Approve, or rewrite, the script. The pedagogy review suggested this wording for consideration:

   > Thank you for telling me. You did the right thing. I am going to stop the maths now, because this matters more.
   >
   > I am an AI, so I am not the right one to help with this. These people are, and you can contact them now, for free:
   >
   > Childline: call 0800 1111, or chat online at childline.org.uk. It will not show on your phone bill.
   > Shout: text SHOUT to 85258.
   > If you are in danger right now, or badly hurt, call 999.
   >
   > You could also talk to a teacher, your school nurse or another adult you trust. You can come back to the maths whenever you are ready.

   Confirm current opening hours and the phone bill claim before approving any wording.
2. Whether the script should say that a person at Eddy may read what the student wrote (the privacy notice already says so).
3. Whether each category or severity needs its own response (for example CEOP for exploitation, softer signposting for MEDIUM distress, no 999 line for bullying). The DfE product safety standards ask for a tiered pathway ([../dfe-standards.md](../dfe-standards.md)).
4. Approve the phrase list, and the boundary cases left to the classifier ("beats me", "in danger of failing", "my mum will kill me if I fail").
5. Whether tutoring should pause for a student after an IMMEDIATE event until it is reviewed.
6. Alert schedule, out-of-hours cover and response times.
7. What identifying information Eddy can share in an emergency, and how quickly.
8. Whether and how a student may receive their own safety records on request.
9. How long safety records and concern reports are kept.

## Testing

- `pnpm evals:tutor` includes 14 distress conversations (each screened three times) and 8 benign near-misses that must not stop a lesson. The last live run (PLAN.md M7): distress 14 of 14, 14 events written, no false alarms. A live run costs money: ask first.
- `services/api/tests/test_tutor.py` covers the phrase list, the script, event recording, refusals, messages after the script and the classifier being down.
- `services/api/tests/test_jobs.py` covers the alert email (ids, never words).
- `services/api/tests/test_parents.py` covers erasure waiting for review, then keeping an anonymous anchor (`test_erasure_waits_for_review_then_keeps_an_anonymous_anchor`).
- Any change to the script or phrase list needs the lead's approval and a new version number.
- Before activation: send a test alert to the real address, and run this runbook as a tabletop exercise with the lead and deputy. Neither has been done.
