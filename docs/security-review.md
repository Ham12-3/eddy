# Security review (M10)

Draft, 12 November 2026. What Eddy does today, checked against OWASP ASVS 4.0 Level 2, with the evidence and the gaps. No penetration test has been done; this is the engineering team's own review, plus fresh-context reviews at the end of every milestone (PLAN.md evidence blocks M7 to M10).

## Rate limits

| What | Limit | Where |
|---|---|---|
| Tutor inputs | 12 a minute and 400 a day per student (Redis; a message the safeguarding tripwires catch is never limited) | `services/api/src/eddy_api/routes/tutor.py`, `tutor/ratelimit.py` |
| Tutor turns at once | 4 per API process | `config.py` `tutor_concurrent_turns` |
| Tutor Claude spend | £0.50 per student and £20 in total per 24 hours, then templated messages | `routes/tutor.py` `within_budget` |
| Tier L scenes | 12 calls per student and £5 in total per 24 hours | `config.py`, `scenes/variants.py` |
| Invite checks and sign-ups | 10 a minute and 60 a day per visitor (a keyed hash of the address) | `routes/accounts.py` |
| Sign-in links | 3 a minute and 10 a day per address | `routes/accounts.py` `may_sign_in` |
| Parent link codes | 10 a minute and 60 a day per parent | `routes/parents.py` |
| Concern reports | 10 a day per student | `routes/me.py` |
| Data downloads | 5 an hour per student | `routes/me.py` `export_my_data` |
| Page reads (account, plan, progress) | Not limited in the application | Left to a load balancer or WAF rule in staging (docs/staging-plan.md) |

The in-memory fallback used when Redis is down was fixed in M8: it had dropped every key containing a colon.

## ASVS Level 2, by chapter

| Chapter | Status | Evidence | Gaps |
|---|---|---|---|
| V1 Architecture | Partly | The browser talks only to Next.js; Python services are private and called with 60-second ES256 service tokens (ADR-0008, ADR-0018); every route names its roles, and a test checks every `/v1` route refuses a missing token (`tests/test_auth.py`) | No threat model document |
| V2 Authentication | Partly | Email links only, single use, 30 minutes; no passwords; per-address and per-visitor limits; the same page whether or not an address has an account (ADR-0032) | Link codes hashed with plain SHA-256 (ADR-0033); no multi-factor sign-in for admins (no admin accounts exist yet) |
| V3 Sessions | Met for students and parents | Database sessions, token hashed before it leaves the web process, a week without use ends them, deactivation ends them everywhere at once | |
| V4 Access control | Met | Ownership checks on every student and parent route; parents see a child only after acceptance; deactivated students are hidden; the admin pages exist only in development or preview (ADR-0018) | Real admin sign-in |
| V5 Validation and injection | Met | Student maths is never evaluated: MathJSON, an allow-list, then SymPy (ADR-0004); request size and depth limits; ORM or bound SQL throughout; student text is delimited data in prompts (ADR-0031) | |
| V6 Cryptography | Partly | ES256 tokens; secrets from the environment, never logged (`SecretStr`) | Secrets Manager wiring is planned for staging |
| V7 Errors and logging | Partly | The audit log holds actions, never content, and the runtime role can only add to it (ADR-0024) | Log retention needs the DPIA |
| V8 Data protection | Partly | Data minimisation (birth month and year only); download and erasure; tutor messages purged after 90 days; Claude only with zero data retention, enforced in code | Retention of safety records, the audit log and concern reports (DPIA) |
| V9 Communications | Planned | HSTS header; TLS at the load balancer in staging | Not deployed |
| V10 Malicious code | Met | Dependency audits fail CI: `pnpm audit --audit-level high` and `pip-audit` | Two moderate npm advisories in development tooling only (glob, minimatch) |
| V11 Business logic | Met | Invite, link and code limits; one lesson input at a time per lesson | |
| V12 Files | Not applicable | No uploads | |
| V13 API | Met | Strict request schemas (pydantic, `extra="forbid"` where it matters) | |
| V14 Configuration | Partly | Baseline CSP, security headers, `X-Powered-By` off, settings default to production | A strict nonce-based CSP; refusing to start in production with default database passwords |

## Scans run in M10

| Scan | Result |
|---|---|
| `pnpm audit --audit-level high` | 3 high findings in nodemailer 8 (pulled in by Auth.js); fixed by forcing nodemailer 10.5.0 (`package.json` `pnpm.overrides`). Now 2 moderate, development tooling only. In CI from M10. |
| `pip-audit` over the locked Python dependencies | No known vulnerabilities. In CI from M10. |

## Load test

`uv run --package eddy-api python scripts/load/load_test.py` (k6 is not installed here, so this script stands in; ADR-0034). Against the API with 2 workers and maths-core on the local machine, 20 students at once for 30 seconds, no Claude calls:

| Route | p50 | p95 |
|---|---|---|
| `/v1/me` | 145 ms | 260 ms |
| `/v1/me/plan` | 526 ms | 5,181 ms |
| `/v1/me/progress` | 373 ms | 757 ms |
| `/v1/diagnostic` | 182 ms | 396 ms |
| `/v1/curriculum/nodes` | 92 ms | 342 ms |

1,884 requests, 62 a second, no errors. With one student the plan takes 55 ms (p50), so the slow tail comes from contention, not the route itself: worth profiling before launch (more workers, or caching the plan per student).

## Prompt-injection red team

The live pedagogy eval held all 7 injection conversations in M7 (PLAN.md M7 evidence). A further red-team pass with new attacks needs live Claude calls, which cost money: it waits for the product owner's go-ahead.
