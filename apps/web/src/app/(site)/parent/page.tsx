import { buttonClassName, Card, EmptyState, ErrorState } from "@eddy/ui";
import type { Metadata } from "next";
import NextLink from "next/link";

import { Page } from "@/components/Page";
import { requireParent } from "@/lib/session";

import { AddChildForm } from "./ParentForms";

export const metadata: Metadata = { title: "Your children" };

export default async function ParentHome() {
  const { api } = await requireParent();
  const { data } = await api.GET("/v1/parent/children");
  if (!data) {
    return (
      <Page title="Your children">
        <ErrorState title="This page could not be loaded" headingLevel={2}>
          <p className="m-0">Try again in a moment.</p>
        </ErrorState>
      </Page>
    );
  }
  return (
    <Page title="Your children">
      <div className="flex flex-col gap-6">
        {data.length === 0 ? (
          <EmptyState title="No linked children" headingLevel={2}>
            <p className="m-0">
              Ask your child for a code from their Eddy settings, then enter it below.
            </p>
          </EmptyState>
        ) : (
          data.map((child) => (
            <Card
              key={child.link_id}
              as="section"
              aria-label={child.student_email ?? "Waiting for your child"}
              className="flex flex-col gap-3"
            >
              {child.status === "ACTIVE" ? (
                <>
                  <h2 className="m-0 text-h3">{child.student_email}</h2>
                  <div>
                    <NextLink
                      href={`/parent/child/${child.link_id}`}
                      className={buttonClassName("accent")}
                    >
                      See progress
                    </NextLink>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="m-0 text-h3">Waiting for your child</h2>
                  <p className="m-0">
                    They will see your request in their settings. Nothing is shared until they
                    accept.
                  </p>
                </>
              )}
            </Card>
          ))
        )}
        <Card as="section" aria-labelledby="add" className="flex flex-col gap-3">
          <h2 id="add" className="m-0 text-h3">
            Add a child
          </h2>
          <AddChildForm />
        </Card>
      </div>
    </Page>
  );
}
