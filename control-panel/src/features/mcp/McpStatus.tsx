import { Badge } from "@fluentui/react-components";
import type { ExternalServer, ManagedServer, McpStatus, Selection, Verdict } from "./mcp.types";

// Words for what a server IS, never more than is known. Machine state (can it
// run here), connection (what the last test said) and selection (may the
// resolver pick it) are three different lines, and each badge says one of them.
type Color = "success" | "danger" | "warning" | "informative" | "subtle" | "brand";

const STATE: Record<string, { label: string; color: Color }> = {
  ready: { label: "Ready", color: "success" },
  disabled: { label: "Disabled in Orbit", color: "subtle" },
  "not-installed": { label: "Not installed", color: "warning" },
  "needs-attention": { label: "Needs attention", color: "danger" },
  external: { label: "Observe only", color: "informative" },
  "not-added": { label: "Not added", color: "subtle" },
};

const CONNECTION: Record<McpStatus, string> = { connected: "Connected", failed: "Failed", "needs-auth": "Needs credentials", "pending-approval": "Pending approval in the host", unknown: "Not tested" };

export const SELECTION: Record<Selection, { label: string; hint: string }> = {
  automatic: { label: "Automatic", hint: "The resolver may select it when a task needs what it provides." },
  approval: { label: "Approval", hint: "The resolver names it, and a person approves each use here first." },
  disabled: { label: "Disabled", hint: "The resolver never selects it; it can still be called explicitly." },
};

export const VERDICT: Record<Verdict, string> = { allow: "Allow", approval: "Approval", deny: "Deny" };

export const RUNTIME: Record<ManagedServer["runtime"]["kind"], string> = { remote: "Remote HTTP", machine: "A command on this machine", managed: "Managed locally" };

export function StateBadge({ state }: { state: string }) {
  const fallback: { label: string; color: Color } = { label: state, color: "subtle" };
  const s = STATE[state] ?? fallback;
  return (
    <Badge appearance="tint" color={s.color}>
      {s.label}
    </Badge>
  );
}

export const connectionLine = (s: Pick<ManagedServer | ExternalServer, "status" | "lastStatus" | "reason" | "checkedAt">) => (s.status === "unknown" ? (s.lastStatus ? `Not tested recently — the last test (${CONNECTION[s.lastStatus]}) is out of date` : "Never tested") : `${CONNECTION[s.status]}${s.reason ? ` — ${s.reason}` : ""}`);

export const toolsLine = (s: { toolCount: number | null }) => (s.toolCount === null || s.toolCount === undefined ? "Tools: unknown" : `${s.toolCount} tool${s.toolCount === 1 ? "" : "s"}`);

export const originLine = (s: ManagedServer) => [s.origin === "catalog" ? "From Orbit's catalog" : "Custom", RUNTIME[s.runtime.kind], SELECTION[s.selection].label].join(" · ");
