import { describe, expect, it } from "vitest";
import { createApiClient } from "./index";

describe("createApiClient", () => {
  it("sends the service token and parses typed JSON", async () => {
    const seen: Request[] = [];
    const client = createApiClient({
      baseUrl: "http://api.test",
      token: "token-abc",
      fetch: async (request) => {
        seen.push(request);
        return Response.json({ message: "hi", subject: "user-1", role: "student" });
      },
    });

    const { data } = await client.GET("/v1/hello");

    expect(seen[0]?.url).toBe("http://api.test/v1/hello");
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer token-abc");
    expect(data).toEqual({ message: "hi", subject: "user-1", role: "student" });
  });
});
