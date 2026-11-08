---
name: new-template
description: Scaffold a scene template in packages/scenes (a Tier D explanation for one misconception): its parameters, spec with narration, drawing for both formats, maths claims and sample, then golden inputs, static and DOM checks and screenshots. Use when a misconception needs its default scene, or the user asks for a new scene or primitive.
---

# Add a scene template

A scene template explains one misconception on one item template, with no model call (SPEC.md
section 7.2, Tier D). Read `.claude/rules/scenes.md`, ADR-0027, and
`packages/scenes/src/templates/compare-negatives.ts`, the reference scene, before writing anything.
Stop and ask if the misconception has no item template in maths-core that produces its wrong
answer: the scene needs real parameters and a real wrong answer.

## 1. Pin down the scene

- The misconception code and node from `curriculum/maths/misconceptions.yaml`; its `scene` field
  is the template key (`<primitive>.<scene>`).
- The maths-core item template whose distractor is this misconception
  (`services/maths-core/src/eddy_maths_core/items/`), and the full range of parameters it draws.
- The primitive. Reuse one from `packages/scenes/src/primitives/` when it fits; a new primitive is
  a pure geometry builder in its own file, like `number-line.ts`.

## 2. Write the template

Create `packages/scenes/src/templates/<scene>.ts` exporting one `SceneTemplate`:

- `params`: read and validate the item's parameters with the helpers in `templates/shared.ts`;
  accept everything the item template can draw, and throw on anything else.
- `spec`: the Tier D SceneSpec. At most 6 beats and 25 words each; usually `show_given`,
  `show_student_working`, `build` or `transform`, `highlight_slip`, `reveal_correct`. Warm, plain,
  second person, UK English, no dashes, no exclamation marks; the slip named kindly ("A common
  slip:"), the last beat stating the correct idea.
- `draw`: every element for the revealed focus ids, in both formats, from the template's regions.
  Ids persist across beats; every id starts with a focus id; at most 3 elements move between
  beats; colour only from roles; a faulty step also gets a pen mark and a text label.
- `claims`: MathJSON relations for every maths fact the scene states (never the faulty step).
- `sample`: a worked example for the gallery.

Append it to `TEMPLATES` in `templates/registry.ts`.

## 3. Golden inputs

Add the item template and misconception to `SCENES` in
`services/maths-core/src/eddy_maths_core/scene_golden.py`, then:

```bash
uv run --package eddy-maths-core python -m eddy_maths_core.scene_golden inputs evals/golden/scenes/inputs.json
```

The inputs file is frozen: review its diff (only the new scene's entries should be added).

## 4. Check

```bash
pnpm --filter @eddy/scenes test
```

```bash
pnpm scenes:check <scene key>
```

```bash
pnpm scenes:golden
```

Then look at every keyframe in `e2e-artifacts/scenes/<scene key>/` (at least the 1152 px and 288 px
light ones for each beat, and a dark one) and fix anything cramped, misaligned or unclear. Open
`/admin/scenes/<scene key>` in the dev server to play it.

## 5. Review and report

Ask the `pedagogy-critic` agent to review the narration and the beats. Tell the user the template
key, the beats' narration, the check results and anything left over. Ask before committing.
