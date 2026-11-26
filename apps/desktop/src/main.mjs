// The Eddy desktop app (ADR-0036): one window, and every service on this computer.
//
// It starts the services (src/services.mjs), shows the web app they serve, and stops them when
// the window closes. The window is locked down: no Node in the page, no new windows, no
// navigation away from Eddy, no permissions, and no request to anywhere but Eddy's own server.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, dialog, Menu, safeStorage, session, utilityProcess } from "electron";

import { startServices, StoppedError, WINDOW_COOKIE } from "./services.mjs";
import { isAllowedUrl, isOwnDownload, shellFileUrls } from "./window-policy.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Whether this is a preview build, from `eddy.preview` in package.json. A preview runs the API
 * in its development environment. The tutor refuses to start in production until Eddy's
 * safeguarding lead has approved the help script (routes/tutor.py), so a build for real students
 * is made without the flag, and stays locked until that approval. Anything but an explicit
 * `true` is not a preview: a build can only be unlocked on purpose.
 */
function isPreview() {
  try {
    const manifest = JSON.parse(readFileSync(path.join(app.getAppPath(), "package.json"), "utf8"));
    return manifest?.eddy?.preview === true;
  } catch {
    return false;
  }
}
const PREVIEW = isPreview();

// The build check and the tests point Eddy at a throwaway data folder, and ask for one picture
// of the window before it closes again. An installed copy ignores both.
const dataOverride = app.isPackaged ? undefined : process.env.EDDY_DESKTOP_DATA;
const smokeShot = app.isPackaged ? undefined : process.env.EDDY_DESKTOP_SMOKE;

app.setName("Eddy");
// The local app-data folder, not the roaming one: a roaming profile or folder redirection would
// copy the database to a server, and the notice says it stays on this computer.
const localAppData = process.env.LOCALAPPDATA;
if (dataOverride) app.setPath("userData", dataOverride);
else if (localAppData) app.setPath("userData", path.join(localAppData, "Eddy"));

/** @type {BrowserWindow | undefined} */
let window;
let quitting = false;
/** Eddy's own server, once it has started. */
let webOrigin = "";
/** The way to stop the services, from the moment there is anything to stop. */
let stopServices = async () => {};
/** Starting up, settled once it has finished, failed or been stopped. */
let starting = Promise.resolve();
/** How long quitting waits for a start in flight to notice and tidy up after itself. */
const START_SETTLE_MS = 20_000;

const shellFiles = shellFileUrls(here);

/** Only Eddy's own server and its own starting page: nothing else is ever asked for. */
function allowed(/** @type {string} */ url) {
  return isAllowedUrl(url, { webOrigin, shellFiles, devtools: !app.isPackaged });
}

