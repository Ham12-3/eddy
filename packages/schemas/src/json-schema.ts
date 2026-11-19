import { z } from "zod";
import { llmIoSchema } from "./llm-io";
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

/** Every other structured Claude output, as one document (services/api `eddy_api.llm.io`). */
export function llmIoJsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(llmIoSchema, { target: "draft-2020-12" });
  return { ...generated, $id: "urn:eddy:schema:llm-io:1", title: "LlmIo" };
}
