import { TEMPLATES } from "@eddy/scenes";
import { Card, linkClassName } from "@eddy/ui";
import NextLink from "next/link";
import { requireAdminPreview } from "@/lib/admin-gate";

// Rendered per request, so the admin gate runs every time, not once at build.
export const dynamic = "force-dynamic";
export const metadata = { title: "Scenes | Eddy admin" };

export default function ScenesPage() {
  requireAdminPreview();
  return (
    <>
      <h1 className="m-0 mb-2 text-h2">Scenes</h1>
      <p className="m-0 mb-8 max-w-[44rem] text-ink-muted">
        The default explanation for each topic&apos;s most common misconception, built from a worked
        example with no model call. Open one to play it, step through it and see the static diagram.
      </p>
      <ol className="m-0 grid list-none gap-4 p-0 md:grid-cols-2">
        {TEMPLATES.map((template) => (
          <li key={template.key}>
            <Card as="article" className="h-full p-4">
              <h2 className="m-0 text-h4">
                <NextLink href={`/admin/scenes/${template.key}`} className={linkClassName}>
                  {template.title}
                </NextLink>
              </h2>
              <dl className="m-0 mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-caption">
                <dt className="text-ink-muted">Misconception</dt>
                <dd className="m-0 font-mono">{template.misconception}</dd>
                <dt className="text-ink-muted">Node</dt>
                <dd className="m-0 font-mono">{template.node}</dd>
                <dt className="text-ink-muted">Template</dt>
                <dd className="m-0 font-mono">
                  {template.key}@{template.version}
                </dd>
              </dl>
            </Card>
          </li>
        ))}
      </ol>
    </>
  );
}
