/**
 * Scene canvas geometry shared by the layout engine, the renderer and the keyframe checker.
 * SPEC.md section 8.3: 16:9 on desktop, 4:5 on mobile, 6% safe margins on every side.
 *
 * Layout works in canvas units. The renderer scales the canvas to its container, so a size in
 * canvas units becomes `size * containerWidth / CANVAS[format].width` CSS pixels.
 */

export const SCENE_ASPECT_RATIOS = {
  desktop: { width: 16, height: 9 },
  mobile: { width: 4, height: 5 },
} as const;

export type SceneFormat = keyof typeof SCENE_ASPECT_RATIOS;
export const SCENE_FORMATS: readonly SceneFormat[] = ["desktop", "mobile"];

/** Canvas size in layout units for each format. */
export const CANVAS: Record<SceneFormat, { width: number; height: number }> = {
  desktop: { width: 1600, height: 900 },
  mobile: { width: 800, height: 1000 },
};

/**
 * The narrowest container each format is drawn in: a 320 px phone with 16 px gutters for 4:5,
 * and 640 px for 16:9 (narrower containers switch to 4:5). Font sizes are checked at these widths.
 */
export const MIN_STAGE_WIDTH: Record<SceneFormat, number> = { desktop: 640, mobile: 288 };

/**
 * How strongly highlight-role shapes are filled over the paper: a highlighter wash. Text on a
 * wash must still reach 4.5:1 against the blended colour (the static checks test it).
 */
export const HIGHLIGHT_WASH = 0.35;

/** How strongly a filled shape (a bar part, a square) tints the paper with its role colour. */
export const FILL_TINT = 0.16;

/** No scene text renders smaller than this many CSS pixels. */
export const MIN_TEXT_PX = 14;

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

/** The smallest size in canvas units that still renders at MIN_TEXT_PX in this format. */
export function minTextSize(format: SceneFormat): number {
  return (MIN_TEXT_PX * CANVAS[format].width) / MIN_STAGE_WIDTH[format];
}

/** A region of the safe area, given as fractions of it. */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function regionRect(format: SceneFormat, region: Region): Rect {
  const { width, height } = CANVAS[format];
  const safe = safeArea(width, height);
  return {
    x: safe.x + region.x * safe.width,
    y: safe.y + region.y * safe.height,
    width: region.w * safe.width,
    height: region.h * safe.height,
  };
}
