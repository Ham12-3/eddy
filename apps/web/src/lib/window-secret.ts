/**
 * The desktop app's window secret (ADR-0036).
 *
 * The web server listens on 127.0.0.1, and a local port can be reached by every program and
 * every Windows account on the computer, not just by Eddy's window. A profile opens without a
 * password, so the server must know its own window. At each launch the shell makes a random
 * secret, gives it to this server (`EDDY_WINDOW_SECRET`) and puts it in its window's cookie jar.
 * Any request without it is refused before a page, an action or a route handler runs.
 *
 * Without the variable nothing is checked: that is development and the end-to-end tests, where
 * an ordinary browser is the window.
 */
import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

export const WINDOW_COOKIE = "eddy_window";
const MINIMUM_LENGTH = 32;

/** The secret this launch was given, or null when the shell is not in charge. */
export function windowSecret(
  source: Record<string, string | undefined> = process.env,
): string | null {
  const value = source.EDDY_WINDOW_SECRET ?? "";
  return value.length >= MINIMUM_LENGTH ? value : null;
}

/** Whether a cookie value is the secret, compared in constant time. */
export function isOwnWindow(presented: string | undefined, secret: string): boolean {
  if (!presented) return false;
  // Hashing first gives two values of one length, which the constant-time compare needs.
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(presented), digest(secret));
}
