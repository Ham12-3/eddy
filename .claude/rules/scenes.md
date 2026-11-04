---
paths:
  - "packages/scenes/**"
  - "workers/scene-check/**"
---

# Scene rules (SPEC.md section 8)

- Colour comes from element roles, never from a model or a hard-coded hex: given = `--ink`, student = `--student`, faulty step = `--misconception`, corrected idea = `--correct`, "look here" = `--highlight` (behind `--ink` text only). Scenes never use `--accent`.
- Models choose template keys, element ids, beat kinds and parameters only. Positions come from the layout engine. No free x or y coordinates, ever.
- At most 6 beats, at most 25 narration words per beat, one new idea per beat, at most 3 moving elements at once.
- Objects persist and morph; a quantity keeps its colour for the whole scene.
- Every scene has captions, a transcript, a reduced-motion stepped mode and a static annotated diagram. Never autoplay movement. No flashing above 3 per second.
- Colour is never the only signal: the faulty step also gets a mark and a text label.
- All text is real DOM text; maths uses KaTeX with MathML output.
