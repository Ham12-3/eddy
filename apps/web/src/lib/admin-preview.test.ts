import { describe, expect, it } from "vitest";
import { isAdminPreviewEnabled } from "./admin-preview";

const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;

describe("isAdminPreviewEnabled", () => {
  it("is on under next dev", () => {
    expect(isAdminPreviewEnabled(env({ NODE_ENV: "development" }))).toBe(true);
  });

  it("is off in production and for any other NODE_ENV", () => {
    expect(isAdminPreviewEnabled(env({ NODE_ENV: "production" }))).toBe(false);
    expect(isAdminPreviewEnabled(env({ NODE_ENV: "test" }))).toBe(false);
    expect(isAdminPreviewEnabled(env({}))).toBe(false);
  });

  it("is on in production only with EDDY_ADMIN_PREVIEW=1", () => {
    expect(isAdminPreviewEnabled(env({ NODE_ENV: "production", EDDY_ADMIN_PREVIEW: "1" }))).toBe(
      true,
    );
    expect(isAdminPreviewEnabled(env({ NODE_ENV: "production", EDDY_ADMIN_PREVIEW: "true" }))).toBe(
      false,
    );
  });
});
