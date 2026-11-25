import { hkdfSync } from "node:crypto";

import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { signProfile, verifyProfile } from "./local-profile";

const ID = "3f0e4c0a-7b1d-4a55-9a43-0d3f6a8f2b11";
const SECRET = "a-test-secret-that-is-long-enough-to-sign-with";

/** A token signed with a key of our choosing, to test what the cookie refuses. */
function forge(
  key: Uint8Array,
  audience: string,
  subject: string | undefined,
  expires: string | undefined,
): Promise<string> {
  let token = new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setAudience(audience);
  if (subject !== undefined) token = token.setSubject(subject);
  if (expires !== undefined) token = token.setIssuedAt().setExpirationTime(expires);
  return token.sign(key);
}

describe("the open profile's cookie", () => {
  const before = process.env.AUTH_SECRET;
  beforeEach(() => {
    process.env.AUTH_SECRET = SECRET;
  });
  afterEach(() => {
    process.env.AUTH_SECRET = before;
  });

  it("round-trips the profile id", async () => {
    expect(await verifyProfile(await signProfile(ID))).toBe(ID);
  });

  it("is nothing when missing, garbled or tampered with", async () => {
    const token = await signProfile(ID);
    expect(await verifyProfile(undefined)).toBeNull();
    expect(await verifyProfile("")).toBeNull();
    expect(await verifyProfile("not-a-token")).toBeNull();
    expect(await verifyProfile(`${token.slice(0, -2)}xx`)).toBeNull();
  });

  it("stops working after twelve hours", async () => {
    const opened = new Date("2026-11-25T08:00:00Z");
    const token = await signProfile(ID, opened);
    expect(await verifyProfile(token, new Date("2026-11-25T19:59:00Z"))).toBe(ID);
    expect(await verifyProfile(token, new Date("2026-11-25T20:01:00Z"))).toBeNull();
  });

  it("refuses a token signed with another secret", async () => {
    const token = await signProfile(ID);
    process.env.AUTH_SECRET = "a-different-secret-of-a-reasonable-length";
    expect(await verifyProfile(token)).toBeNull();
  });

  it("has its own key: a token signed with the shared secret itself opens nothing", async () => {
    // The sign-up steps' cookie and Auth.js sign with AUTH_SECRET directly.
    const shared = new TextEncoder().encode(SECRET);
    expect(await verifyProfile(await forge(shared, "eddy-profile", ID, "1h"))).toBeNull();
    expect(await verifyProfile(await forge(shared, "eddy-join", ID, "1h"))).toBeNull();
  });

  it("refuses a well-signed token for another purpose, with no profile or with no expiry", async () => {
    const own = new Uint8Array(hkdfSync("sha256", SECRET, "", "eddy-profile-cookie", 32));
    // The same key and claims as a real cookie do work, so the refusals below are for the reason given.
    expect(await verifyProfile(await forge(own, "eddy-profile", ID, "1h"))).toBe(ID);
    expect(await verifyProfile(await forge(own, "eddy-join", ID, "1h"))).toBeNull();
    expect(await verifyProfile(await forge(own, "eddy-profile", "system:local", "1h"))).toBeNull();
    expect(await verifyProfile(await forge(own, "eddy-profile", undefined, "1h"))).toBeNull();
    expect(await verifyProfile(await forge(own, "eddy-profile", ID, undefined))).toBeNull();
  });

  it("will not sign or accept anything with a short or missing secret", async () => {
    const token = await signProfile(ID);
    for (const weak of ["", "a-long-random-secret"]) {
      process.env.AUTH_SECRET = weak;
      await expect(signProfile(ID)).rejects.toThrow("32 characters");
      expect(await verifyProfile(token)).toBeNull();
    }
  });
});
