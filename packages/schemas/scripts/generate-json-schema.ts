// Writes the JSON Schemas in generated/ from src/. Run: pnpm schemas:generate (which then
// generates the pydantic models in services/api from these files).
//   generated/scene-spec.schema.json  SceneSpec (services/api eddy_api.scenes.spec)
//   generated/llm-io.schema.json      every other Claude output (services/api eddy_api.llm.io)
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { llmIoJsonSchema, sceneSpecJsonSchema } from "../src/json-schema";

mkdirSync(fileURLToPath(new URL("../generated/", import.meta.url)), { recursive: true });
for (const [name, schema] of [
  ["scene-spec", sceneSpecJsonSchema()],
  ["llm-io", llmIoJsonSchema()],
] as const) {
  const target = fileURLToPath(new URL(`../generated/${name}.schema.json`, import.meta.url));
  writeFileSync(target, `${JSON.stringify(schema, null, 2)}\n`, { encoding: "utf8" });
  console.log(`Wrote generated/${name}.schema.json`);
}
