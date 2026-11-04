/**
 * Service tokens: apps/web is the backend-for-frontend, and every call it makes to services/api
 * carries a 60-second ES256 JWT signed with web's private key (ADR-0008).
 */
import "server-only";

import { roleSchema, type Role } from "@eddy/schemas";
import { importPKCS8, SignJWT, type CryptoKey } from "jose";

export const SERVICE_TOKEN_ISSUER = "eddy-web";
export const SERVICE_TOKEN_AUDIENCE = "eddy-api";
export const SERVICE_TOKEN_TTL_SECONDS = 60;
const ALGORITHM = "ES256";

export interface ServiceTokenCaller {
  subject: string;
  role: Role;
}

/** The signing key or other service-token settings are missing or unusable. */
export class ServiceTokenConfigError extends Error {
  override name = "ServiceTokenConfigError";
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function signingKey(privateKeyB64: string): Promise<CryptoKey> {
  let key = keyCache.get(privateKeyB64);
  if (!key) {
    const pem = Buffer.from(privateKeyB64, "base64").toString("utf8");
    key = importPKCS8(pem, ALGORITHM).catch((error: unknown) => {
      keyCache.delete(privateKeyB64);
      throw new ServiceTokenConfigError(
        "SERVICE_TOKEN_PRIVATE_KEY_B64 is not a P-256 private key.",
        {
          cause: error,
        },
      );
    });
    keyCache.set(privateKeyB64, key);
  }
  return key;
}

export async function signServiceToken(
  privateKeyB64: string,
  caller: ServiceTokenCaller,
  now: Date = new Date(),
): Promise<string> {
  // Types are not enough at a trust boundary: check the caller at runtime too.
  const role = roleSchema.parse(caller.role);
  const subject = caller.subject.trim();
  if (!subject) throw new Error("A service token needs a non-empty subject.");

  const issuedAt = Math.floor(now.getTime() / 1000);
  return new SignJWT({ role })
    .setProtectedHeader({ alg: ALGORITHM, typ: "JWT" })
    .setIssuer(SERVICE_TOKEN_ISSUER)
    .setAudience(SERVICE_TOKEN_AUDIENCE)
    .setSubject(subject)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + SERVICE_TOKEN_TTL_SECONDS)
    .sign(await signingKey(privateKeyB64));
}
