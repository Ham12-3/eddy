/**
 * "Paper and Ink" design tokens: the single source of truth (SPEC.md section 11, ADR-0019).
 * `src/styles/tokens.css` is generated from this file by `pnpm --filter @eddy/ui tokens:generate`,
 * and a test fails if the two drift. Raw colour values may appear only in this file.
 */

export const MODES = ["light", "dark"] as const;
export type Mode = (typeof MODES)[number];

export const COLOUR_TOKENS = [
  "paper",
  "paper-raised",
  "rule",
  "field-border",
  "ink",
  "ink-muted",
  "accent",
  "on-accent",
  "focus",
  "correct",
  "misconception",
  "student",
  "highlight",
] as const;
export type ColourToken = (typeof COLOUR_TOKENS)[number];

/** What each colour is for. Scene colour roles (student, misconception, correct) never change meaning. */
export const COLOUR_PURPOSE: Record<ColourToken, string> = {
  paper: "Page background",
  "paper-raised": "Cards, sheets and inputs",
  rule: "Decorative hairlines and exercise-book rules only (not a control edge)",
  "field-border": "Edges of inputs and controls (3:1 against paper)",
  ink: "Body text and given information",
  "ink-muted": "Secondary text",
  accent: "Marker orange: the single main action per screen, as a fill only, never as text",
  "on-accent": "Text on an accent fill",
  focus: "Focus ring",
  correct: "The corrected idea",
  misconception: "The faulty step only",
  student: "The student's own working",
  highlight: "Highlighter behind ink text only",
};

export const colours: Record<Mode, Record<ColourToken, string>> = {
  light: {
    paper: "#F6F3EA",
    "paper-raised": "#FFFDF7",
    rule: "#D9D3C3",
    "field-border": "#8A8473",
    ink: "#14213D",
    "ink-muted": "#4A5468",
    accent: "#F08C4A",
    "on-accent": "#14213D",
    focus: "#1C7ED6",
    correct: "#2B7A4B",
    misconception: "#B83A24",
    student: "#2563A8",
    highlight: "#F5C542",
  },
  dark: {
    paper: "#111418",
    "paper-raised": "#1A1E24",
    rule: "#2C323B",
    "field-border": "#6B7380",
    ink: "#ECE7DA",
    "ink-muted": "#A7AEBB",
    accent: "#FFA552",
    "on-accent": "#111418",
    focus: "#5AA9FF",
    correct: "#5BC18A",
    misconception: "#FF7A66",
    student: "#7FB2F0",
    highlight: "#6B5410",
  },
};

/** Dyslexia mode on a light theme swaps paper for cream. Dark mode keeps its own paper. */
export const dyslexiaLightPaper: Pick<Record<ColourToken, string>, "paper" | "paper-raised"> = {
  paper: "#FBF4E2",
  "paper-raised": "#FFFAEE",
};

export const fonts = {
  display: `"Fraunces Variable", Georgia, serif`,
  body: `"Atkinson Hyperlegible Next Variable", "Atkinson Hyperlegible", system-ui, sans-serif`,
  annotation: `"Caveat Variable", cursive`,
  dyslexic: `"OpenDyslexic", "Atkinson Hyperlegible Next Variable", system-ui, sans-serif`,
  mono: `ui-monospace, "Cascadia Code", Consolas, monospace`,
} as const;

/** Type scale in rem on a 17px root, ratio 1.25. h1 and h2 shrink fluidly on small screens. */
export const typeScale = {
  caption: "0.8rem",
  body: "1rem",
  lead: "1.25rem",
  h4: "1.5625rem",
  h3: "1.953rem",
  h2: "clamp(1.85rem, 1.45rem + 1.8vw, 2.441rem)",
  h1: "clamp(2.2rem, 1.6rem + 2.8vw, 3.052rem)",
} as const;

export const lineHeights = { body: "1.6", display: "1.15" } as const;

/** Dyslexia mode spacing (brief section 6). */
export const dyslexiaReading = {
  letterSpacing: "0.05em",
  wordSpacing: "0.12em",
  lineHeight: "1.8",
} as const;

/** 4px base. Tailwind's spacing unit is set to 4px, so p-1 is 4px and p-24 is 96px. */
export const SPACING_STEPS_PX = [4, 8, 12, 16, 24, 32, 48, 64, 96] as const;

export const radii = { control: "2px", card: "6px", sheet: "12px" } as const;

/** The only shadow in the system; elevation otherwise comes from rules and paper tone. */
export const shadowRaised =
  "0 1px 0 rgba(20, 33, 61, 0.08), 0 8px 24px -12px rgba(20, 33, 61, 0.18)";

export const motion = {
  micro: "120ms",
  standard: "200ms",
  panel: "320ms",
  easeStandard: "cubic-bezier(0.2, 0, 0, 1)",
  easeExit: "cubic-bezier(0.3, 0, 0.8, 0.15)",
  reducedCrossFade: "150ms",
} as const;
