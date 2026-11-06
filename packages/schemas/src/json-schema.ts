import { z } from "zod";
import { sceneSpecSchema } from "./scene-spec";

/** The SceneSpec JSON Schema, with a stable $id so services can refer to it. */
export function sceneSpecJsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(sceneSpecSchema, { target: "draft-2020-12" });
  return {
    ...generated,
    $id: "urn:eddy:schema:scene-spec:1",
    title: "SceneSpec",
  };
}
