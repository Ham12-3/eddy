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
            Service token verified for <code>{data.subject}</code>.
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
    <div className="status-row">
      <dt>{label}</dt>
      <dd>
        <span className={ok ? "marker marker-ok" : "marker marker-problem"} aria-hidden="true" />
        <span data-testid={testId}>{status}</span>
        {detail ? <span className="status-detail">{detail}</span> : null}
      </dd>
    </div>
  );
}

async function SystemCheck() {
  const api = await checkApi();
  return (
    <section aria-labelledby="system-check" className="card">
      <h2 id="system-check">System check</h2>
      <dl>
        <StatusRow label="Web app" ok status="Running" testId="web-status" />
        <StatusRow
          label="API"
          ok={api.connected}
          status={api.connected ? "Connected" : "Not reachable"}
          detail={api.detail}
          testId="api-status"
        />
      </dl>
    </section>
  );
}

export default function HomePage() {
  return (
    <main className="page">
      <h1>Eddy</h1>
      <p className="lead">A GCSE Maths tutor that explains your mistakes with short animations.</p>
      <p>This is the foundations build. The learning experience arrives in later milestones.</p>
      {isSystemCheckEnabled() ? <SystemCheck /> : null}
    </main>
  );
}
