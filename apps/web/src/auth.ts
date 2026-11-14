/**
 * Sign-in (ADR-0008, ADR-0032): Auth.js email links with database sessions held by services/api.
 *
 * A link is sent only to an active account or a pending sign-up (made after the invite code and
 * the age check). The pages that ask for an address always say the same thing, so nobody can use
 * them to find out whether an address has an account.
 */
import "server-only";

import NextAuth, { type DefaultSession } from "next-auth";
import Nodemailer from "next-auth/providers/nodemailer";
import { createTransport } from "nodemailer";

import { apiClientFor } from "./lib/api";
import { AUTH_CALLER, eddyAdapter, type EddyUser } from "./lib/auth-adapter";
import { readMailEnv } from "./lib/env";
import { signInEmail } from "./lib/sign-in-email";

/** How long a sign-in link works. */
export const LINK_MINUTES = 30;

declare module "next-auth" {
  interface Session {
    user: { id: string; role: string } & DefaultSession["user"];
  }
}

/** Whether a link may go to this address. `sending` counts it against the per-address limit. */
export async function maySignIn(email: string, sending = false): Promise<boolean> {
  const client = await apiClientFor(AUTH_CALLER);
  const { data } = await client.POST("/v1/auth/may-sign-in", { body: { email, sending } });
  return data?.allowed === true;
}

export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  const mail = readMailEnv();
  return {
    adapter: eddyAdapter(),
    // A week without use signs a student out: many use shared school devices.
    session: { strategy: "database", maxAge: 7 * 24 * 60 * 60, updateAge: 24 * 60 * 60 },
    pages: {
      signIn: "/sign-in",
      verifyRequest: "/check-your-email",
      error: "/sign-in/problem",
    },
    providers: [
      Nodemailer({
        server: mail.EMAIL_SERVER,
        from: mail.EMAIL_FROM,
        maxAge: LINK_MINUTES * 60,
        async sendVerificationRequest({ identifier, url, provider }) {
          const message = signInEmail(url, LINK_MINUTES);
          const transport = createTransport(provider.server);
          await transport.sendMail({
            to: identifier,
            from: provider.from,
            subject: message.subject,
            text: message.text,
            html: message.html,
          });
        },
      }),
    ],
    callbacks: {
      async signIn({ user, email }) {
        // Before a link is sent: only to an account or a pending sign-up. The sign-in pages
        // check first too, and show the same page whatever the answer.
        if (email?.verificationRequest) {
          // Not allowed: the same "check your email" page, and nothing is sent, so even a raw
          // POST to Auth.js cannot tell whether an address has an account.
          const allowed = typeof user.email === "string" && (await maySignIn(user.email, true));
          return allowed ? true : "/check-your-email";
        }
        return true;
      },
      session({ session, user }) {
        const eddy = user as EddyUser;
        session.user.id = eddy.id;
        session.user.role = eddy.role;
        return session;
      },
    },
  };
});
