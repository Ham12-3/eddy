import type { MathNode } from "./types";
import metricsJson from "./font-metrics.json" with { type: "json" };

/**
 * Text measurement from the real font files (SPEC.md section 8.3), so layout is identical in Node
 * and in the browser. Widths come from each glyph's advance; kerning is left out, so boxes carry a
 * little padding and the keyframe checker confirms the real DOM boxes fit.
 */

interface FontMetrics {
  unitsPerEm: number;
  ascent: number;
  descent: number;
  advances: Record<string, number>;
}

type FontName = "body" | "pen" | "mathMain" | "mathItalic";
const METRICS = metricsJson as Record<FontName, FontMetrics>;

/** Line height for scene text, as a multiple of the font size. */
export const LINE_HEIGHT = 1.25;
/** Padding added to each measured width, as a multiple of the font size. */
const PADDING = 0.1;
/**
 * Room for the same text rendering a little wider on another system: font hinting on Linux and
 * some phones rounds glyph advances, so a label measured here can come out 1 to 3% wider there
 * (the keyframe checker found it in CI). Maths gets more: KaTeX's own spacing varies a little too.
 */
const TEXT_SAFETY = 1.03;
const MATHS_SAFETY = 1.05;

export interface Size {
  w: number;
  h: number;
}

function advance(font: FontName, char: string): number {
  const metrics = METRICS[font];
  // A character outside the measured set is assumed as wide as "M": too wide, never too narrow.
  const units = metrics.advances[char] ?? metrics.advances.M ?? metrics.unitsPerEm;
  return units / metrics.unitsPerEm;
}

/** Width of a run of text in ems. */
export function emWidth(text: string, font: FontName = "body"): number {
  let total = 0;
  for (const char of text) {
    total += advance(font, char);
  }
  return total;
}

/** One line of text at `size` canvas units. */
export function measureText(text: string, size: number, font: "body" | "pen" = "body"): Size {
  return { w: (emWidth(text, font) * TEXT_SAFETY + PADDING) * size, h: LINE_HEIGHT * size };
}

/** Splits text into lines no wider than `maxWidth` at `size`. A single long word stays whole. */
export function wrapText(
  text: string,
  size: number,
  maxWidth: number,
  font: "body" | "pen" = "body",
): string[] {
  const lines: string[] = [];
  let line = "";
  // Breaks only at ordinary spaces: a no-break space keeps "1 : 2" on one line.
  for (const word of text.split(/[ \t\n]+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && measureText(candidate, size, font).w > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) {
    lines.push(line);
  }
  return lines;
}

// KaTeX spacing in ems: medium space around binary operators, thick space around relations.
const BINARY = new Set(["+", "−", "-", "×", "÷", "·"]);
const RELATION = new Set(["=", "<", ">", "≈", "≠", "≤", "≥"]);
const MEDIUM_SPACE = 4 / 18;
const THICK_SPACE = 5 / 18;
// Exponents are set with \small: 90% of the label size (see mathsToTex).
export const SCRIPT_SCALE = 0.9;

interface MathBox {
  /** Width in ems. */
  w: number;
  /** Height above and below the baseline, in ems. */
  up: number;
  down: number;
}

const TEXT_BOX = { up: 0.75, down: 0.25 };

function row(nodes: readonly MathNode[]): MathBox {
  let w = 0;
  let up: number = TEXT_BOX.up;
  let down: number = TEXT_BOX.down;
  for (const node of nodes) {
    const box = single(node);
    w += box.w;
    up = Math.max(up, box.up);
    down = Math.max(down, box.down);
  }
  return { w, up, down };
}

function single(node: MathNode): MathBox {
  if ("num" in node) {
    return { w: emWidth(node.num.replace("-", "−"), "mathMain"), ...TEXT_BOX };
  }
  if ("sym" in node) {
    return { w: emWidth(node.sym, "mathItalic"), ...TEXT_BOX };
  }
  if ("text" in node) {
    return { w: emWidth(node.text, "mathMain"), ...TEXT_BOX };
  }
  if ("op" in node) {
    const space = RELATION.has(node.op) ? THICK_SPACE : BINARY.has(node.op) ? MEDIUM_SPACE : 0;
    return { w: emWidth(node.op, "mathMain") + 2 * space, ...TEXT_BOX };
  }
  if ("frac" in node) {
    // \dfrac: full-size numerator and denominator stacked about the maths axis (0.25 em up).
    const [top, bottom] = [row(node.frac[0]), row(node.frac[1])];
    return {
      w: Math.max(top.w, bottom.w) + 0.24,
      up: 0.25 + 0.2 + top.up + top.down,
      down: -0.25 + 0.2 + bottom.up + bottom.down,
    };
  }
  if ("pow" in node) {
    const [base, exponent] = [row(node.pow[0]), row(node.pow[1])];
    return {
      w: base.w + exponent.w * SCRIPT_SCALE + 0.05,
      up: Math.max(base.up, 0.4 + (exponent.up + exponent.down) * SCRIPT_SCALE),
      down: base.down,
    };
  }
  const inner = row(node.sqrt);
  return { w: inner.w + 0.9, up: inner.up + 0.2, down: inner.down + 0.1 };
}

/** A maths label at `size` canvas units (the scene stage sets KaTeX's em to the label size). */
export function measureMaths(nodes: readonly MathNode[], size: number): Size {
  const box = row(nodes);
  return {
    w: (box.w * MATHS_SAFETY + PADDING) * size,
    h: Math.max(LINE_HEIGHT, box.up + box.down + 0.1) * size,
  };
}

/** Trust stays off (no links, classes or images from TeX) and expansion is kept small. */
export const KATEX_OPTIONS = {
  output: "htmlAndMathml",
  throwOnError: true,
  strict: "error",
  trust: false,
  maxExpand: 10,
  maxSize: 10,
} as const;

/** KaTeX source for a maths label. Numbers and text are escaped; nothing else is accepted. */
export function mathsToTex(nodes: readonly MathNode[]): string {
  return nodes.map(nodeTex).join(" ");
}

const TEX_OPS: Record<string, string> = {
  "+": "+",
  "-": "-",
  "−": "-",
  "×": "\\times",
  "÷": "\\div",
  "·": "\\cdot",
  "=": "=",
  "<": "<",
  ">": ">",
  "≈": "\\approx",
  "≠": "\\neq",
  "≤": "\\leq",
  "≥": "\\geq",
  "(": "(",
  ")": ")",
  ",": ",",
  "°": "^\\circ",
  "%": "\\%",
  "£": "\\pounds",
};

function leaf(value: unknown, pattern: RegExp, what: string): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`${what}: ${String(value)}`);
  }
  return value;
}

