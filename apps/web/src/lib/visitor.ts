/**
 * Who is asking, for rate limits only: a keyed hash of the visitor's address, so services/api
 * can slow down invite guessing without ever seeing or storing an IP address.
 *
 * The address is the X-Forwarded-For entry added by the nearest proxy we trust, counted from
 * the right: entries further left are written by the client and can be forged. With no proxy in
 * front (locally), Next.js itself adds the last entry. TRUSTED_PROXY_HOPS is the number of
 * proxies in front of Next.js (an ALB and CloudFront would be 2).
 */
import "server-only";

import { createHmac } from "node:crypto";

import { headers } from "next/headers";

export async function visitorKey(): Promise<string> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set. Run `pnpm keys:dev`.");
  const hops = Math.max(0, Number(process.env.TRUSTED_PROXY_HOPS ?? "0") || 0);
  const list = await headers();
  const chain = (list.get("x-forwarded-for") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  // Never fall back to the left-most entry, which the client wrote.
  const address = chain[Math.max(0, chain.length - 1 - hops)] ?? "no-address";
  return createHmac("sha256", secret).update(address).digest("hex");
}
