import { describe, expect, it } from "vitest";

import { isLoopbackHost } from "./local-mode";
import { isOwnWindow, windowSecret } from "./window-secret";

const SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("the desktop window's secret", () => {
  it("is only in force when the shell has set a real one", () => {
    expect(windowSecret({ EDDY_WINDOW_SECRET: SECRET })).toBe(SECRET);
    // Development and the end-to-end tests: an ordinary browser is the window.
    expect(windowSecret({})).toBeNull();
    expect(windowSecret({ EDDY_WINDOW_SECRET: "" })).toBeNull();
    // Too short to be a secret: treated as not set, never as a weak one in force.
    expect(windowSecret({ EDDY_WINDOW_SECRET: "short" })).toBeNull();
  });

  it("accepts the window's cookie and nothing else", () => {
    expect(isOwnWindow(SECRET, SECRET)).toBe(true);
    for (const presented of [
      undefined,
      "",
      "x",
      SECRET.slice(0, -1),
      `${SECRET}0`,
      SECRET.toUpperCase(),
    ]) {
      expect(isOwnWindow(presented, SECRET), String(presented)).toBe(false);
    }
  });
});

describe("the Host a request names, when the server knows its own port", () => {
  it("must be this computer on that very port", () => {
    expect(isLoopbackHost("127.0.0.1:52001", "52001")).toBe(true);
    expect(isLoopbackHost("localhost:52001", "52001")).toBe(true);
    expect(isLoopbackHost("127.0.0.1:52002", "52001")).toBe(false);
    expect(isLoopbackHost("127.0.0.1", "52001")).toBe(false);
    expect(isLoopbackHost("attacker.example:52001", "52001")).toBe(false);
  });
});
