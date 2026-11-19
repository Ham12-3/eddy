import type { NextConfig } from "next";

// A baseline Content Security Policy (ADR-0032): only our own origin, no plugins, no framing,
// forms post only here. Scripts and styles still allow inline code, which Next.js and the maths
// renderer need without nonces; the strict nonce policy is M10 hardening. `next dev` also needs
// eval for fast refresh.
const development = process.env.NODE_ENV === "development";
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Browsers ignore HSTS over plain HTTP, so this only takes effect once served over HTTPS.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // Workspace packages export TypeScript source; Next compiles them.
  transpilePackages: ["@eddy/api-client", "@eddy/scenes", "@eddy/schemas", "@eddy/ui"],
  // Import only the components a page uses from the @eddy/ui barrel, not all of them.
  experimental: { optimizePackageImports: ["@eddy/ui", "@eddy/scenes"] },
  poweredByHeader: false,
  // Stop `next dev` writing AGENTS.md; agent guidance lives in CLAUDE.md and .claude/rules/.
  agentRules: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
