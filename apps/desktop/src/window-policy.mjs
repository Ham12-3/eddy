// What the desktop app's window may ask for (ADR-0036): Eddy's own server, the page shown while
// it starts, and nothing else. This is the only thing between the window and the internet, so it
// is kept apart from Electron and tested by itself.
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The files of the page shown while the services start, as the window names them.
 * @param {string} dir the folder that holds them
 * @returns {Set<string>}
 */
export function shellFileUrls(dir) {
  return new Set(
    ["starting.html", "tokens.css"].map((file) =>
      pathToFileURL(path.join(dir, file)).href.toLowerCase(),
    ),
  );
}

/**
 * @param {string} url what the window wants to load or navigate to
 * @param {object} policy
 * @param {string} policy.webOrigin Eddy's own server, or "" before it has started
 * @param {Set<string>} policy.shellFiles from `shellFileUrls`
 * @param {boolean} policy.devtools whether developer tools may open (never in an installed copy)
 * @returns {boolean}
 */
export function isAllowedUrl(url, { webOrigin, shellFiles, devtools }) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "devtools:") return devtools;
    // Exactly the two files, never "any file": a file URL with a host is a request to another
    // computer on the network.
    if (parsed.protocol === "file:") return shellFiles.has(parsed.href.toLowerCase());
    // Exactly Eddy's server: scheme, host and port. Another port on this computer is another
    // program, and it would be sent the window's cookies.
    return webOrigin !== "" && parsed.protocol === "http:" && parsed.origin === webOrigin;
  } catch {
    return false;
  }
}

/** The one page that hands the window a file to save: a copy of the open profile's data. */
export const DOWNLOAD_PATH = "/settings/my-data/download";

/**
 * Whether a download is the one Eddy offers. Anything else is refused: a page that made a file
 * of its own (a `blob:` or `data:` address never passes the request filter) would otherwise be
 * saved through a dialog that vouches for it.
 * @param {string} url where the file comes from
 * @param {string} webOrigin Eddy's own server, or "" before it has started
 * @returns {boolean}
 */
export function isOwnDownload(url, webOrigin) {
  try {
    const parsed = new URL(url);
    return (
      webOrigin !== "" &&
      parsed.protocol === "http:" &&
      parsed.origin === webOrigin &&
      parsed.pathname === DOWNLOAD_PATH &&
      parsed.search === ""
    );
  } catch {
    return false;
  }
}
