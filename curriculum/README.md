# Curriculum data

The curriculum Eddy teaches from, as reviewable YAML. `pnpm db:seed` loads it into Postgres (ADR-0021). Every file has a JSON Schema in `schemas/`, and the loader also checks the files against each other.

| File | What it holds |
|---|---|
| `specs.yaml` | The DfE subject content, and the AQA 8300, Edexcel 1MA1 and OCR J560 maths specs that build on it (papers, marks, calculator rules), plus AQA English Language 8700 and Literature 8702. |
| `maths/nodes.yaml` | One node per DfE statement, N1 to S6 (97), with tier and how well it suits animation (1 to 3). |
| `maths/prerequisites.yaml` | The prerequisite DAG for the MVP nodes and all their ancestors, with strengths. |
| `maths/topics.yaml` | The 13 MVP topics, their nodes and the scene primitive that teaches each. |
| `maths/misconceptions.yaml` | The misconception library: student and teacher wording, detection rules (ADR-0022), the scene that remediates it, the re-check item family and the evidence. |
| `english/set_texts.yaml` | Literature set texts with copyright status and display policy. |
| `english/question_types.yaml` | English question types and level descriptors, all in our own words. |

## Commands

```bash
pnpm curriculum:check
```

Validates every file. No database needed; CI runs it on every push.

```bash
pnpm db:seed --dry-run --verbose
```

Shows exactly what a seed would create, update or delete, then rolls back.

```bash
pnpm db:seed
```

Applies it. Running it twice reports zero changes the second time.

## Rules

- Our own words only. No exam board questions, mark schemes or level wording, and no AQA, Pearson or OCR material in any form (CLAUDE.md). Node text paraphrases the DfE content (Open Government Licence v3.0).
- UK English and never an en or em dash. The `prose` schema rejects both.
- Quote any value that contains `: ` or starts with a quote mark, or YAML reads it wrongly. In flow mappings (`{ ... }`), quote any value with a comma.
- Every MVP node and each of its ancestors appears in `prerequisites.yaml`; a root has `[]`. A cycle fails the check.
- Each MVP topic needs at least four misconceptions. Every `distractor` rule name must be implemented in maths-core (M3).
- The seed never deletes a node, topic, misconception or set text. Removing one from the YAML retires it (`retired_at`), so it is no longer served; adding it back restores it.
- Student text names the idea, never an item's numbers, so it cannot give an answer away.
- In-copyright set texts are never `FULL_TEXT`. The schema enforces it.

## Adding a misconception

Use the `/new-misconception` skill. It writes the YAML entry with its detection rule, re-check family and scene name, and runs the checks. It adds the maths-core rule (from M3) and the scene template stub (from M5) once those exist.
