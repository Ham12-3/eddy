// Runs the desktop app's services without its window, until this process is stopped.
//
//   node src/run-services.mjs <data folder>
//
// It prints one line of JSON once everything answers: the ports and where the web app is. The
// whole-app test uses it to play the part of the shell, so that it can end that shell abruptly
// and see that nothing it started is left running.
import { resourcesDir } from "../scripts/paths.mjs";
import { startServices } from "./services.mjs";

const dataDir = process.argv[2];
if (!dataDir) {
  console.error("run-services: name a data folder");
  process.exit(2);
}

const running = await startServices({
  resources: resourcesDir,
  dataDir,
  environment: "development",
  onFailure: (name, reason) => {
    console.error(`${name} stopped: ${reason}`);
    process.exit(1);
  },
});
console.log(JSON.stringify({ webUrl: running.webUrl, ports: running.ports }));

// Closed in the ordinary way: stop everything, as the shell does when its window closes.
for (const signal of /** @type {const} */ (["SIGINT", "SIGTERM"])) {
  process.on(signal, () => {
    running.stop().finally(() => process.exit(0));
  });
}
