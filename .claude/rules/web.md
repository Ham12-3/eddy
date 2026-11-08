---
paths:
  - "apps/web/**"
  - "packages/ui/**"
---

# Web and UI rules

- Next.js is the backend-for-frontend. The browser never calls a Python service. Server code reaches services/api only through `apiClientFor()` in `apps/web/src/lib/api.ts`, which signs a service token.
- Anything that reads server env or signs tokens imports `server-only`.
- UI copy: UK English, warm and direct, no emoji, no exclamation-mark enthusiasm, never an en or em dash.
- Banned (SPEC.md section 11 and the brief's design section): purple or blue-to-purple gradients, glassmorphism or backdrop blur, default shadcn styling, Inter as the only font, sparkle "AI" icons, "Unlock your potential", confetti, mascots, streaks or guilt copy, centred-everything layouts, text shadows, neon glows, pill buttons outside toggles.
- WCAG 2.2 AA: 4.5:1 body text, 3:1 large text and UI, 44 x 44 px targets, visible 2px focus ring, never colour alone.
- Every screen designs its empty, error and loading states.
- After any UI change: `pnpm e2e`, then look at the screenshots in `e2e-artifacts/screenshots/` before calling it done.
