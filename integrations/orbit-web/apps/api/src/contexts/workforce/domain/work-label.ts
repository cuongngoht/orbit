// What a card in the office says about an employee, worked out from the axes the domain keeps apart: employment, the
// sandbox, the connection, the assignment the employee holds (its reservation) and the state of that assignment's live
// run. A label is always shown as WORDS; a connection problem while work is held is a warning beside the label, never
// instead of it.
import type { AssignmentState, Availability, Employment, RunState, SandboxState, WorkLabel } from "@orbit-web/contracts";

export interface LabelFacts {
  employment: Employment;
  expired: boolean;
  sandbox: SandboxState | null;
  sandboxReason: string | null;
  connectionUsable: boolean;
  connectionReason: string | null;
  held: { state: AssignmentState; waitingOn: string | null } | null;
  liveRun: RunState | null;
}

export interface Label {
  label: WorkLabel;
  availability: Availability;
  notReadyReason: string | null;
  connectionWarning: string | null;
}

const HELD_LABEL: Record<string, WorkLabel> = {
  ASSIGNED: "working",
  RUNNING: "working",
  DELEGATING: "waiting_team",
  WAITING_FOR_SUBORDINATES: "waiting_team",
  BLOCKED: "waiting_info",
  PAUSED: "paused",
  RECOVERING: "reconciling",
  REVIEWING: "waiting_review",
  AWAITING_ACCEPTANCE: "waiting_review",
  CANCELLING: "cancelling",
};

function notReady(f: LabelFacts): string | null {
  if (f.employment === "candidate") return "Hired, but not started: begin the trial or activate.";
  if (f.employment === "suspended") return "Suspended.";
  if (f.employment === "archived") return "Archived.";
  if (f.expired) return "Their engagement as an assistant ended.";
  if (f.sandbox === null || f.sandbox === "PROVISIONING") return "Their Personal Sandbox is being prepared.";
  if (f.sandbox === "FAILED") return `Their Personal Sandbox could not be prepared: ${f.sandboxReason ?? "no reason given"}.`;
  if (f.sandbox === "ARCHIVED") return "Their Personal Sandbox is archived.";
  if (!f.connectionUsable) return f.connectionReason ?? "Their AI connection cannot run work now.";
  return null;
}

export function workLabelOf(f: LabelFacts): Label {
  const warning = f.held !== null && !f.connectionUsable ? (f.connectionReason ?? "Their AI connection cannot run work now: new attempts wait.") : null;
  if (f.held !== null) {
    const waitingResources = (f.held.state === "ASSIGNED" || f.held.state === "RUNNING") && (f.liveRun === "waiting_for_resources" || f.liveRun === "unschedulable");
    return { label: waitingResources ? "waiting_resources" : (HELD_LABEL[f.held.state] ?? "working"), availability: "busy", notReadyReason: null, connectionWarning: warning };
  }
  const reason = notReady(f);
  if (reason !== null) return { label: "not_ready", availability: "ineligible", notReadyReason: reason, connectionWarning: null };
  return { label: "ready", availability: "available", notReadyReason: null, connectionWarning: null };
}
