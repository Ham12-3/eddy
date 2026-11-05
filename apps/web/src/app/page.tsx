import { Card } from "@eddy/ui";
import type { ReactNode } from "react";
import { apiClientFor, ServiceTokenConfigError } from "@/lib/api";
import { isSystemCheckEnabled } from "@/lib/system-check";

// Render on every request: the system check must reflect the API as it is now.
export const dynamic = "force-dynamic";

type ApiStatus = { connected: boolean; detail: ReactNode };

async function checkApi(): Promise<ApiStatus> {
  try {
    const api = await apiClientFor({ subject: "system:hello-page", role: "system" });
    const { data, response } = await api.GET("/v1/hello", { signal: AbortSignal.timeout(3000) });
    if (data) {
      return {
        connected: true,
        detail: (
          <>
            Service token verified for{" "}
            <code className="font-mono text-caption whitespace-nowrap">{data.subject}</code>.
          </>
        ),
      };
    }
    return { connected: false, detail: `The API answered with status ${response.status}.` };
  } catch (error) {
    if (error instanceof ServiceTokenConfigError) {
      return {
        connected: false,
        detail: "Local service-token keys are missing or invalid. Run pnpm keys:dev.",
      };
    }
    return { connected: false, detail: "The API did not respond. Is pnpm dev:api running?" };
  }
}

function StatusRow({
  label,
  ok,
  status,
  detail,
  testId,
}: {
  label: string;
  ok: boolean;
  status: string;
  detail?: ReactNode;
  testId: string;
}) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-2 border-t border-rule py-3 first:border-t-0">
      <dt className="font-semibold">{label}</dt>
      <dd className="m-0">
        {/* Never colour alone: a filled disc for OK, a hollow ring for a problem, plus the words. */}
        <svg
          width={12}
          height={12}
          viewBox="0 0 12 12"
          aria-hidden="true"
          className="mr-2 inline-block align-baseline"
        >
          {ok ? (
            <circle cx={6} cy={6} r={5} className="fill-correct" />
          ) : (
            <circle
              cx={6}
              cy={6}
              r={4.5}
              fill="none"
              strokeWidth={2}
              className="stroke-misconception"
            />
          )}
        </svg>
        <span data-testid={testId}>{status}</span>
        {detail ? <span className="block text-ink-muted">{detail}</span> : null}
      </dd>
    </div>
  );
}

async function SystemCheck() {
  const api = await checkApi();
  return (
    <Card as="section" aria-labelledby="system-check" className="mt-8">
      <h2 id="system-check" className="m-0 mb-4 text-h4">
        System check
      </h2>
      <dl className="m-0">
        <StatusRow label="Web app" ok status="Running" testId="web-status" />
        <StatusRow
          label="API"
          ok={api.connected}
          status={api.connected ? "Connected" : "Not reachable"}
          detail={api.detail}
          testId="api-status"
        />
      </dl>
    </Card>
  );
}

export default function HomePage() {
  return (
    <main className="min-h-screen max-w-[68ch] px-4 py-8 md:ml-[10vw] md:border-l md:border-rule md:px-8 md:py-16">
      <h1 className="m-0 mb-4">Eddy</h1>
      <p className="m-0 mb-4 text-lead">
        A GCSE Maths tutor that explains your mistakes with short animations.
      </p>
      <p className="m-0">
        This is the foundations build. The learning experience arrives in later milestones.
      </p>
      {isSystemCheckEnabled() ? <SystemCheck /> : null}
    </main>
  );
}
