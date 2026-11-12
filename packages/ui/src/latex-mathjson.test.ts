import { describe, expect, it } from "vitest";

import { LatexError, latexToMathJson } from "./latex-mathjson";

describe("latexToMathJson", () => {
  it.each([
    ["36", 36],
    ["-9", ["Negate", 9]],
    ["0.14", { num: "0.14" }],
    ["2.50", { num: "2.50" }],
    ["1{,}000", 1000],
    ["\\frac{7}{50}", ["Divide", 7, 50]],
    ["2\\frac{1}{2}", ["InvisibleOperator", 2, ["Divide", 1, 2]]],
    ["3x-6", ["Subtract", ["Multiply", 3, "x"], 6]],
    ["x=7", ["Equal", "x", 7]],
    ["4\\times10^{8}", ["Multiply", 4, ["Power", 10, 8]]],
    ["12\\div3", ["Divide", 12, 3]],
    ["\\sqrt{2}", ["Sqrt", 2]],
    ["40\\%", ["Percent", 40]],
    ["101^{\\circ}", ["Degrees", 101]],
    ["101\\degree", ["Degrees", 101]],
    ["\\pounds7.33", { num: "7.33" }],
    ["60\\mathrm{g}", ["Multiply", 60, "g"]],
    ["5\\,\\mathrm{cm}", ["Multiply", 5, "cm"]],
    ["12cm", ["Multiply", 12, "cm"]],
    ["(2,3)", ["Delimiter", ["Tuple", 2, 3]]],
    ["6:5", ["Ratio", 6, 5]],
    ["\\left(-3\\right)\\times2", ["Multiply", ["Delimiter", ["Negate", 3]], 2]],
    ["\\pi r^{2}", ["Multiply", "Pi", ["Power", "r", 2]]],
    ["-2\\frac{1}{2}", ["Negate", ["InvisibleOperator", 2, ["Divide", 1, 2]]]],
    ["x=-3\\frac{1}{4}", ["Equal", "x", ["Negate", ["InvisibleOperator", 3, ["Divide", 1, 4]]]]],
    ["5min", ["Multiply", 5, "min"]],
    ["2x", ["Multiply", 2, "x"]],
  ])("reads %s", (latex, expected) => {
    expect(latexToMathJson(latex)).toEqual(expected);
  });

  it.each(["", "\\frac{}{2}", "3+", "\\placeholder{}", "\\int x", "\\text{hello}", "1,000", "2 3"])(
    "explains what it cannot read: %s",
    (latex) => {
      expect(() => latexToMathJson(latex)).toThrow(LatexError);
    },
  );
});
