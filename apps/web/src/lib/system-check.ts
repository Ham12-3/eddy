/**
 * The hello page's system check calls services/api and names internal settings, so it only runs
 * in development or when EDDY_SYSTEM_CHECK=1 (the E2E suite). Production visitors never trigger it.
 */
export function isSystemCheckEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== "production" || env.EDDY_SYSTEM_CHECK === "1";
}
