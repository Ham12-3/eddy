/**
 * Typed client for services/api. `schema.d.ts` is generated from the API's OpenAPI document:
 * run `pnpm api-client:generate` after changing any route (CI fails if it is out of date).
 * Server-side only: the token is a short-lived service token signed by apps/web (ADR-0008).
 */
import createClient from "openapi-fetch";
import type { paths } from "./schema";

export type { components, paths } from "./schema";

export interface ApiClientOptions {
  baseUrl: string;
  token: string;
  fetch?: (request: Request) => Promise<Response>;
}

export function createApiClient({ baseUrl, token, fetch }: ApiClientOptions) {
  return createClient<paths>({
    baseUrl,
    headers: { Authorization: `Bearer ${token}` },
    ...(fetch ? { fetch } : {}),
  });
}

export type ApiClient = ReturnType<typeof createApiClient>;
