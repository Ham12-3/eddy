// Starts one of the desktop app's JavaScript services under plain Node and ends it when its
// parent goes (ADR-0036). The parent holds this process's input open and never writes to it:
// when the parent exits, or is killed, the input closes and so does the service. In the shell
// itself the services run in Electron's helper processes, which end with it by themselves.
//
//   node node-child.mjs <script>
import { pathToFileURL } from "node:url";

const script = process.argv[2];
if (!script) {
  console.error("node-child: no script was named");
  process.exit(2);
}
process.stdin.on("end", () => process.exit(0));
process.stdin.on("close", () => process.exit(0));
process.stdin.on("error", () => process.exit(0));
process.stdin.resume();

// As if the script had been started directly: its own path, then its arguments.
process.argv.splice(1, 1);
await import(pathToFileURL(script).href);
