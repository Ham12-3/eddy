---
paths:
  - "services/maths-core/**"
---

# maths-core rules (SPEC.md section 7.3)

- Student input arrives as MathJSON. Validate it against the allow-list (size and depth limits), then convert with the tree walker. Never call `eval`, `exec`, `sympify` on a string, or `parse_expr` on anything a student or a model produced.
- Nothing mathematical reaches a student unverified: items, answer keys, distractors, steps, tutor messages and scene specs all go through this service.
- Equivalence means symbolic `simplify(a - b) == 0` plus numeric sampling, then the answer-format rules. Never string comparison.
- Every distractor must equal its misconception rule applied to the item parameters, must differ from the answer, and must differ from every other distractor.
- Every item template gets Hypothesis property tests. The golden set must stay at 100%.
- Keep p95 verification under 150 ms; add a benchmark when you add a code path.
- No database access and no network calls from this service. It is stateless.
