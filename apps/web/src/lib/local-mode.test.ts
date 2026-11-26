import { describe, expect, it } from "vitest";

import { isLocalMode, isLoopbackHost, isPathOff, signInPath } from "./local-mode";
import { privacyNoticeVersion } from "./notices";

describe("isLocalMode", () => {
  it("reads the flag the way services/api does, so the two never disagree", () => {
    for (const value of ["1", "true", "TRUE", "yes", "on", " 1 "]) {
      expect(isLocalMode({ EDDY_LOCAL_MODE: value }), value).toBe(true);
    }
    for (const value of [undefined, "", "0", "false", "no", "off", "local"]) {
      expect(isLocalMode({ EDDY_LOCAL_MODE: value }), String(value)).toBe(false);
    }
  });
});

describe("isPathOff", () => {
  it("switches the online-only pages off in the desktop app", () => {
    for (const path of [
      "/sign-in",
      "/sign-in/problem",
      "/join",
      "/join/age",
      "/check-your-email",
      "/parent",
      "/parent/child/abc",
      "/parent/account/download",
      "/api/auth/callback/nodemailer",
      "/settings/parent-view",
    ]) {
      expect(isPathOff(path, true), path).toBe(true);
      expect(isPathOff(path, false), path).toBe(false);
    }
  });

  it("switches the profile pages off everywhere else", () => {
    for (const path of ["/profiles", "/profiles/new", "/profiles/stop"]) {
      expect(isPathOff(path, false), path).toBe(true);
      expect(isPathOff(path, true), path).toBe(false);
    }
  });

  it("leaves a student's own pages alone in both modes, and matches whole segments", () => {
    for (const path of [
      "/",
      "/home",
      "/settings",
      "/settings/my-data",
      "/privacy",
      "/joiners",
      "/parents-evening",
    ]) {
      expect(isPathOff(path, true), path).toBe(false);
      expect(isPathOff(path, false), path).toBe(false);
    }
  });
});

describe("isLoopbackHost", () => {
  it("accepts only this computer, with or without a port", () => {
    for (const host of [
      "localhost",
      "localhost:3300",
      "127.0.0.1:49152",
      "LOCALHOST:80",
      "[::1]:3300",
    ]) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
  });

  it("refuses any other name, however it is dressed up", () => {
    for (const host of [
      null,
      undefined,
      "",
      "attacker.example:3300",
      "localhost.attacker.example",
      "127.0.0.1.attacker.example:3300",
      "evil-localhost",
      "192.168.1.20:3300",
      "0.0.0.0:3300",
    ]) {
      expect(isLoopbackHost(host), String(host)).toBe(false);
    }
  });
});

describe("mode-dependent values", () => {
  it("sends someone with no session to the right front door", () => {
    expect(signInPath(true)).toBe("/profiles");
    expect(signInPath(false)).toBe("/sign-in");
  });

  it("asks for the notice that matches what Eddy does in this mode", () => {
    expect(privacyNoticeVersion(true)).toBe("0.4.0");
    expect(privacyNoticeVersion(false)).toBe("0.2.0");
  });
});
