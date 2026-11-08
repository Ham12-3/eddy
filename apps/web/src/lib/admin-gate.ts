import "server-only";

import { notFound } from "next/navigation";
import { isAdminPreviewEnabled } from "./admin-preview";

/** Call first in every admin page and generateMetadata: a layout's notFound() is not enough. */
export function requireAdminPreview(): void {
  if (!isAdminPreviewEnabled()) notFound();
}
