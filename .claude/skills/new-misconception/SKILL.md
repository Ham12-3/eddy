---
name: new-misconception
description: Add a misconception to Eddy's library. Writes the curriculum/maths/misconceptions.yaml entry with its detection rule, names the re-check item family and the default scene, adds stubs where maths-core and the scene templates exist, then validates and seeds. Use when the user names a new maths mistake to detect and remediate.
---

# Add a misconception

Work through these steps in order. Stop and ask the user if the mistake is vague, if it belongs to a node outside the MVP topics and their ancestors, or if the evidence for it is unclear.

## 1. Pin down the mistake

Get, from the user or the conversation:

- the node (a DfE code such as N2 or A17) and the MVP topic it serves;
- a concrete wrong answer, with the item that produces it (for example 1/2 + 1/3 answered 2/5);
- where the evidence comes from: `brief-s2` (docs/brief.md section 2), `practice` (widely documented, to be confirmed from our data), or an `https://` source the user gives. Never invent a source.

Read `curriculum/maths/misconceptions.yaml` and check the mistake is not already there under another code.

## 2. Write the YAML entry

Add it beside the other entries for the same node:

```yaml
  - code: FRAC_ADD_NUM_DEN          # SCREAMING_SNAKE, unique
    node: N2
    title: "Adds the numerators and adds the denominators"
    student: "..."                  # kind and plain; names the slip, never the student
    teacher: "..."                  # the precise error, with a worked example
    detect: [{ type: distractor, rule: frac_add_num_den }]
    scene: bar_model.fraction_add   # <primitive>.<template>
    recheck: N2.fraction-add-unlike # starts with the node code
    evidence: brief-s2
```

- Detection (ADR-0022): prefer `distractor` when the wrong answer can be computed from the item parameters. Use `classifier` only when no rule can compute it; it can only ever make the misconception SUSPECTED.
- The scene primitive must be one of those in `curriculum/schemas/common.schema.json`, normally the topic's own primitive from `topics.yaml`.
- Writing rules: UK English, no en or em dash, no emoji, our own words only, no AQA, Pearson or OCR material. Double-quote the prose fields.

## 3. Stubs in code (only where the code exists)

- **maths-core (from M3):** if `services/maths-core` has a distractor rule registry, add a function for the new rule name with a property test that its output differs from the correct answer, and add a re-check template to the named item family if the family does not exist yet. Before M3, leave a note in the PR that the rule name is new.
- **scenes (from M5):** if `packages/scenes` has templates for the primitive, add a stub template for the scene name that renders the default explanation; before M5, the name is enough.

## 4. Check and seed

```bash
pnpm curriculum:check
```

```bash
pnpm db:seed --dry-run --verbose
```

The dry run should show exactly one created misconception. Then run `pnpm db:seed` if the user wants it in their local database, and `uv run pytest services/api/tests/test_curriculum_files.py`.

## 5. Report

Tell the user the code, node, rule name and scene name, which stubs were added, and anything left for a later milestone. Ask before committing.
