/**
 * Everything about scenes that runs without React: templates, layouts, timings and checks. The
 * end-to-end tests and the scene-check worker import this ("@eddy/scenes/registry").
 */
export * from "./canvas";
export { bounds, contains, overlaps } from "./layout/geometry";
export type * from "./layout/types";
export * from "./timeline/timeline";
export * from "./templates/template";
export * from "./templates/tier-l";
export { REFOCUS_KINDS } from "./templates/shared";
export { TEMPLATES, TEMPLATES_BY_KEY } from "./templates/registry";
export {
  CHECKS,
  checkScene,
  describeProblem,
  MAX_MOVING,
  type CheckName,
  type CheckProblem,
} from "./checks/static-checks";
