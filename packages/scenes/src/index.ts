/**
 * Scene canvas geometry shared by the layout engine (M5) and the keyframe checker.
 * SPEC.md section 8.3: 16:9 on desktop, 4:5 on mobile, 6% safe margins on every side.
 */

export const SCENE_ASPECT_RATIOS = {
  desktop: { width: 16, height: 9 },
  mobile: { width: 4, height: 5 },
} as const;

export type SceneFormat = keyof typeof SCENE_ASPECT_RATIOS;

export const SAFE_MARGIN_RATIO = 0.06;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The area inside the safe margins of a canvas, in the canvas's own units. */
export function safeArea(canvasWidth: number, canvasHeight: number): Rect {
  if (canvasWidth <= 0 || canvasHeight <= 0) {
    throw new Error("Canvas dimensions must be positive");
  }
  const marginX = canvasWidth * SAFE_MARGIN_RATIO;
  const marginY = canvasHeight * SAFE_MARGIN_RATIO;
  return {
    x: marginX,
    y: marginY,
    width: canvasWidth - 2 * marginX,
    height: canvasHeight - 2 * marginY,
  };
}
