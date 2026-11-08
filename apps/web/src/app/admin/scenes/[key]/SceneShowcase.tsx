"use client";

import { buildScene, SceneDiagram, ScenePlayer, TEMPLATES_BY_KEY } from "@eddy/scenes";
import { ErrorState, Toggle } from "@eddy/ui";
import { useMemo, useState } from "react";

/** The gallery view of one scene, built in the browser from the template's worked example. */
export function SceneShowcase({ templateKey }: { templateKey: string }) {
  const [reduced, setReduced] = useState(false);
  const scene = useMemo(() => {
    const template = TEMPLATES_BY_KEY.get(templateKey);
    if (!template) return null;
    return buildScene(template, template.sample.item, template.sample.studentAnswer);
  }, [templateKey]);

  if (!scene) {
    return (
      <ErrorState title="Scene not found" headingLevel={2}>
        No template has this key.
      </ErrorState>
    );
  }
  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="player-heading" className="flex flex-col gap-4">
        <h2 id="player-heading" className="m-0 text-h3">
          Player
        </h2>
        <div className="max-w-[24rem]">
          <Toggle
            label="Reduce motion"
            description="Preview the stepped mode students get with reduced motion on."
            checked={reduced}
            onChange={setReduced}
          />
        </div>
        <ScenePlayer scene={scene} reducedMotion={reduced || undefined} />
      </section>
      <SceneDiagram scene={scene} headingLevel={2} />
      <details className="rounded-card border border-rule bg-paper-raised p-4">
        <summary className="min-h-11 cursor-pointer font-semibold">SceneSpec</summary>
        <pre className="m-0 mt-3 overflow-x-auto text-caption">
          {JSON.stringify(scene.spec, null, 2)}
        </pre>
      </details>
    </div>
  );
}
