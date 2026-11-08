import { cointeriorAngles } from "./cointerior-angles";
import { compareDecimals } from "./compare-decimals";
import { compareNegatives } from "./compare-negatives";
import { findHypotenuse } from "./find-hypotenuse";
import { gradientTriangle } from "./gradient-triangle";
import { multiplyAlong } from "./multiply-along";
import { negativePower } from "./negative-power";
import { orderThenMiddle } from "./order-then-middle";
import { reversePercentage } from "./reverse-percentage";
import { shareInRatio } from "./share-in-ratio";
import type { SceneTemplate } from "./template";
import { translation } from "./translation";
import { triangleArea } from "./triangle-area";
import { twoStepEquation } from "./two-step-equation";

/**
 * The Tier D scenes: one per MVP topic, in the topic order of SPEC.md section 2.2, each for that
 * topic's most common misconception (PLAN.md M5). Keyed by "primitive.scene".
 */
export const TEMPLATES: readonly SceneTemplate[] = [
  compareNegatives as SceneTemplate, // 1 Negative numbers
  compareDecimals as SceneTemplate, // 2 Fractions and decimals
  negativePower as SceneTemplate, // 3 Standard form
  reversePercentage as SceneTemplate, // 4 Percentages
  shareInRatio as SceneTemplate, // 5 Ratio
  twoStepEquation as SceneTemplate, // 6 Linear equations
  gradientTriangle as SceneTemplate, // 7 y = mx + c
  cointeriorAngles as SceneTemplate, // 8 Angles and parallel lines
  translation as SceneTemplate, // 9 Transformations
  triangleArea as SceneTemplate, // 10 Area and perimeter
  findHypotenuse as SceneTemplate, // 11 Pythagoras
  multiplyAlong as SceneTemplate, // 12 Probability trees
  orderThenMiddle as SceneTemplate, // 13 Averages
];

export const TEMPLATES_BY_KEY: ReadonlyMap<string, SceneTemplate> = new Map(
  TEMPLATES.map((template) => [template.key, template]),
);
