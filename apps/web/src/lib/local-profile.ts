/**
 * The open profile in the desktop app (ADR-0036), kept in a signed, http-only cookie.
 *
 * It is a session cookie: closing Eddy returns everyone to the profile picker, which is what a
 * shared family computer needs. The token inside also expires, so a window left open overnight
 * asks again. services/api decides whether a profile may be opened (its PIN); this only
 * remembers that it said yes.
 */
import "server-only";

import { hkdfSync } from "node:crypto";

import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { z } from "zod";

import type { ServiceTokenCaller } from "./service-token";

const PROFILE_COOKIE = "eddy_profile";
const AUDIENCE = "eddy-profile";
const OPEN_HOURS = 12;

/** The only caller services/api accepts on its profile routes. */
export const LOCAL_CALLER: ServiceTokenCaller = { subject: "system:local", role: "system" };

const MINIMUM_SECRET_LENGTH = 32;

/**
 * The cookie's own key, derived from AUTH_SECRET so that nothing else signed with that secret
 * can pass as a profile cookie. The desktop shell makes a fresh random secret for each install;
 * a short or missing one is refused, as anyone could then forge a cookie for any profile.
 */
function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET ?? "";
  if (value.length < MINIMUM_SECRET_LENGTH) {
    throw new Error("AUTH_SECRET must be a random secret of 32 characters or more.");
  }
  return new Uint8Array(hkdfSync("sha256", value, "", "eddy-profile-cookie", 32));
}

export async function signProfile(id: string, now: Date = new Date()): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(AUDIENCE)
    .setSubject(id)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + OPEN_HOURS * 60 * 60)
    .sign(secret());
}

/** The profile id inside a cookie value, or null when it is missing, forged or expired. */
export async function verifyProfile(value: string | undefined, now?: Date): Promise<string | null> {
  if (!value) return null;
  try {
    const { payload } = await jwtVerify(value, secret(), {
      audience: AUDIENCE,
      algorithms: ["HS256"],
      requiredClaims: ["exp", "sub"],
      currentDate: now,
    });
    const id = z.uuid().safeParse(payload.sub);
    return id.success ? id.data : null;
  } catch {
    return null;
  }
}

export async function readProfile(): Promise<string | null> {
  return verifyProfile((await cookies()).get(PROFILE_COOKIE)?.value);
}

export async function writeProfile(id: string): Promise<void> {
  // The desktop app is served on this computer over plain http, so the cookie is not `secure`.
  (await cookies()).set(PROFILE_COOKIE, await signProfile(id), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
}

export async function clearProfile(): Promise<void> {
  (await cookies()).delete(PROFILE_COOKIE);
}
