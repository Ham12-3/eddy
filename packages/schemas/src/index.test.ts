import { describe, expect, it } from "vitest";
import { roleSchema } from "./index";

describe("roleSchema", () => {
  it("accepts every MVP role", () => {
    for (const role of ["student", "parent", "admin", "system"]) {
      expect(roleSchema.parse(role)).toBe(role);
    }
  });

  it("rejects roles that are not in the MVP", () => {
    expect(roleSchema.safeParse("teacher").success).toBe(false);
  });
});
