/**
 * The sign-in email: short, plain, no images, no tracking. UK English, no dashes (SPEC.md 11).
 * Email clients cannot read our CSS, so its colours come straight from the light tokens.
 */
import { colours } from "@eddy/ui/colour";

export interface SignInEmail {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function signInEmail(url: string, minutes: number): SignInEmail {
  const subject = "Your Eddy sign-in link";
  const text = [
    "Here is your link to sign in to Eddy:",
    "",
    url,
    "",
    `It works once, within ${minutes} minutes.`,
    "If you did not ask for it, you can ignore this email. Nobody can sign in without the link.",
    "",
    "Eddy",
  ].join("\n");
  const link = escapeHtml(url);
  const c = colours.light;
  const body = `margin:0;padding:24px;background:${c.paper};color:${c.ink};font-family:Arial,Helvetica,sans-serif;font-size:17px;line-height:1.6`;
  const button = `display:inline-block;padding:12px 20px;background:${c.accent};color:${c["on-accent"]};text-decoration:none;border-radius:2px;font-weight:bold`;
  const html = `<!doctype html>
<html lang="en-GB">
  <body style="${body}">
    <p>Here is your link to sign in to Eddy.</p>
    <p><a href="${link}" style="${button}">Sign in to Eddy</a></p>
    <p>It works once, within ${minutes} minutes.</p>
    <p>If you did not ask for it, you can ignore this email. Nobody can sign in without the link.</p>
    <p style="color:${c["ink-muted"]};font-size:15px">If the button does not work, copy this address into your browser:<br>${link}</p>
  </body>
</html>`;
  return { subject, text, html };
}
