// What the window may ask for, and what the services inherit from the computer: the two small
// rules that keep the desktop app to itself. They need no build, so they run everywhere.
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { databaseUrl } from "./postgres.mjs";
import { baseEnv } from "./services.mjs";
import { isAllowedUrl, shellFileUrls } from "./window-policy.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const shellFiles = shellFileUrls(here);
const webOrigin = "http://127.0.0.1:52001";
const policy = { webOrigin, shellFiles, devtools: false };

describe("what the window may ask for", () => {
  it("is Eddy's own server and the starting page", () => {
    for (const url of [
      `${webOrigin}/profiles`,
      `${webOrigin}/_next/static/chunks/app.js`,
      pathToFileURL(path.join(here, "starting.html")).href,
      pathToFileURL(path.join(here, "tokens.css")).href,
    ]) {
      assert.equal(isAllowedUrl(url, policy), true, url);
    }
  });

  it("is nothing else: not the internet, not another program here, not another file", () => {
    for (const url of [
      "https://example.com/",
      "http://example.com/",
      "http://127.0.0.1:52002/profiles", // another program on this computer
      "http://localhost:52001/profiles", // the same port by another name: other cookies
      "https://127.0.0.1:52001/",
      "ws://127.0.0.1:52001/",
      "http://127.0.0.1.attacker.example:52001/",
      "http://attacker.example@127.0.0.1:52002/",
      "file://fileserver/share/starting.html", // a file on another computer
      pathToFileURL(path.join(here, "main.mjs")).href,
      "file:///C:/Windows/win.ini",
      "data:text/html,<p>hello</p>",
      "javascript:alert(1)",
      "devtools://devtools/bundled/inspector.html",
      "not a url",
      "",
    ]) {
      assert.equal(isAllowedUrl(url, policy), false, url);
    }
  });

  it("is only the starting page until the server has started", () => {
    const early = { ...policy, webOrigin: "" };
    assert.equal(isAllowedUrl(`${webOrigin}/profiles`, early), false);
    assert.equal(isAllowedUrl(pathToFileURL(path.join(here, "starting.html")).href, early), true);
  });

  it("lets developer tools open only where the shell says so", () => {
    const url = "devtools://devtools/bundled/inspector.html";
    assert.equal(isAllowedUrl(url, { ...policy, devtools: true }), true);
    assert.equal(isAllowedUrl(url, policy), false);
  });
});

describe("what a service inherits from the computer", () => {
  it("is a short list, and never a key, a database address or a way to change how Node runs", () => {
    const env = baseEnv({
      SystemRoot: "C:\\Windows",
      PATH: "C:\\Windows\\System32",
      LOCALAPPDATA: "C:\\Users\\sam\\AppData\\Local",
      ANTHROPIC_API_KEY: "sk-nope",
      DATABASE_URL: "postgresql://elsewhere",
      NODE_OPTIONS: "--inspect",
      NODE_EXTRA_CA_CERTS: "C:\\certs.pem",
      ELECTRON_RUN_AS_NODE: "1",
      EDDY_ENVIRONMENT: "development",
      HTTPS_PROXY: "http://proxy.example:8080",
    });
    assert.deepEqual(env, {
      SystemRoot: "C:\\Windows",
      PATH: "C:\\Windows\\System32",
      LOCALAPPDATA: "C:\\Users\\sam\\AppData\\Local",
    });
  });
});

describe("the database address", () => {
  it("is always this computer, with the password safe inside the address", () => {
    const url = databaseUrl({
      user: "eddy",
      password: "p@ss/word:1",
      port: 5555,
      database: "eddy",
    });
    assert.equal(url, "postgresql+psycopg://eddy:p%40ss%2Fword%3A1@127.0.0.1:5555/eddy");
  });
});
