"""The learner model (SPEC.md section 7.1, ADR-0026). Code decides, the model speaks.

Pure functions over plain data, so every transition is deterministic and testable:

- `bkt`: Bayesian knowledge tracing per node.
- `mastery`: node status (UNSEEN, LEARNING, SECURE, NEEDS_REVIEW), the aided-attempt weighting,
  prerequisite propagation and the two-failure prerequisite diagnostic.
- `elo`: item difficulty and per-strand ability, and target-band item choice.
- `review`: FSRS review cards and the rating from correctness, confidence, hints and time.
- `misconceptions`: the misconception state machine and remediation queue.
- `planner`: node selection, interleaving and today's plan.
- `simulator`: synthetic students with hidden mastery and misconceptions, for the tests.

The tutor loop (M7) reads and writes these through the learning tables; nothing here touches
the database.
"""
