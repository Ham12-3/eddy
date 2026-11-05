/**
 * The admin pages have no sign-in until M8, so they only exist under `next dev` or when
 * EDDY_ADMIN_PREVIEW=1 (the E2E suite). Anything else, including a production build or an
 * unexpected NODE_ENV, answers them with 404.
 *
 * The gate is checked three times: in `src/proxy.ts` before anything renders, at the top of
 * every admin page and `generateMetadata` (a layout's notFound() does not stop its pages
 * rendering), and in `lib/curriculum.ts` before a service token is signed.
 */
export function isAdminPreviewEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "development" || env.EDDY_ADMIN_PREVIEW === "1";
}
