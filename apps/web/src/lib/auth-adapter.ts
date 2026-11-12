/**
 * The Auth.js adapter over services/api (ADR-0023, ADR-0032).
 *
 * The auth tables belong to Alembic and the API is their only writer, so every adapter call is
 * a request to `/v1/auth/*` with a service token whose subject is `system:auth`. Session tokens
 * are hashed (SHA-256) here, so a raw session token never leaves this process. An account is made
 * only from a pending sign-up: the API refuses `createUser` otherwise.
 */
import "server-only";

import { createHash } from "node:crypto";

import type { components } from "@eddy/api-client";
import type { Adapter, AdapterSession, AdapterUser, VerificationToken } from "next-auth/adapters";

import { apiClientFor } from "./api";

type ApiUser = components["schemas"]["AdapterUser"];
type ApiSession = components["schemas"]["SessionOut"];

export const AUTH_CALLER = { subject: "system:auth", role: "system" } as const;

/** The user Auth.js carries, with the role the web signs into service tokens. */
export interface EddyUser extends AdapterUser {
  role: string;
}

export function hashSessionToken(sessionToken: string): string {
  return createHash("sha256").update(sessionToken, "utf8").digest("hex");
}

function toUser(user: ApiUser): EddyUser {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.email_verified ? new Date(user.email_verified) : null,
    name: user.name ?? null,
    role: user.role,
  };
}

function toSession(session: ApiSession, sessionToken: string): AdapterSession {
  return { sessionToken, userId: session.user_id, expires: new Date(session.expires) };
}

class AuthApiError extends Error {
  override name = "AuthApiError";
}

function fail(action: string, response: Response): never {
  throw new AuthApiError(`${action} failed (${response.status})`);
}

async function api() {
  return apiClientFor(AUTH_CALLER);
}

export function eddyAdapter(): Adapter {
  return {
    async createUser(user) {
      const client = await api();
      const { data, response } = await client.POST("/v1/auth/users", {
        body: { email: user.email, email_verified: user.emailVerified?.toISOString() ?? null },
      });
      if (!data) fail("createUser", response);
      return toUser(data);
    },

    async getUser(id) {
      const client = await api();
      const { data, response } = await client.GET("/v1/auth/users/{user_id}", {
        params: { path: { user_id: id } },
      });
      if (!response.ok) fail("getUser", response);
      return data ? toUser(data) : null;
    },

    async getUserByEmail(email) {
      const client = await api();
      const { data, response } = await client.POST("/v1/auth/users/lookup", { body: { email } });
      if (!response.ok) fail("getUserByEmail", response);
      return data ? toUser(data) : null;
    },

    // Sign-in is by email link only: there are no OAuth accounts to find or link.
    async getUserByAccount() {
      return null;
    },

    async linkAccount() {
      return undefined;
    },

    async updateUser(user) {
      const client = await api();
      const { data, response } = await client.PATCH("/v1/auth/users/{user_id}", {
        params: { path: { user_id: user.id } },
        body: { email_verified: user.emailVerified?.toISOString() ?? null },
      });
      if (!data) fail("updateUser", response);
      return toUser(data);
    },

    async createSession(session) {
      const client = await api();
      const { data, response } = await client.POST("/v1/auth/sessions", {
        body: {
          session_token_hash: hashSessionToken(session.sessionToken),
          user_id: session.userId,
          expires: session.expires.toISOString(),
        },
      });
      if (!data) fail("createSession", response);
      return toSession(data, session.sessionToken);
    },

    async getSessionAndUser(sessionToken) {
      const client = await api();
      const { data, response } = await client.POST("/v1/auth/sessions/lookup", {
        body: { session_token_hash: hashSessionToken(sessionToken) },
      });
      if (!response.ok) fail("getSessionAndUser", response);
      if (!data) return null;
      return { session: toSession(data.session, sessionToken), user: toUser(data.user) };
    },

    async updateSession(session) {
      if (!session.expires) return null;
      const client = await api();
      const { data, response } = await client.PATCH("/v1/auth/sessions", {
        body: {
          session_token_hash: hashSessionToken(session.sessionToken),
          expires: session.expires.toISOString(),
        },
      });
      if (!response.ok) fail("updateSession", response);
      return data ? toSession(data, session.sessionToken) : null;
    },

    async deleteSession(sessionToken) {
      const client = await api();
      const { response } = await client.POST("/v1/auth/sessions/delete", {
        body: { session_token_hash: hashSessionToken(sessionToken) },
      });
      if (!response.ok) fail("deleteSession", response);
    },

    async createVerificationToken(token: VerificationToken) {
      const client = await api();
      const { data, response } = await client.POST("/v1/auth/verification-tokens", {
        body: {
          identifier: token.identifier,
          token: token.token,
          expires: token.expires.toISOString(),
        },
      });
      if (!data) fail("createVerificationToken", response);
      return { identifier: data.identifier, token: data.token, expires: new Date(data.expires) };
    },

    async useVerificationToken({ identifier, token }) {
      const client = await api();
      const { data, response } = await client.POST("/v1/auth/verification-tokens/use", {
        body: { identifier, token },
      });
      if (!response.ok) fail("useVerificationToken", response);
      if (!data) return null;
      return { identifier: data.identifier, token: data.token, expires: new Date(data.expires) };
    },
  };
}
