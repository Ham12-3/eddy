/**
 * The scene-check worker (SPEC.md section 7.2, step 8; ADR-0027). It draws each beat's end state
 * in headless Chromium and confirms the DOM matches the layout. Since M6 it also serves the scene
 * engine's checks over HTTP to services/api (`serve.ts`, ADR-0030).
 */
export { compareText, INK_TOLERANCE_PX, POSITION_TOLERANCE_PX, type DomProblem } from "./compare";
export { keyframeHtml, type Theme } from "./html";
export {
  checkKeyframes,
  describeKeyframeProblem,
  STAGE_WIDTHS,
  THEMES,
  type Capture,
  type Keyframe,
  type KeyframeProblem,
} from "./keyframes";
