// Writes generated/scene-spec.schema.json from src/scene-spec.ts. Run: pnpm schemas:generate
// (which then generates the pydantic models in services/api from this file).
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sceneSpecJsonSchema } from "../src/json-schema";

const target = fileURLToPath(new URL("../generated/scene-spec.schema.json", import.meta.url));
mkdirSync(fileURLToPath(new URL("../generated/", import.meta.url)), { recursive: true });
writeFileSync(target, `${JSON.stringify(sceneSpecJsonSchema(), null, 2)}\n`, { encoding: "utf8" });
console.log("Wrote generated/scene-spec.schema.json");
