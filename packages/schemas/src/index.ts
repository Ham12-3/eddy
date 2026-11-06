import { z } from "zod";

/**
 * Roles carried on users and in the service tokens that apps/web signs for services/api
 * (SPEC.md section 6.2, ADR-0008). Keep in step with `Role` in services/api/src/eddy_api/auth.py.
 */
export const roleSchema = z.enum(["student", "parent", "admin", "system"]);
export type Role = z.infer<typeof roleSchema>;

export * from "./scene-spec";
export { sceneSpecJsonSchema } from "./json-schema";
