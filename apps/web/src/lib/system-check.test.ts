import { describe, expect, it } from "vitest";
import { isSystemCheckEnabled } from "./system-check";

describe("isSystemCheckEnabled", () => {
  it("runs in development and test", () => {
    expect(isSystemCheckEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(isSystemCheckEnabled({ NODE_ENV: "test" })).toBe(true);
  });

  it("is off in production unless explicitly enabled", () => {
    expect(isSystemCheckEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(isSystemCheckEnabled({ NODE_ENV: "production", EDDY_SYSTEM_CHECK: "1" })).toBe(true);
  });
});
