/**
 * Colour maths for the design system: WCAG 2.2 contrast and CIELAB distance.
 * https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio
 */

const HEX_COLOUR = /^#([0-9a-f]{6})$/i;

function channels(hex: string): [number, number, number] {
  const match = HEX_COLOUR.exec(hex);
  if (!match?.[1]) {
    throw new Error(`Expected a #rrggbb colour, got "${hex}"`);
  }
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function channelToLinear(channel: number): number {
  const srgb = channel / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of a `#rrggbb` colour, from 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const [red, green, blue] = channels(hex).map(channelToLinear) as [number, number, number];
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

function toLab(hex: string): [number, number, number] {
  const [r, g, b] = channels(hex).map(channelToLinear) as [number, number, number];
  // sRGB to XYZ (D65), then to CIELAB.
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** CIE76 colour difference: about 2 is just noticeable, 30 and above reads as clearly different. */
export function deltaE76(a: string, b: string): number {
  const [l1, a1, b1] = toLab(a);
  const [l2, a2, b2] = toLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** WCAG 2.2 AA minimums: 4.5:1 for body text, 3:1 for large text and non-text UI. */
export const AA_BODY_TEXT = 4.5;
export const AA_LARGE_TEXT_AND_UI = 3;
