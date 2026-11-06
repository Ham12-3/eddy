import { TEMPLATES_BY_KEY } from "@eddy/scenes";
import { linkClassName } from "@eddy/ui";
import NextLink from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPreview } from "@/lib/admin-gate";
import { SceneShowcase } from "./SceneShowcase";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ key: string }> };

export async function generateMetadata({ params }: Params) {
  requireAdminPreview();
  const { key } = await params;
  const template = TEMPLATES_BY_KEY.get(key);
  return { title: template ? `${template.title} | Eddy admin` : "Eddy admin" };
}

export default async function ScenePage({ params }: Params) {
  requireAdminPreview();
  const { key } = await params;
  const template = TEMPLATES_BY_KEY.get(key);
  if (!template) notFound();
  return (
    <>
      <p className="m-0 mb-4">
        <NextLink href="/admin/scenes" className={linkClassName}>
          All scenes
        </NextLink>
      </p>
      <h1 className="m-0 mb-2 text-h2">{template.title}</h1>
      <p className="m-0 mb-8 text-ink-muted">
        <span className="font-mono">{template.misconception}</span> on{" "}
        <span className="font-mono">{template.node}</span>, from item template{" "}
        <span className="font-mono">{template.itemTemplate}</span>.
      </p>
      <SceneShowcase templateKey={template.key} />
    </>
  );
}
