# Governance

**Status: DRAFT, 12 November 2026, for review by the product owner and a lawyer.** Not approved. Every role must have a named person before any real student uses Eddy (PLAN.md approval gates). No name below is a confirmed appointment except where SPEC.md already records it.

Sources: SPEC.md section 16 (open questions), PLAN.md "Approval gates", ADR-0005, ADR-0014, ADR-0024, ADR-0031, ADR-0032, ADR-0033, and the code switches named in section 3.

---

## 1. Roles

| Role | Responsibilities | Named person |
|---|---|---|
| Controller (the organisation) | The legal entity responsible for students' and parents' data; named in the privacy notices and processor contracts | To be named. The draft full notice says the controller "will be named here before Eddy opens to everyone" (`apps/web/src/content/privacy.tsx`) |
| Product owner (accountable owner) | Overall product, safety and compliance decisions; approves every gate in PLAN.md; approves edits under `compliance/` (`.claude/rules/compliance.md`, `compliance/README.md`) | Abdulhamid (recorded as owner in SPEC.md). **Open:** whether the product owner acts for the controller, and in what capacity (owner: the product owner with a lawyer) |
| Data protection lead | Owns the DPIA, retention periods, processor agreements and transfers, data rights requests (`compliance/runbooks/data-rights.md`), breach decisions and ICO contact | To be named |
| Data protection officer | Statutory advice and monitoring, if one is required | **Open:** whether a DPO is required (owner: a lawyer) |
| Safeguarding lead | Reviews every safeguarding event and SAFETY concern; decides escalation, including when to contact emergency services; owns the safeguarding runbook; approves the safeguarding script and tripwire list; decides what safety records a student may receive in a download (ADR-0033) | To be named. Needs a safeguarding professional's advice (SPEC.md section 16.1) |
| Security lead | Security reviews, incident response, access control to production data and owner database credentials, the breach runbook with the data protection lead | To be named |
| Engineering lead | Builds and runs the jobs, migrations and deployments; answers technical parts of rights requests; keeps the evidence in PLAN.md accurate | To be named |
| Content and pedagogy reviewer | Reviews misconceptions, scenes, narration, prompts and tutor behaviour before release; no exam board material (CLAUDE.md) | To be named |
| Legal reviewer (external) | Lawful basis, the DPIA, privacy notices, transfer mechanism, Article 9 condition for safeguarding excerpts | To be named (SPEC.md section 16.2) |

One person may hold more than one role. **Open:** whether the safeguarding lead and the data protection lead may be the same person, given that the safeguarding lead decides on access to safety records (owner: the product owner with the safeguarding professional).

---

## 2. What each role must approve before launch

Nothing in this table has been approved. The "Evidence" column is filled in only when a dated record exists.

| # | Approval | Approver | Source | Evidence |
|---|---|---|---|---|
| 1 | Name the controller, the data protection lead, the safeguarding lead, the security lead, the engineering lead and the content reviewer | Product owner | PLAN.md approval gates; this file | |
| 2 | Safeguarding route for the B2C service: who reviews, the response time, when emergency services are contacted | Safeguarding lead, with professional advice | SPEC.md section 16.1, ADR-0031 | |
| 3 | The safeguarding script and the tripwire list (`services/api/src/eddy_api/tutor/safeguarding.py`, `config/safeguarding/tripwires.yaml`), which are drafts (`SCRIPT_VERSION = "draft-1"`) | Safeguarding lead | ADR-0031, CLAUDE.md | |
| 4 | The safeguarding runbook in `compliance/runbooks/` | Safeguarding lead, then the product owner | ADR-0031, PLAN.md M7 | |
| 5 | Retention of safeguarding excerpts, SAFETY concerns and the audit log | Safeguarding lead and data protection lead, with a lawyer | SPEC.md sections 6.7 and 16.6, ADR-0024 | |
| 6 | The other open retention periods listed in `compliance/DPIA.md` section 2.2 | Data protection lead | DPIA | |
| 7 | Lawful basis, the DPIA and both privacy notices | Legal reviewer, then the product owner | SPEC.md section 16.2, ADR-0002 | |
| 8 | ZDR and no training with Anthropic, a data processing agreement and a UK transfer mechanism | Product owner and data protection lead, with a lawyer | SPEC.md sections 10, 12 and 16.4, ADR-0005 | |
| 9 | Hosting and email processors (AWS eu-west-2, Amazon SES), their agreements, and the first deployment | Product owner | ADR-0014, PLAN.md approval gates | |
| 10 | DPIA sign-off (measures and residual risks) | Product owner, data protection lead | `compliance/DPIA.md` section 7 | |
| 11 | The incident response, personal data breach and data rights runbooks | Security lead and data protection lead | `compliance/runbooks/README.md` | |
| 12 | School pilot partner and timing, which decides when the DfE matrix's school-facing reports matter | Product owner | SPEC.md section 16.5 | |
| 13 | A paid narration voice, if one is chosen (reopens its DPIA row) | Product owner, data protection lead | SPEC.md section 16.4, ADR-0029 | |

---

## 3. Switches in the code that need an approval first

These settings and constants turn on processing that the approvals above must cover. Setting one in production without its approval is a governance failure.

| Switch | Effect | Default | Needs |
|---|---|---|---|
| `ANTHROPIC_ZDR_CONFIRMED` (`services/api/src/eddy_api/config.py`) | Lets Claude run against a non-local database (`tier_l_enabled`) | `False` | Approval 8 |
| `SCRIPT_APPROVED` (`services/api/src/eddy_api/tutor/safeguarding.py`) | Lets the tutor start outside development and test (`routes/tutor.py`) | `False` | Approvals 2 and 3 |
| `SAFEGUARDING_ALERT_EMAIL` (`config.py`) | Where alerts go; empty means no alert is sent (`jobs.py`) | Empty | Approval 2, and the safeguarding lead's address |
| `EDDY_ENVIRONMENT` (`config.py`) | `development` or `test` opens the local-database ZDR exception and the unapproved script | `production` | Must never be `development` or `test` where real data is held |
| `TUTOR_MESSAGE_DAYS` (`config.py`) | Days before tutor message text is deleted | 90 | A change needs the data protection lead |

**Open:** who may change these in production, and how a change is recorded (owner: the security lead, once deployment exists).

---

## 4. Gaps

- **Open:** every role except the product owner is unnamed (owner: the product owner).
- **Open:** no admin sign-in or safeguarding queue exists, so the safeguarding lead has no in-app way to read events or record a review; the queue was deferred (ADR-0032), and no code sets `reviewed_at` (owner: engineering).
- **Open:** the privacy jobs run by command only in committed code (ADR-0033); who runs them, and how often, until they are scheduled (owner: the engineering lead).
- **Open:** a register of decisions and approvals, with dates, kept alongside this file (owner: the product owner).