/** Nodes must be one of the shapes above; anything else (a model-written spec, M6) throws. */
function nodeTex(node: MathNode): string {
  if ("num" in node) {
    const num = leaf(node.num, /^-?\d+(\.\d+)?$/, "Not a number");
    return num.startsWith("-") ? `-${num.slice(1)}` : num;
  }
  if ("sym" in node) {
    return leaf(node.sym, /^[a-zA-Z]$/, "Not a single letter");
  }
  if ("text" in node) {
    const words = leaf(node.text, /^[a-zA-Z0-9 .]*$/, "Unsupported characters in maths text");
    return `\\text{${words}}`;
  }
  if ("op" in node) {
    const op = leaf(node.op, /^.{1,2}$/u, "Unknown operator");
    if (!Object.hasOwn(TEX_OPS, op)) {
      throw new Error(`Unknown operator: ${op}`);
    }
    return TEX_OPS[op] as string;
  }
  if ("frac" in node && Array.isArray(node.frac) && node.frac.length === 2) {
    return `\\dfrac{${mathsToTex(node.frac[0])}}{${mathsToTex(node.frac[1])}}`;
  }
  if ("pow" in node && Array.isArray(node.pow) && node.pow.length === 2) {
    // \small sets the exponent at 90% of the label, not KaTeX's usual 70%, so it stays above the
    // minimum text size on the narrowest phone while still reading as an exponent.
    return `{${mathsToTex(node.pow[0])}}^{\\small ${mathsToTex(node.pow[1])}}`;
  }
  if ("sqrt" in node && Array.isArray(node.sqrt)) {
    return `\\sqrt{${mathsToTex(node.sqrt)}}`;
  }
  throw new Error("Not a maths node");
}

/** Plain words for a maths label, for the scene golden check ("negative 4" for -4). */
export function mathsToWords(nodes: readonly MathNode[]): string {
  return nodes
    .map((node): string => {
      if ("num" in node) return node.num.replace("-", "negative ");
      if ("sym" in node) return node.sym;
      if ("text" in node) return node.text;
      if ("op" in node) return node.op;
      if ("frac" in node) return `${mathsToWords(node.frac[0])} over ${mathsToWords(node.frac[1])}`;
      if ("pow" in node)
        return `${mathsToWords(node.pow[0])} to the power ${mathsToWords(node.pow[1])}`;
      return `the square root of ${mathsToWords(node.sqrt)}`;
    })
    .join(" ");
}
