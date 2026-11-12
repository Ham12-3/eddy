import "server-only";

import { z } from "zod";

const serverEnvSchema = z.object({
  API_BASE_URL: z.url().default("http://127.0.0.1:8300"),
  SERVICE_TOKEN_PRIVATE_KEY_B64: z
    .string({ error: "SERVICE_TOKEN_PRIVATE_KEY_B64 is missing. Run `pnpm keys:dev`." })
    .min(1, "SERVICE_TOKEN_PRIVATE_KEY_B64 is empty. Run `pnpm keys:dev`."),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Server-only settings. Never import this from a client component. */
export function readServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  return serverEnvSchema.parse(source);
}

const mailEnvSchema = z.object({
  // Mailpit locally (compose.yaml); Amazon SES in production (ADR-0008).
  EMAIL_SERVER: z.string().min(1).default("smtp://127.0.0.1:1025"),
  EMAIL_FROM: z.string().min(3).default("Eddy <sign-in@eddy.localhost>"),
});

export type MailEnv = z.infer<typeof mailEnvSchema>;

/** Where sign-in emails are sent from. Server-only. */
export function readMailEnv(source: NodeJS.ProcessEnv = process.env): MailEnv {
  return mailEnvSchema.parse(source);
}
