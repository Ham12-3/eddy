"use client";

import type { components } from "@eddy/api-client";
import { Button, linkClassName } from "@eddy/ui";
import NextLink from "next/link";
import { useState, useTransition } from "react";

import { answerParentLink, makeParentCode, type CodeState } from "./actions";

type Links = components["schemas"]["StudentLinksOut"];

const when = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  timeZone: "Europe/London",
});

/**
 * Parent access (SPEC.md section 4.4): make a code to share, and accept, decline or end links.
 * Nothing is shared until the student accepts, and they can end it at any time.
 */
export function ParentAccess({ links, joinUrl }: { links: Links; joinUrl: string }) {
  const [code, setCode] = useState<CodeState>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0">
        A parent or carer can see the topics you have secured, how long you spent and when reviews
        are due. Never your messages or answers.{" "}
        <NextLink href="/settings/parent-view" className={linkClassName}>
          See exactly what they would see
        </NextLink>
        .
      </p>
      {links.links.length ? (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {links.links.map((link) => (
            <li key={link.id} className="flex flex-col gap-2 rounded-card border border-rule p-4">
              <p className="m-0">
                {link.status === "ACTIVE"
                  ? `${link.parent_email ?? "A parent"} can see your progress.`
                  : `${link.parent_email ?? "Someone"} asked to see your progress on ${when.format(
                      new Date(link.requested_at),
                    )}.`}
              </p>
              <div className="flex flex-wrap gap-3">
                {link.status === "REQUESTED" ? (
                  <Button
                    variant="primary"
                    busy={pending}
                    onClick={() =>
                      startTransition(async () => setProblem(await answerParentLink(link.id, true)))
                    }
                  >
                    Accept
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  busy={pending}
                  onClick={() =>
                    startTransition(async () => setProblem(await answerParentLink(link.id, false)))
                  }
                >
                  {link.status === "ACTIVE" ? "Stop sharing" : "Decline"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {code.code ? (
        <div role="status" className="flex flex-col gap-2 rounded-card border border-rule p-4">
          <p className="m-0">
            Give your parent this code, or send them the link. It works once, for 7 days.
          </p>
          <p className="m-0 font-mono text-h3 tracking-wider">{code.code}</p>
          <p className="m-0 text-caption break-all">
            {joinUrl}?code={code.code}
          </p>
        </div>
      ) : null}
      {code.error || problem ? (
        <p role="alert" className="m-0 text-misconception">
          {code.error ?? problem}
        </p>
      ) : null}
      <div>
        <Button
          variant="secondary"
          busy={pending}
          onClick={() => startTransition(async () => setCode(await makeParentCode()))}
        >
          {links.code_expires_at || code.code ? "Make a new code" : "Make a code for a parent"}
        </Button>
      </div>
    </div>
  );
}
