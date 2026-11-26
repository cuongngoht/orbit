// THE RULES OF RUNTIME SECURITY (ADR 0063): what an event the allocator attributed IS, how severe it is, whether it is an
// incident, and what is done about it -- one ordered table, decided from facts (the kernel's, the policy's mode), never
// by a model and never from the words of a program's output. A detection never becomes a prevention here, and an
// observed workload is never stopped: observation is not prevention, nor containment.
import type { IncidentCategory, IncidentSeverity, IncidentState, ProtectionState, RuntimeEventKind, RuntimeOutcome, WatchedRunKind } from "@orbit-web/contracts";
import type { RuntimeMode } from "@orbit-web/governance-core";

export interface EventFact {
  kind: "process.exec" | "process.exit" | "control.match" | "identity.mismatch" | "workload.contained";
  outcome: RuntimeOutcome;
  plane: "tool-plane" | "model-plane" | "session-plane" | null;
  binary: string | null;
  path: string | null;
  control: string | null;
  runKind: WatchedRunKind;
}

// A memory-only program, executed through a descriptor: the kernel hook sees no file to judge.
const FILELESS = /^\/proc\/(self|thread-self|\d+)\/fd\/\d+$/;
// Programs only the workstation is meant to run: in the model plane (the AI CLI and Orbit's bridge), one is an anomaly.
const SHELLS = /^(sh|dash|bash|zsh|ksh|ash|busybox|python(\d+(\.\d+)?)?|perl|ruby|php|lua|nc|ncat|netcat|socat|curl|wget|telnet|ssh)$/;

export const isShellOrInterpreter = (binary: string | null): boolean => binary !== null && SHELLS.test(binary.slice(binary.lastIndexOf("/") + 1));

export function classify(e: EventFact): { kind: RuntimeEventKind; severity: IncidentSeverity } {
  if (e.kind === "identity.mismatch") return { kind: e.kind, severity: "CRITICAL" };
  if (e.kind === "workload.contained") return { kind: e.kind, severity: "HIGH" };
  if (e.kind === "control.match") return { kind: e.kind, severity: e.outcome === "PROCESS_TERMINATED" ? "HIGH" : "MEDIUM" };
  if (e.kind === "process.exec" && FILELESS.test(e.binary ?? "")) return { kind: "exec.fileless", severity: "HIGH" };
  if (e.kind === "process.exec" && e.plane === "model-plane" && isShellOrInterpreter(e.binary)) return { kind: "exec.model_plane", severity: "HIGH" };
  return { kind: e.kind, severity: "INFO" };
}

export type Response = "revoke" | "stop";

export interface IncidentPlan {
  category: IncidentCategory;
  severity: IncidentSeverity;
  title: string;
  // Deterministic responses, in order: end the attempt's run token (its proxy and tool door refuse at once), stop
  // exactly its two containers (by its dispatch key: never a newer attempt's) and verify them stopped.
  respond: Response[];
  blocksRetry: boolean;
  state: IncidentState;
  // One incident per cause per attempt: a repeat raises its count, never makes another.
  fingerprint: string;
}

export interface IncidentInput {
  kind: RuntimeEventKind;
  severity: IncidentSeverity;
  mode: RuntimeMode | null;
  outcome?: RuntimeOutcome;
  runKind: WatchedRunKind;
  runId: string;
  control: string | null;
  path: string | null;
  binary: string | null;
}

const TITLES: Partial<Record<RuntimeEventKind, string>> = {
  "exec.fileless": "A program was executed from memory (no file on disk)",
  "exec.model_plane": "A shell or an interpreter started in the model plane, where only the AI CLI runs",
  "identity.mismatch": "A container and the policy that matched it belong to different attempts",
};

export function incidentFor(i: IncidentInput): IncidentPlan | null {
  if (i.severity === "INFO" || i.kind === "process.exec" || i.kind === "process.exit") return null;
  const enforced = i.mode === "enforce" && i.runKind === "assignment";
  if (i.kind === "control.match") {
    const prevented = i.outcome === "OPERATION_PREVENTED";
    return {
      category: prevented ? "restricted_operation" : "policy_violation",
      severity: i.severity,
      title: prevented ? `An operation was refused by the kernel: ${i.control ?? "a control"} (${i.path ?? "?"})` : `An operation ${i.control ?? "a control"} would have been refused under enforce ran, observed (${i.path ?? "?"})`,
      respond: [],
      blocksRetry: false,
      state: prevented ? "CONTAINED" : "OPEN",
      fingerprint: `${prevented ? "restricted" : "violation"}:${i.runId}:${i.control ?? "?"}`,
    };
  }
  if (i.kind === "workload.contained") return { category: "protection_missing", severity: "HIGH", title: "The attempt's required protection was lost, and both its containers were stopped", respond: ["revoke"], blocksRetry: true, state: "CONTAINED", fingerprint: `protection:${i.runId}` };
  const title = TITLES[i.kind];
  if (title === undefined) return null;
  return { category: i.kind === "identity.mismatch" ? "identity_mismatch" : "unexpected_process", severity: i.severity, title, respond: enforced ? ["revoke", "stop"] : [], blocksRetry: enforced, state: enforced ? "CONTAINING" : "OPEN", fingerprint: `${i.kind}:${i.runId}` };
}

// When a change of an attempt's protection is its LOSS, said on the account's chain: proof lost under enforce, the
// attempt contained by the allocator, or its observation degraded. A repeat of the same state is no change.
export function protectionLoss(p: { mode: RuntimeMode; from: ProtectionState | null; to: ProtectionState }): { contained: boolean } | null {
  if (p.from === p.to) return null;
  if (p.mode === "enforce" && p.to === "UNKNOWN" && (p.from === "PROTECTED" || p.from === "VERIFIED")) return { contained: false };
  if (p.mode === "enforce" && p.to === "CONTAINED") return { contained: true };
  if (p.mode === "observe" && p.to === "DEGRADED" && p.from === "OBSERVING") return { contained: false };
  return null;
}

// What a change of an attempt's protection, as the allocator reported it, means for a person.
export function protectionIncident(p: { runId: string; mode: RuntimeMode; from: ProtectionState | null; to: ProtectionState; detail: string }): (IncidentPlan & { detail: string }) | null {
  if (p.from === p.to) return null;
  const lost = { category: "protection_missing" as const, severity: "HIGH" as const, title: "The attempt's required protection was lost while it ran", respond: [] as Response[], blocksRetry: true, fingerprint: `protection:${p.runId}`, detail: p.detail };
  if (p.mode === "enforce" && p.to === "UNKNOWN" && (p.from === "PROTECTED" || p.from === "VERIFIED")) return { ...lost, state: "CONTAINING" };
  if (p.mode === "enforce" && p.to === "CONTAINED") return { ...lost, title: "The attempt's required protection was lost, and both its containers were stopped", state: "CONTAINED" };
  if (p.mode === "enforce" && p.to === "CONTAINING" && /could not be verified/i.test(p.detail)) return { category: "containment_failure", severity: "CRITICAL", title: "Containment could not be verified: a container of the attempt still runs", respond: [], blocksRetry: true, state: "CONTAINING", fingerprint: `containment:${p.runId}`, detail: p.detail };
  if (p.mode === "observe" && p.to === "DEGRADED") return { category: "sensor_failure", severity: "LOW", title: "Observation of the attempt degraded: the sensor could not report it whole", respond: [], blocksRetry: false, state: "OPEN", fingerprint: `degraded:${p.runId}`, detail: p.detail };
  return null;
}
