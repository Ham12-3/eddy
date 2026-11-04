/**
 * The handful of "Paper and Ink" colours the M0 hello page uses (values from SPEC.md section 11).
 * M1 replaces this with the full token set and generated CSS variables.
 */
export const placeholderPalette = {
  light: {
    paper: "#F6F3EA",
    paperRaised: "#FFFDF7",
    rule: "#D9D3C3",
    ink: "#14213D",
    inkMuted: "#4A5468",
  },
  dark: {
    paper: "#111418",
    paperRaised: "#1A1E24",
    rule: "#2C323B",
    ink: "#ECE7DA",
    inkMuted: "#A7AEBB",
  },
} as const;

export type PaletteMode = keyof typeof placeholderPalette;
