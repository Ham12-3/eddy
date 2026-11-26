/**
 * The desktop app (ADR-0036): Eddy on one computer, with no internet, no email and no accounts.
 * Students pick a profile instead of signing in. The desktop shell sets `EDDY_LOCAL_MODE=1` for
 * the web server it starts; it is off everywhere else.
 */

/** The same spellings services/api accepts for the flag, so the two never disagree. */
const ON = new Set(["1", "true", "yes", "on"]);

export function isLocalMode(source: Record<string, string | undefined> = process.env): boolean {
  return ON.has((source.EDDY_LOCAL_MODE ?? "").trim().toLowerCase());
}

/**
 * Pages that only make sense online: email sign-in, invites, a parent's own account and what a
 * linked parent sees.
 */
const ONLINE_ONLY = [
  "/sign-in",
  "/join",
  "/check-your-email",
  "/parent",
  "/api/auth",
  "/settings/parent-view",
];
/** Pages that only exist in the desktop app. */
const LOCAL_ONLY = ["/profiles"];

function under(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => path === root || path.startsWith(`${root}/`));
}

/** Whether a path is switched off in this mode. */
export function isPathOff(path: string, local: boolean): boolean {
  return local ? under(path, ONLINE_ONLY) : under(path, LOCAL_ONLY);
}

/** Where someone with no session is sent. */
export function signInPath(local: boolean = isLocalMode()): "/profiles" | "/sign-in" {
  return local ? "/profiles" : "/sign-in";
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Whether a request's Host header names this computer. The desktop app answers nothing else: a
 * web page that points its own domain name at 127.0.0.1 (DNS rebinding) would otherwise be the
 * same origin as Eddy and could open a profile.
 */
export function isLoopbackHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const name = host.trim().toLowerCase().replace(/:\d+$/, "");
  return LOOPBACK.has(name);
}
