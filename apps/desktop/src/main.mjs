// The Eddy desktop app (ADR-0036): one window, and every service on this computer.
//
// It starts the services (src/services.mjs), shows the web app they serve, and stops them when
// the window closes. The window is locked down: no Node in the page, no new windows, no
// navigation away from Eddy, no permissions, and no request to anywhere but this computer.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, dialog, Menu, session } from "electron";

import { startServices } from "./services.mjs";

// A preview build runs the API in its development environment. The tutor refuses to start in
// production until Eddy's safeguarding lead has approved the help script (routes/tutor.py), so a
// build for real students is made with this off, and stays locked until that approval.
const PREVIEW = true;

const here = path.dirname(fileURLToPath(import.meta.url));
// Tests and the build check point Eddy at a throwaway data folder, and ask for one picture of
// the window before it closes again.
const dataOverride = process.env.EDDY_DESKTOP_DATA;
const smokeShot = process.env.EDDY_DESKTOP_SMOKE;

app.setName("Eddy");
if (dataOverride) app.setPath("userData", dataOverride);

/** @type {import("./services.mjs").Running | undefined} */
let running;
/** @type {BrowserWindow | undefined} */
let window;
let quitting = false;

/** The paper colour from the design tokens, so the window does not flash white as it opens. */
function paperColour() {
  const tokens = path.join(here, "tokens.css");
  if (!existsSync(tokens)) return undefined;
  return /--paper:\s*(#[0-9a-f]{6})/i.exec(readFileSync(tokens, "utf8"))?.[1];
}

/** Only this computer: Eddy never asks the internet for anything. */
function isLocal(/** @type {string} */ url) {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol === "file:" || protocol === "data:" || protocol === "devtools:") return true;
    return (protocol === "http:" || protocol === "ws:") && hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function createWindow() {
  // Its own session, kept in memory: closing Eddy forgets the open profile, so the next person
  // starts at the profile picker.
  const eddy = session.fromPartition("eddy");
  eddy.setPermissionRequestHandler((_contents, _permission, allow) => allow(false));
  eddy.webRequest.onBeforeRequest((details, respond) => respond({ cancel: !isLocal(details.url) }));

  const paper = paperColour();
  const created = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 380,
    minHeight: 560,
    title: PREVIEW ? "Eddy (preview)" : "Eddy",
    ...(paper ? { backgroundColor: paper } : {}),
    autoHideMenuBar: true,
    webPreferences: {
      session: eddy,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
  });
  created.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  created.webContents.on("will-navigate", (event, url) => {
    if (!isLocal(url)) event.preventDefault();
  });
  // The page sets its own titles; the window keeps saying which build this is.
  created.on("page-title-updated", (event, title) => {
    event.preventDefault();
    created.setTitle(PREVIEW ? `${title} (preview)` : title);
  });
  return created;
}

async function start() {
  Menu.setApplicationMenu(null);
  window = createWindow();
  await window.loadFile(path.join(here, "starting.html"));
  const say = (/** @type {string} */ step) => {
    const script = `document.getElementById("step").textContent = ${JSON.stringify(step)};`;
    window?.webContents.executeJavaScript(script).catch(() => {});
  };

  running = await startServices({
    resources: app.isPackaged
      ? path.join(process.resourcesPath, "eddy")
      : path.join(here, "..", "resources"),
    dataDir: path.join(app.getPath("userData"), "data"),
    // Electron is also a Node: the web server and scene-check run in it, so no second copy of
    // Node is shipped.
    node: { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: "1" } },
    environment: PREVIEW ? "development" : "production",
    log: say,
  });
  // Straight to the profile picker: the window starts with no profile open. A page that sends
  // the window on elsewhere ends its own load early, which is not a failure.
  await window.loadURL(`${running.webUrl}/profiles`).catch((error) => {
    if (error?.code !== "ERR_ABORTED") throw error;
  });

  if (smokeShot) {
    // Give the page a moment to paint its fonts, take the picture, and close.
    await new Promise((resolve) => setTimeout(resolve, 2500));
    writeFileSync(smokeShot, (await window.webContents.capturePage()).toPNG());
    app.quit();
  }
}

if (!app.requestSingleInstanceLock()) {
  // A second copy would start a second database on the same files.
  app.quit();
} else {
  app.on("second-instance", () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.whenReady().then(() =>
    start().catch((error) => {
      console.error(error);
      // The build check has nobody to read a dialog: it fails with the reason on the console.
      if (smokeShot) app.exit(1);
      dialog.showErrorBox("Eddy could not start", String(error?.message ?? error));
      app.quit();
    }),
  );
}

app.on("window-all-closed", () => app.quit());
// Quitting waits for the services to stop: the database must close cleanly.
app.on("before-quit", (event) => {
  if (quitting || !running) return;
  event.preventDefault();
  quitting = true;
  running
    .stop()
    .catch(() => {})
    .finally(() => app.quit());
});
