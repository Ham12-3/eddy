// Geometry and formats
export * from "./canvas";

// Layout
export { bounds, contains, overlaps } from "./layout/geometry";
export { LINE_HEIGHT, measureMaths, measureText, mathsToTex, mathsToWords } from "./layout/measure";
export type * from "./layout/types";
export { ROLES } from "./layout/types";

// Timeline
export * from "./timeline/timeline";

// Templates
export * from "./templates/template";
export { TEMPLATES, TEMPLATES_BY_KEY } from "./templates/registry";
export * from "./templates/tier-l";

// Rendering
export { SceneCanvas, type SceneCanvasProps } from "./render/SceneCanvas";
export { SceneDiagram, type SceneDiagramProps } from "./render/SceneDiagram";
export { ScenePlayer, usePrefersReducedMotion, type ScenePlayerProps } from "./render/ScenePlayer";
export { pickVoice, useDeviceVoice, type NarrationVoice } from "./render/voice";
export {
  CHECKS,
  checkScene,
  describeProblem,
  type CheckName,
  type CheckProblem,
} from "./checks/static-checks";
