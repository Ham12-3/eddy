import type { ReactElement } from "react";
import { SCENE_FORMATS } from "../canvas";
import type { BuiltScene } from "../templates/template";
import { endState } from "../timeline/timeline";
import { SceneCanvas } from "./SceneCanvas";
import { SceneErrorBoundary } from "./SceneErrorBoundary";

/**
 * The static annotated diagram (SPEC.md section 8.4): every beat's end state with its narration,
 * for print, slow devices and screen reader users. Nothing moves.
 */
export interface SceneDiagramProps {
  scene: BuiltScene;
  /** The heading level for the diagram's title. */
  headingLevel?: 2 | 3 | 4;
}

export function SceneDiagram(props: SceneDiagramProps): ReactElement {
  return (
    <SceneErrorBoundary narrations={props.scene.spec.beats.map((beat) => beat.narration)}>
      <Diagram {...props} />
    </SceneErrorBoundary>
  );
}

function Diagram({ scene, headingLevel = 3 }: SceneDiagramProps): ReactElement {
  const Heading = `h${headingLevel}` as const;
  const beats = scene.spec.beats;
  return (
    <section aria-label={`${scene.template.title}, step by step`} className="flex flex-col gap-4">
      <Heading className="m-0 text-body font-semibold">
        {scene.template.title}, step by step
      </Heading>
      <ol className="m-0 flex list-none flex-col gap-6 p-0">
        {beats.map((beat, index) => (
          <li key={index}>
            <figure className="m-0 flex flex-col gap-2">
              {/* The figcaption carries each step for screen readers; the canvas repeats earlier
                  steps, so it is hidden from them to avoid reading the same labels again and again. */}
              <div className="eddy-scene" aria-hidden="true">
                {SCENE_FORMATS.map((format) => (
                  <SceneCanvas
                    key={format}
                    layout={scene.layouts[format]}
                    drawn={endState(scene.layouts[format], index)}
                  />
                ))}
              </div>
              <figcaption className="text-body">
                <span className="font-semibold">
                  Step {index + 1} of {beats.length}:{" "}
                </span>
                {beat.narration}
              </figcaption>
            </figure>
          </li>
        ))}
      </ol>
    </section>
  );
}
