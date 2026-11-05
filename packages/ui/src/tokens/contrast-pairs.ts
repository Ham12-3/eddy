/**
 * Every foreground and background pairing the design system uses, with its WCAG 2.2 minimum.
 * Components may only put a colour on another colour if the pair is listed here; the contrast
 * test checks each one in light, dark and dyslexia (cream) modes.
 */
import { AA_BODY_TEXT, AA_LARGE_TEXT_AND_UI } from "../contrast";
import type { ColourToken } from "./tokens";

export interface ContrastPair {
  foreground: ColourToken;
  background: ColourToken;
  minimum: number;
  use: string;
}

const text = (foreground: ColourToken, background: ColourToken, use: string): ContrastPair => ({
  foreground,
  background,
  minimum: AA_BODY_TEXT,
  use,
});
const ui = (foreground: ColourToken, background: ColourToken, use: string): ContrastPair => ({
  foreground,
  background,
  minimum: AA_LARGE_TEXT_AND_UI,
  use,
});

const SURFACES = ["paper", "paper-raised"] as const;
const TEXT_COLOURS = ["ink", "ink-muted", "student", "correct", "misconception"] as const;

export const contrastPairs: ContrastPair[] = [
  ...SURFACES.flatMap((surface) =>
    TEXT_COLOURS.map((colour) => text(colour, surface, `${colour} text on ${surface}`)),
  ),
  text("ink", "highlight", "highlighted text (ink only)"),
  text("paper-raised", "ink", "primary button label"),
  text("on-accent", "accent", "main-action button label"),
  ...SURFACES.flatMap((surface) => [
    ui("focus", surface, `focus ring on ${surface}`),
    ui("field-border", surface, `input and control edges on ${surface}`),
    ui("correct", surface, `correct marks on ${surface}`),
    ui("misconception", surface, `misconception marks on ${surface}`),
  ]),
];

/** Tokens that never carry information on their own, so need no contrast pair. */
export const DECORATIVE_TOKENS: ColourToken[] = ["rule"];
