/**
 * The sign-up steps (ADR-0032): invite code, then the age check, then the email address.
 *
 * Until the address is given, nothing is stored on our side: the invite and the birth month and
 * year ride in a signed, http-only cookie that lasts 30 minutes. Someone under 13 gets only a
 * short-lived cookie that stops an immediate retry (SPEC.md section 4.1), and nothing else.
 */
import "server-only";

import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { z } from "zod";

const JOIN_COOKIE = "eddy_join";
const STOP_COOKIE = "eddy_age_stop";
const JOIN_MINUTES = 30;
const STOP_HOURS = 24;
export const MINIMUM_AGE = 13;

const joinSchema = z.object({
  invite: z.string().min(1).max(64),
  birthYear: z.number().int().optional(),
  birthMonth: z.number().int().min(1).max(12).optional(),
});

export type JoinState = z.infer<typeof joinSchema>;

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not set. Run `pnpm keys:dev`.");
  return new TextEncoder().encode(value);
}

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production" && !process.env.AUTH_URL?.startsWith("http:"),
  path: "/",
} as const;

export async function readJoin(): Promise<JoinState | null> {
  const value = (await cookies()).get(JOIN_COOKIE)?.value;
  if (!value) return null;
  try {
    const { payload } = await jwtVerify(value, secret(), { audience: "eddy-join" });
    const parsed = joinSchema.safeParse(payload.join);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function writeJoin(state: JoinState): Promise<void> {
  const token = await new SignJWT({ join: state })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("eddy-join")
    .setIssuedAt()
    .setExpirationTime(`${JOIN_MINUTES}m`)
    .sign(secret());
  (await cookies()).set(JOIN_COOKIE, token, { ...cookieOptions, maxAge: JOIN_MINUTES * 60 });
}

export async function clearJoin(): Promise<void> {
  (await cookies()).delete(JOIN_COOKIE);
}

export async function stoppedByAge(): Promise<boolean> {
  return (await cookies()).get(STOP_COOKIE)?.value === "1";
}

export async function stopForAge(): Promise<void> {
  const jar = await cookies();
  jar.delete(JOIN_COOKIE);
  jar.set(STOP_COOKIE, "1", { ...cookieOptions, maxAge: STOP_HOURS * 60 * 60 });
}

/**
 * Whole years, counting the birth month itself as not yet reached: with no day of birth, someone
 * is treated as 13 only from the month after they turn 13. Matches services/api `age_on`.
 */
export function ageOn(today: Date, birthYear: number, birthMonth: number): number {
  // UTC, as services/api counts it, so the two never disagree around midnight.
  let age = today.getUTCFullYear() - birthYear;
  if (today.getUTCMonth() + 1 <= birthMonth) age -= 1;
  return age;
}
