/**
 * WCAG 2.2 contrast maths. M1 builds the full token-pair contrast test on top of this.
 * https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio
 */

const HEX_COLOUR = /^#([0-9a-f]{6})$/i;

function channelToLinear(channel: number): number {
  const srgb = channel / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of a `#rrggbb` colour, from 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const match = HEX_COLOUR.exec(hex);
  if (!match?.[1]) {
    throw new Error(`Expected a #rrggbb colour, got "${hex}"`);
  }
  const value = Number.parseInt(match[1], 16);
  const red = channelToLinear((value >> 16) & 0xff);
  const green = channelToLinear((value >> 8) & 0xff);
  const blue = channelToLinear(value & 0xff);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** Contrast ratio between two `#rrggbb` colours, from 1 to 21. Order does not matter. */
export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG 2.2 AA minimums: 4.5:1 for body text, 3:1 for large text and non-text UI. */
export const AA_BODY_TEXT = 4.5;
export const AA_LARGE_TEXT_AND_UI = 3;
