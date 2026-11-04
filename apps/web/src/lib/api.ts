import "server-only";

import { createApiClient, type ApiClient } from "@eddy/api-client";
import { readServerEnv, type ServerEnv } from "./env";
import {
  ServiceTokenConfigError,
  signServiceToken,
  type ServiceTokenCaller,
} from "./service-token";

export { ServiceTokenConfigError } from "./service-token";

/** A typed services/api client that calls on behalf of `caller`. Server components and actions only. */
export async function apiClientFor(caller: ServiceTokenCaller): Promise<ApiClient> {
  let env: ServerEnv;
  try {
    env = readServerEnv();
  } catch (error) {
    throw new ServiceTokenConfigError("Service-token settings are missing or invalid.", {
      cause: error,
    });
  }
  const token = await signServiceToken(env.SERVICE_TOKEN_PRIVATE_KEY_B64, caller);
  return createApiClient({ baseUrl: env.API_BASE_URL, token });
}
