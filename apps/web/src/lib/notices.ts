import { isLocalMode } from "./local-mode";

/**
 * The privacy notice version a student acknowledges (SPEC.md section 4.1). Raise it whenever the
 * notice's meaning changes: everyone is then asked to read and acknowledge it again.
 *
 * 0.x marks a draft: the notices wait for legal review (SPEC.md section 16.2).
 */
export const PRIVACY_NOTICE_VERSION = "0.2.0";

/**
 * The desktop app's notice says something different (the data stays on the computer, nothing is
 * typed to the tutor and no AI is involved), so it has its own version (ADR-0036). Keep both in step with
 * services/api `routes/me.py`.
 */
export const LOCAL_PRIVACY_NOTICE_VERSION = "0.6.0";

/** The version shown and acknowledged in this mode. */
export function privacyNoticeVersion(local: boolean = isLocalMode()): "0.2.0" | "0.6.0" {
  return local ? LOCAL_PRIVACY_NOTICE_VERSION : PRIVACY_NOTICE_VERSION;
}
