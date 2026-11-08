/** Numbers as scenes write them: a true minus sign for negatives (U+2212), no trailing zeros. */
export const MINUS = "−";

export function formatNumber(value: number, options: { pounds?: boolean } = {}): string {
  const rounded = Math.round(value * 1e9) / 1e9;
  let digits = Math.abs(rounded).toString();
  if (options.pounds) {
    digits = Number.isInteger(rounded) ? digits : Math.abs(rounded).toFixed(2);
  }
  const sign = rounded < 0 ? MINUS : "";
  return `${sign}${options.pounds ? "£" : ""}${digits}`;
}

/** A number as a maths-label token: "-13" (mathsToTex writes a minus). */
export function mathNumber(value: number): { num: string } {
  return { num: (Math.round(value * 1e9) / 1e9).toString() };
}
