import { generateKeyPairSync } from "node:crypto";
import { importSPKI, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import {
  SERVICE_TOKEN_AUDIENCE,
  SERVICE_TOKEN_ISSUER,
  SERVICE_TOKEN_TTL_SECONDS,
  ServiceTokenConfigError,
  signServiceToken,
  type ServiceTokenCaller,
} from "./service-token";

const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "P-256",
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const privateKeyB64 = Buffer.from(privateKey).toString("base64");

describe("signServiceToken", () => {
  it("signs a short-lived ES256 token that services/api can verify", async () => {
    const token = await signServiceToken(privateKeyB64, { subject: "user-42", role: "parent" });

    const { payload, protectedHeader } = await jwtVerify(
      token,
      await importSPKI(publicKey, "ES256"),
      {
        issuer: SERVICE_TOKEN_ISSUER,
        audience: SERVICE_TOKEN_AUDIENCE,
      },
    );

    expect(protectedHeader.alg).toBe("ES256");
    expect(payload.sub).toBe("user-42");
    expect(payload.role).toBe("parent");
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(SERVICE_TOKEN_TTL_SECONDS);
  });

  it("refuses a role or subject that fails runtime checks", async () => {
    const bogusRole = { subject: "x", role: "teacher" } as unknown as ServiceTokenCaller;
    await expect(signServiceToken(privateKeyB64, bogusRole)).rejects.toThrow();
    await expect(
      signServiceToken(privateKeyB64, { subject: " ", role: "student" }),
    ).rejects.toThrow(/subject/);
  });

  it("reports an unusable key as a configuration error", async () => {
    const notAKey = Buffer.from("not a key").toString("base64");
    await expect(
      signServiceToken(notAKey, { subject: "x", role: "student" }),
    ).rejects.toBeInstanceOf(ServiceTokenConfigError);
  });

  it("expires one minute after issue", async () => {
    const issued = new Date("2026-01-01T09:00:00Z");
    const token = await signServiceToken(privateKeyB64, { subject: "s", role: "system" }, issued);
    const key = await importSPKI(publicKey, "ES256");

    await expect(
      jwtVerify(token, key, { currentDate: new Date("2026-01-01T09:01:01Z") }),
    ).rejects.toThrow(/exp/);
  });
});
