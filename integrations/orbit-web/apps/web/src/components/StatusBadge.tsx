import { Badge, Spinner } from "@fluentui/react-components";
import type { ConnectionState, SessionStatus } from "@orbit-web/contracts";

type Tone = "brand" | "danger" | "important" | "informative" | "severe" | "subtle" | "success" | "warning";

const SESSION: Record<SessionStatus, { label: string; tone: Tone }> = {
  preparing: { label: "Preparing", tone: "informative" },
  ready: { label: "Ready", tone: "subtle" },
  running: { label: "Running", tone: "brand" },
  completed: { label: "Completed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  interrupted: { label: "Interrupted", tone: "warning" },
  setup_failed: { label: "Setup failed", tone: "danger" },
};

export function SessionStatusBadge({ status }: { status: SessionStatus }) {
  const s = SESSION[status];
  return (
    <Badge appearance="tint" color={s.tone} icon={status === "running" || status === "preparing" ? <Spinner size="extra-tiny" /> : undefined}>
      {s.label}
    </Badge>
  );
}

const CONNECTION: Record<ConnectionState, { label: string; tone: Tone }> = {
  connected: { label: "Connected", tone: "success" },
  not_connected: { label: "Not connected", tone: "subtle" },
  expired: { label: "Expired", tone: "warning" },
  unavailable: { label: "Unavailable", tone: "danger" },
};

export function ConnectionBadge({ state }: { state: ConnectionState }) {
  const c = CONNECTION[state];
  return (
    <Badge appearance="tint" color={c.tone}>
      {c.label}
    </Badge>
  );
}
