"use client";

import type { SceneSpec } from "@eddy/schemas";
import {
  ScenePlayer,
  sceneFromSpec,
  TEMPLATES_BY_KEY,
  usePrefersReducedMotion,
} from "@eddy/scenes";
import { ErrorState } from "@eddy/ui";
import { useMemo } from "react";

/** A scene the tutor served (Tier D or a reviewed Tier L variant), on our own renderer. */
export function LessonScene({
  spec,
  reduceMotion,
  captionsOnly,
}: {
  spec: unknown;
  reduceMotion: boolean;
  captionsOnly: boolean;
}) {
  const prefersReduced = usePrefersReducedMotion();
  const scene = useMemo(() => {
    try {
      const value = spec as SceneSpec;
      const key = String(value.template).split("@")[0] ?? "";
      const template = TEMPLATES_BY_KEY.get(key);
      return template ? sceneFromSpec(template, value) : null;
    } catch {
      return null;
    }
  }, [spec]);
  if (!scene) {
    return (
      <ErrorState title="This explanation could not be shown" headingLevel={3}>
        <p className="m-0">Carry on, and ask Eddy for a hint if you need one.</p>
      </ErrorState>
    );
  }
  return (
    <ScenePlayer
      scene={scene}
      reducedMotion={reduceMotion || prefersReduced}
      {...(captionsOnly ? { voice: null } : {})}
    />
  );
}