/** The paper colour from the design tokens, so the window does not flash white as it opens. */
function paperColour() {
  const tokens = path.join(here, "tokens.css");
  if (!existsSync(tokens)) return undefined;
  return /--paper:\s*(#[0-9a-f]{6})/i.exec(readFileSync(tokens, "utf8"))?.[1];
}

async function createWindow() {
  // Its own session, kept in memory: closing Eddy forgets the open profile, so the next person
  // starts at the profile picker.
  const eddy = session.fromPartition("eddy");
  eddy.setPermissionRequestHandler((_contents, _permission, allow) => allow(false));
  eddy.setPermissionCheckHandler(() => false);
  eddy.setDevicePermissionHandler(() => false);
  // No proxy and no proxy discovery: that would be a request to the network.
  await eddy.setProxy({ mode: "direct" });
  eddy.webRequest.onBeforeRequest((details, respond) => respond({ cancel: !allowed(details.url) }));
  // The one thing Eddy saves to a file is a copy of a profile's data (Settings). Any other
  // download is refused. The dialog says what is being saved: by default its title is the
  // address the file came from. Where it goes is always the person's own choice.
  eddy.on("will-download", (event, item) => {
    if (!isOwnDownload(item.getURL(), webOrigin)) {
      event.preventDefault();
      return;
    }
    item.setSaveDialogOptions({
      title: "Save a copy of your data",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
  });

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
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  created.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  created.webContents.on("will-navigate", (event, url) => {
    if (!allowed(url)) event.preventDefault();
  });
  // The page sets its own titles; the window keeps saying which build this is.
  created.on("page-title-updated", (event, title) => {
    event.preventDefault();
    created.setTitle(PREVIEW ? `${title} (preview)` : title);
  });
  return { created, eddy };
}

/** Says what went wrong and closes. The build check has nobody to read a dialog. */
function fail(/** @type {unknown} */ error) {
  // Closed while it was starting: that is what was asked for, not something to report.
  if (error instanceof StoppedError || quitting) return;
  const message = error instanceof Error ? error.message : String(error);
  console.error(error);
  if (smokeShot) {
    quitting = true;
    stopServices().finally(() => app.exit(1));
    return;
  }
  dialog.showErrorBox("Eddy could not carry on", message);
  app.quit();
}

async function start() {
  Menu.setApplicationMenu(null);
  const { created, eddy } = await createWindow();
  window = created;
  await created.loadFile(path.join(here, "starting.html"));
  const say = (/** @type {string} */ step) => {
    const script = `document.getElementById("step").textContent = ${JSON.stringify(step)};`;
    created.webContents.executeJavaScript(script).catch(() => {});
  };

  const running = await startServices({
    resources: app.isPackaged
      ? path.join(process.resourcesPath, "eddy")
      : path.join(here, "..", "resources"),
    dataDir: path.join(app.getPath("userData"), "data"),
    // The web server and scene-check run in Electron's own helper processes: no second copy of
    // Node is shipped, the program need not be able to run as a bare Node, and they end with
    // the shell however it ends.
    runNode: (script, { env, cwd }) =>
      /** @type {import("./services.mjs").NodeChild} */ (
        /** @type {unknown} */ (utilityProcess.fork(script, [], { env, cwd, stdio: "pipe" }))
      ),
    environment: PREVIEW ? "development" : "production",
    // The saved database passwords are sealed with the Windows account's own key, so a copy of
    // the data folder does not open on another computer or for another account.
    codec: (await safeStorage.isAsyncEncryptionAvailable())
      ? {
          seal: async (text) => (await safeStorage.encryptStringAsync(text)).toString("base64"),
          open: async (sealed) =>
            (await safeStorage.decryptStringAsync(Buffer.from(sealed, "base64"))).result,
        }
      : undefined,
    log: say,
    onStoppable: (stop) => {
      stopServices = stop;
    },
    onFailure: (name, reason) => fail(new Error(`A part of Eddy stopped (${name}): ${reason}`)),
  });
  webOrigin = new URL(running.webUrl).origin;
  // The web server answers only requests that carry this launch's secret. It is put in this
  // window's cookie jar and nowhere else, so no other program on the computer can ask.
  await eddy.cookies.set({
    url: running.webUrl,
    name: WINDOW_COOKIE,
    value: running.secrets.windowSecret,
    httpOnly: true,
    sameSite: "strict",
  });
  // Straight to the profile picker: the window starts with no profile open. A page that sends
  // the window on elsewhere ends its own load early, which is not a failure.
  await created.loadURL(`${running.webUrl}/profiles`).catch((error) => {
    if (error?.code !== "ERR_ABORTED") throw error;
  });

  if (smokeShot) {
    // Give the page a moment to paint its fonts, take the picture, and close.
    await new Promise((resolve) => setTimeout(resolve, 2500));
    writeFileSync(smokeShot, (await created.webContents.capturePage()).toPNG());
    app.quit();
  }
}

// An installed copy never opens a debugging port: it would hand the window, and the profile
// open in it, to any program on the computer.
const debugging = ["remote-debugging-port", "remote-debugging-pipe", "inspect", "inspect-brk"];
if (app.isPackaged && debugging.some((name) => app.commandLine.hasSwitch(name))) {
  app.exit(1);
} else if (!app.requestSingleInstanceLock()) {
  // A second copy would start a second database on the same files.
  app.quit();
} else {
  app.on("second-instance", () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.whenReady().then(() => {
    starting = start().catch(fail);
  });
}

// Not while quitting: the window is closed as part of quitting, and asking to quit again from
// there would let Electron end before the services have stopped.
app.on("window-all-closed", () => {
  if (!quitting) app.quit();
});
// Quitting waits for the services to stop: the database must close cleanly. That holds while
// Eddy is still starting too, when some of them are already running.
app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  // The window goes first: a page still open would ask a server that is being stopped.
  if (window && !window.isDestroyed()) window.destroy();
  // A start still in flight is waited for as well: a step that was already running when the
  // services were told to stop (the database being started, say) finishes and is then undone.
  const settled = new Promise((resolve) => setTimeout(resolve, START_SETTLE_MS));
  stopServices()
    .catch(() => {})
    .then(() => Promise.race([starting, settled]))
    .finally(() => app.exit(0));
});
