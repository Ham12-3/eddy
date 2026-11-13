# Runbook: personal data breach

Status: **DRAFT, 12 November 2026, for review by the product owner.** Written by the build team, not by a lawyer or data protection professional; it needs the data protection lead's review and legal review before launch (SPEC.md section 16, question 2). Eddy is not deployed and holds no real student data yet. This runbook has not been exercised.

A personal data breach is a breach of security leading to the accidental or unlawful destruction, loss, alteration, unauthorised disclosure of, or access to, personal data (UK GDPR Article 4(12)). It includes data made unavailable, not only data stolen. Run this alongside [incident-response.md](incident-response.md), which covers containment.

## Roles

| Role | Who | Responsibility |
|---|---|---|
| Data protection lead | To be named | Owns this runbook; assesses risk; decides on ICO notification and on telling individuals; keeps the breach register |
| Incident lead | To be named | Containment and the technical timeline |
| Safeguarding lead | To be named | Consulted whenever safety records, tutor messages or a child's risk are involved |
| Accountable owner | The product owner | Approves notifications and messages to users |
| Controller contact for the ICO | To be named (the controller is not yet named in the privacy notice) | Files the report |

## The 72-hour clock

- If a breach is likely to result in a risk to people's rights and freedoms, the controller must report it to the ICO **without undue delay and, where feasible, within 72 hours of becoming aware of it** (UK GDPR Article 33). Awareness means a reasonable degree of certainty that a breach has happened, not the end of the investigation.
- If full details are not known within 72 hours, report what is known and add the rest later, giving reasons for any delay.
- If the risk to individuals is likely to be **high**, tell them too, without undue delay (Article 34).
- Every breach, reported or not, goes in the breach register with the facts, effects and action taken (Article 33(5)).
- Processors (Anthropic, and the hosting and email providers once contracted) must tell Eddy without undue delay; the processor agreements, not yet in place, must say so.

Most Eddy users are children, who merit specific protection with regard to their personal data (UK GDPR Recital 38), so lean towards "risk" and "high risk" when unsure.

## Step by step

| When | Step | Who |
|---|---|---|
| Hour 0 | Record the time Eddy became aware, who noticed and how. Start the timeline (UTC). | Whoever notices, then the data protection lead |
| Hours 0 to 4 | Contain ([incident-response.md](incident-response.md), section 3). Preserve evidence: copy the relevant `audit_log`, `llm_call`, `sessions` and log extracts. Never alter `audit_log`. | Incident lead |
| Hours 0 to 24 | Establish what data, whose, how many, and what could happen to them (table below). If safety records or tutor messages are involved, involve the safeguarding lead. | Data protection lead |
| By hour 48 | Decide: no risk (register only), risk (report to the ICO), or high risk (report to the ICO and tell individuals). Record the reasoning either way. | Data protection lead, approved by the accountable owner |
| By hour 72 | Report to the ICO if required (ico.org.uk, "Report a breach"; ICO helpline 0303 123 1113). Report in phases if needed. | Controller contact |
| As soon as possible after deciding | Tell affected individuals if high risk (below). | Data protection lead |
| Within 10 working days (proposed) | Post-incident review; update the DPIA and this runbook. | Data protection lead |

## What Eddy holds, and how sensitive it is

From SPEC.md section 6 and the privacy notice (`apps/web/src/content/privacy.tsx`):

| Data | Where | Sensitivity |
|---|---|---|
| Email address | `users`, `pending_signup` | Identifies the person |
| Birth month and year | `student_profile`, `pending_signup` | Low alone; with email, shows the person is a child |
| Set-up and accessibility preferences | `student_profile.preferences` | Dyslexia mode could suggest a special educational need |
| Answers, confidence, mastery and misconceptions | `attempt`, `mastery_state`, `misconception_state`, `review_card` | Educational record |
| Tutor messages | `tutor_message` (text deleted after 90 days by `python -m eddy_api.jobs purge`) | Free text a child typed: may contain anything, including disclosures |
| Safeguarding events and concern reports | `safeguarding_event`, `concern_report` | **Highest**: may describe abuse, self-harm or danger |
| Parent links | `parent_link`, parent `users` rows | Shows a family relationship |
| Sessions and sign-in links | `sessions` (hashed tokens), `verification_token` | Takeover risk if usable |
| Audit log | `audit_log` (ids, actions, times) | Activity record |
| Claude call metadata | `llm_call` (no content) | Usage per pseudonymous student |

Data sent to Anthropic (answers and messages with a pseudonymous id) is behind the zero data retention gate (`services/api/src/eddy_api/config.py`); ZDR is not yet confirmed, so no real data may reach Claude.

## Using the audit log as evidence

`audit_log` is append-only: a trigger blocks updates and deletes, and the runtime role `eddy_app` has only SELECT and INSERT on it (migration 0006; `services/api/tests/test_migrations.py`, `test_audit_log_is_append_only`, `test_the_runtime_role_only_reads_and_adds_to_the_audit_log`). Each row has `actor_id`, `actor_role`, `action`, `target_type`, `target_id` and `created_at`.

Useful questions it can answer:

- Which parents viewed which child's dashboard, and when (`parent.view_dashboard`).
- Who downloaded which data, and when (`data.export`).
- Sign-ins (`session.create`), sign-ups (`account.create`), deletion requests (`account.delete_request`), notice acknowledgements, parent link requests, accepts and ends, concern reports.

What it cannot answer: it does not record IP addresses or user agents, ordinary page views by students, or reads made directly in the database. Database access logs and web access logs (not yet designed for production) are needed for those. Extract the rows for the breach window as the owner role into a file kept with the breach record; do not change the table.

## Telling individuals

When the risk is high, tell those affected without undue delay, in plain language: what happened, what data, the likely consequences, what Eddy has done, what they can do, and who to contact. Eddy has only email addresses, so the message goes by email (`eddy_api.mail`; Amazon SES in production, not yet set up).

- Write to students at a reading age of about 12, calmly, with no blame and no alarm words. Include Childline (0800 1111) where the data could upset them.
- Do not tell a parent about a student's data unless a link is active and what the parent could see is involved; a parent may be the source of risk (safeguarding.md). Never mention safety records to anyone but the student, and only after the safeguarding lead has advised.
- Every message is approved by the accountable owner before it is sent.

## Breach register

Location to be decided. One entry per breach: date and time aware, description, data and people affected, consequences, containment, risk decision and reasoning, ICO reference if reported, individuals told (when, how), review actions.

## Gaps

- No named controller, data protection lead or ICO contact; the privacy notice's controller section is a placeholder.
- No processor agreements requiring prompt breach notice from Anthropic, the host or the email provider.
- No production logging, database access logging or backups; nothing is deployed.
- The audit log records no IP address or user agent, which limits investigation.
- Retention for the audit log is not set (ADR-0024).
- The breach register and incident record have no home yet.
- Not rehearsed.
