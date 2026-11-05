import "server-only";

import type { components } from "@eddy/api-client";
import { isAdminPreviewEnabled } from "./admin-preview";
import { apiClientFor } from "./api";

export type NodeSummary = components["schemas"]["NodeSummary"];
export type NodeDetail = components["schemas"]["NodeDetail"];
export type Topic = components["schemas"]["TopicOut"];
export type Misconception = components["schemas"]["MisconceptionOut"];

export type Result<T> = { ok: true; data: T } | { ok: false; reason: "missing" | "unavailable" };

const NODE_CODE = /^[NARGPS][1-9][0-9]?$/;
// No sign-in before M8: the preview signs as an admin with a non-user subject (ADR-0018).
// M8 replaces this with the signed-in admin's own id.
const CALLER = { subject: "preview:admin-curriculum", role: "admin" } as const;
const TIMEOUT_MS = 5000;

export const STRAND_TITLES: Record<NodeSummary["strand"], string> = {
  NUMBER: "Number",
  ALGEBRA: "Algebra",
  RATIO: "Ratio, proportion and rates of change",
  GEOMETRY: "Geometry and measures",
  PROBABILITY: "Probability",
  STATISTICS: "Statistics",
};

export const TIER_LABELS: Record<NodeSummary["tier"], string> = {
  FOUNDATION: "Foundation",
  HIGHER_ONLY: "Higher only",
};

export function isNodeCode(code: string): boolean {
  return NODE_CODE.test(code);
}

export async function fetchOverview(): Promise<Result<{ topics: Topic[]; nodes: NodeSummary[] }>> {
  if (!isAdminPreviewEnabled()) return { ok: false, reason: "missing" };
  try {
    const api = await apiClientFor(CALLER);
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    const [topics, nodes] = await Promise.all([
      api.GET("/v1/curriculum/topics", { signal }),
      api.GET("/v1/curriculum/nodes", { signal }),
    ]);
    if (!topics.data || !nodes.data) return { ok: false, reason: "unavailable" };
    return { ok: true, data: { topics: topics.data, nodes: nodes.data } };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function fetchNode(code: string): Promise<Result<NodeDetail>> {
  if (!isAdminPreviewEnabled() || !isNodeCode(code)) return { ok: false, reason: "missing" };
  try {
    const api = await apiClientFor(CALLER);
    const { data, response } = await api.GET("/v1/curriculum/nodes/{code}", {
      params: { path: { code } },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (data) return { ok: true, data };
    return { ok: false, reason: response.status === 404 ? "missing" : "unavailable" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
