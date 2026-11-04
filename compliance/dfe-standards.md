# DfE Generative AI product safety standards: compliance matrix

Status: **skeleton** (created in M0). Standards as updated on 19 January 2026.

The brief notes that commentators count these differently (sometimes 13). Before M10, check this list against the primary GOV.UK document and adjust the rows.

"Planned approach" summarises SPEC.md. Tests and evidence are added only when they exist.

| Standard | Planned approach | Tests | Evidence | Status |
|---|---|---|---|---|
| Statement of purpose and use case | Published purpose: Foundation maths tutoring for ages 13+, supplementing teachers | | | Not started |
| Filtering | Deterministic tripwires plus input and output classifiers inside the tutor pipeline; topic restriction | | | Not started |
| Monitoring, logging and reporting | Append-only audit log; `safeguarding_event`; school-facing reports when schools join | | | Not started |
| Security | Prompt-injection suite, rate limits, OWASP ASVS Level 2, private services behind a BFF | | | Not started |
| Privacy and data protection | DPIA, minimised data, UK residency for stored data, ZDR with Anthropic | | | Not started |
| Intellectual property | No learner work used for training; no exam board material | | | Not started |
| Design and testing | Eval suites in CI with thresholds (SPEC.md section 7.6) | | | Not started |
| Governance | Named roles in [governance.md](governance.md) | | | Not started |
| Cognitive development | Hint ladder; never the final answer; independent attempt before help | | | Not started |
| Emotional and social development | Clearly an AI; no bonding or dependency; encourages asking teachers | | | Not started |
| Mental health | Distress detection and a static, reviewed safeguarding script with UK resources | | | Not started |
| Manipulation | No persuasive design and no upsell to children; no billing in the MVP | | | Not started |
