// Writes src/styles/tokens.css from src/tokens/tokens.ts. Run: pnpm --filter @eddy/ui tokens:generate
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderTokensCss } from "../src/tokens/render-css";

const target = fileURLToPath(new URL("../src/styles/tokens.css", import.meta.url));
writeFileSync(target, renderTokensCss(), { encoding: "utf8" });
console.log("Wrote src/styles/tokens.css");
