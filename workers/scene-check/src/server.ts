// pnpm --filter @eddy/scene-check serve: the scene engine's checks over HTTP for services/api
// (ADR-0030). Reads SCENE_CHECK_SERVICE_TOKEN (required), SCENE_CHECK_HOST and SCENE_CHECK_PORT,
// from the environment or workers/scene-check/.env (`pnpm keys:dev`).
import { createServer } from "node:http";
import { createHandler } from "./serve";

const token = process.env.SCENE_CHECK_SERVICE_TOKEN ?? "";
const host = process.env.SCENE_CHECK_HOST ?? "127.0.0.1";
const port = Number(process.env.SCENE_CHECK_PORT ?? 8320);

let handler: ReturnType<typeof createHandler>;
try {
  handler = createHandler({ token });
} catch (error) {
  console.error(
    `scene-check: ${(error as Error).message}. Run pnpm keys:dev or set SCENE_CHECK_SERVICE_TOKEN.`,
  );
  process.exit(1);
}

createServer((request, response) => void handler(request, response)).listen(port, host, () => {
  console.log(`scene-check serving on http://${host}:${port}`);
});
