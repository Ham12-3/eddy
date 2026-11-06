import { describe, expect, it } from "vitest";
import type { SceneElement } from "../layout/types";
import { TEMPLATES } from "../templates/registry";
import { buildScene, type BuiltScene } from "../templates/template";
import { checkScene, describeProblem, type CheckName } from "./static-checks";

function sample(index = 0): BuiltScene {
  const template = TEMPLATES[index]!;
  return buildScene(template, template.sample.item, template.sample.studentAnswer);
}

/** The sample scene with its desktop frames replaced. */
function withFrames(frames: SceneElement[][]): BuiltScene {
  const scene = sample();
  const spec = {
    ...scene.spec,
    beats: frames.map(() => ({ ...scene.spec.beats[0]!, focus: ["question"] })),
  };
  return {
    ...scene,
    spec,
    layouts: {
      ...scene.layouts,
      desktop: { ...scene.layouts.desktop, frames: frames.map((elements) => ({ elements })) },
      mobile: {
        ...scene.layouts.mobile,
        frames: frames.map(() => ({ elements: [label("question", 200, 200)] })),
      },
    },
  };
}

function label(id: string, x: number, y: number, extra: Partial<SceneElement> = {}): SceneElement {
  return {
    id,
    role: "given",
    type: "text",
    x,
    y,
    w: 200,
    h: 55,
    size: 44,
    font: "body",
    align: "start",
    text: "Hi",
    ...extra,
  } as SceneElement;
}

function checks(scene: BuiltScene): CheckName[] {
  return [...new Set(checkScene(scene).map((problem) => problem.check))].sort();
}

describe("the default scenes", () => {
  for (const template of TEMPLATES) {
    it(`${template.key} passes every static check in both formats`, () => {
      const problems = checkScene(
        buildScene(template, template.sample.item, template.sample.studentAnswer),
      );
      expect(problems.map(describeProblem)).toEqual([]);
    });
  }
});

describe("each check catches its problem", () => {
  it("text off the canvas and inside the margin", () => {
    expect(checks(withFrames([[label("question", 1500, 200)]]))).toEqual(["off_canvas"]);
    expect(checks(withFrames([[label("question", 20, 200)]]))).toEqual(["margins"]);
  });

  it("text over text, and text over a shape it does not belong in", () => {
    expect(
      checks(withFrames([[label("question", 200, 200), label("question.b", 250, 220)]])),
    ).toEqual(["overlap"]);
    const bar: SceneElement = {
      id: "question.bar",
      role: "given",
      type: "rect",
      x: 180,
      y: 180,
      w: 400,
      h: 100,
    };
    expect(checks(withFrames([[label("question", 200, 200), bar]]))).toEqual(["overlap"]);
    expect(
      checks(withFrames([[label("question", 200, 200, { inside: "question.bar" }), bar]])),
    ).toEqual([]);
  });

  it("a label too big for its container", () => {
    const box: SceneElement = {
      id: "question.box",
      role: "given",
      type: "rect",
      x: 200,
      y: 200,
      w: 100,
      h: 100,
    };
    expect(
      checks(withFrames([[label("question", 200, 200, { inside: "question.box" }), box]])),
    ).toEqual(["overflow"]);
  });

  it("text too small to read on the narrowest screen", () => {
    expect(checks(withFrames([[label("question", 200, 200, { size: 20 })]]))).toEqual([
      "font_size",
    ]);
  });

  it("a faulty step marked by colour alone, and a quantity that changes colour", () => {
    expect(checks(withFrames([[label("question", 200, 200, { role: "misconception" })]]))).toEqual([
      "colour_roles",
    ]);
    expect(
      checks(
        withFrames([
          [label("question", 200, 200)],
          [label("question", 200, 200, { role: "student" })],
        ]),
      ),
    ).toEqual(["colour_roles"]);
  });

  it("coloured text on a highlighter wash that loses its contrast", () => {
    const wash: SceneElement = {
      id: "question.wash",
      role: "highlight",
      type: "rect",
      x: 190,
      y: 190,
      w: 300,
      h: 80,
      fill: true,
    };
    expect(checks(withFrames([[label("question", 200, 200, { role: "correct" }), wash]]))).toEqual([
      "contrast",
    ]);
    expect(checks(withFrames([[label("question", 200, 200), wash]]))).toEqual([]);
  });

  it("more than three elements moving at once", () => {
    const before = [0, 1, 2, 3].map((i) => label(`question.${i}`, 200 + i * 220, 200));
    const after = [0, 1, 2, 3].map((i) => label(`question.${i}`, 200 + i * 220, 400));
    expect(checks(withFrames([before, after]))).toEqual(["moving_elements"]);
  });

  it("elements that belong to no focus id, or a focus with nothing on the canvas", () => {
    expect(checks(withFrames([[label("stray", 200, 200)]]))).toEqual(["focus"]);
  });
});
