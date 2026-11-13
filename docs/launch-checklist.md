# Launch checklist

For the product owner to sign off (PLAN.md M10). Each line says who can tick it. "Done" lines point at their evidence; everything else is open. Eddy must not take real students until every line is ticked.

## People and agreements (product owner)

- [ ] A named data protection lead (compliance/governance.md).
- [ ] A named safeguarding lead, who approves the safeguarding script and tripwires (`SCRIPT_APPROVED`, ADR-0031) and the safeguarding runbook (compliance/runbooks/safeguarding.md).
- [ ] Zero data retention with Anthropic confirmed in writing; then `ANTHROPIC_ZDR_CONFIRMED=true` in production.
- [ ] Legal review of the lawful basis, the DPIA and both privacy notices (SPEC.md section 16.2); the notices leave draft (version 1.0.0).
- [ ] Retention periods set in the DPIA for safeguarding events, concern reports, the audit log and logs.
- [ ] The controller and privacy contact named in the full privacy notice.

## Compliance documents (drafted in M10; product owner and lawyer to review)

- [ ] compliance/DPIA.md signed off.
- [ ] compliance/childrens-code.md: every standard Met or explained.
- [ ] compliance/dfe-standards.md reviewed.
- [ ] Runbooks reviewed: safeguarding, incident response, data breach, data rights.

## Engineering (done in M0 to M10, evidence in PLAN.md)

- [x] Every milestone's checks green: `pnpm check`, `pnpm e2e` with zero serious or critical axe findings at 3 widths in light, dark and reduced motion.
- [x] The core journey works by keyboard alone (e2e/keyboard.spec.ts).
- [x] Live pedagogy eval: no answer leaks, 14 of 14 distress conversations handled, 7 of 7 injections held (M7).
- [x] Dependency audits in CI (docs/security-review.md).
- [x] Privacy and safeguarding jobs run on a schedule in the worker (ADR-0034).
- [ ] A further prompt-injection red-team pass (live Claude calls: needs your go-ahead to spend).
- [ ] The screen reader checklist run with NVDA and VoiceOver (docs/screen-reader-checklist.md).
- [ ] The plan route's slow tail under load profiled (docs/security-review.md).
- [ ] A strict nonce-based Content Security Policy.

## Staging (each step needs your go-ahead: docs/staging-plan.md)

- [ ] Hosting chosen: Vercel, Supabase and Fly.io in London (ADR-0035, proposed), or AWS eu-west-2 (ADR-0014). Under ADR-0035, the public API accepted.
- [ ] Accounts and a monthly budget approved; data processing agreements signed, and the providers named in the DPIA and full privacy notice.
- [ ] Dockerfiles, the platform configuration, secrets and the email provider set up.
- [ ] Staging deployed and smoke tested; `pnpm e2e` and the load test run against it.
- [ ] The email sending domain verified (and SES production access under AWS).

Signed off by: ____________________  Date: ____________
