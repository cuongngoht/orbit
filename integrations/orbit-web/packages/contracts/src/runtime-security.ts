// RUNTIME SECURITY, AS THE API SERVES IT AND THE PAGE SHOWS IT (ADR 0063). What a host can do is a probe's answer, never
// an assumption; an attempt's protection has a lifecycle of its own (never the assignment's state); an event's outcome
// keeps a detection apart from a prevention; and a person's review of an incident is a decision with a reason. Nothing
// here can make a policy or release a contained attempt by itself: the policy is the account's, published through its
// lifecycle (governance-core runtime.ts), and every word below is read from records.
import type { RuntimeControlId, RuntimeMode, RuntimePlane } from "@orbit-web/governance-core";
import type { Checked } from "./validate.js";

// ---- what a host can do -----------------------------------------------------------------------------------------------

// Each from a probe the allocator ran on THIS host: SUPPORTED (the probe held), UNSUPPORTED (the kernel or the sensor
// cannot), DEGRADED (it could, and now does not), UNKNOWN (nothing answered). UNKNOWN is never shown as healthy.
export const CAPABILITY_STATES = ["SUPPORTED", "UNSUPPORTED", "DEGRADED", "UNKNOWN"] as const;
export type CapabilityState = (typeof CAPABILITY_STATES)[number];

// What is probed. Observation and prevention are separate capabilities: seeing a thing is not stopping it.
//   observe.process   an exec in a canary container reached the sensor's export, attributed to that container
//   observe.fileless  a memory-only exec was seen as one (a detection: no hook can refuse it here)
//   prevent.exec      an exec the policy names was REFUSED in the canary in scope (errno, no side effect, the event)
//   scope.workload    the same exec still ran in a canary OUTSIDE the policy's scope (the policy is not host-wide)
export const RUNTIME_CAPABILITIES = ["observe.process", "observe.fileless", "prevent.exec", "scope.workload"] as const;
export type RuntimeCapability = (typeof RUNTIME_CAPABILITIES)[number];

export interface CapabilityResult {
  capability: RuntimeCapability;
  state: CapabilityState;
  detail: string;
  checkedAt: string | null;
}

// Where the kernel the sensor watches is: a Linux host, Docker Desktop's virtual machine, rootless Docker, WSL -- or no
// container at all (the development provider: nothing to watch).
export const HOST_KINDS = ["native-linux", "docker-desktop", "rootless-docker", "wsl", "process-provider", "unknown"] as const;
export type HostKind = (typeof HOST_KINDS)[number];

export const RUNTIME_BACKENDS = ["tetragon", "disabled", "test"] as const;
export type RuntimeBackend = (typeof RUNTIME_BACKENDS)[number];

export const SENSOR_STATES = ["HEALTHY", "DEGRADED", "UNAVAILABLE", "DISABLED", "UNKNOWN"] as const;
export type SensorState = (typeof SENSOR_STATES)[number];

export interface SensorView {
  state: SensorState;
  // Changes when the sensor restarts: protection proven under another generation is proven no longer.
  generation: string | null;
  since: string | null;
  detail: string;
  cpuPercent: number | null;
  memoryMiB: number | null;
}

export interface RuntimeHostView {
  backend: RuntimeBackend;
  backendVersion: string | null;
  // The image the sensor runs, pinned by digest.
  backendImage: string | null;
  hostKind: HostKind;
  kernel: string | null;
  arch: string | null;
  sensor: SensorView;
  capabilities: CapabilityResult[];
  probedAt: string | null;
  // What the deployment requires of every account: nothing an account says goes below it.
  floor: RuntimeMode;
  telemetry: { lastEventAt: string | null; lost: number; unattributed: number; retentionDays: number };
}

// ---- an attempt's protection ----------------------------------------------------------------------------------------

// Its own lifecycle, never the assignment's: RUNNING does not mean PROTECTED.
//   UNREGISTERED → REGISTERED (its identity bound) → POLICY_APPLIED → VERIFIED (read back, the probe refused) →
//   PROTECTED (enforce, opened) | OBSERVING (observe); DEGRADED (observe, the sensor faltered); CONTAINING → CONTAINED
//   (enforce, protection lost or an incident); UNKNOWN (nothing can tell); CLEANED_UP (its policy and binding removed).
export const PROTECTION_STATES = ["UNREGISTERED", "REGISTERED", "POLICY_APPLIED", "VERIFIED", "PROTECTED", "OBSERVING", "DEGRADED", "CONTAINING", "CONTAINED", "UNKNOWN", "CLEANED_UP"] as const;
export type ProtectionState = (typeof PROTECTION_STATES)[number];
export const isProtectionState = (v: unknown): v is ProtectionState => (PROTECTION_STATES as readonly unknown[]).includes(v);

export interface ProtectionCheck {
  name: string;
  ok: boolean;
  detail: string | null;
}

// What the allocator established about one plane of the attempt, from outside it.
export interface PlaneIdentity {
  plane: RuntimePlane;
  containerId: string;
  startedAt: string;
  // The mount namespace as the plane reported it and as the sensor saw it: they must agree.
  mntNs: string | null;
  sensorMntNs: string | null;
}

// What an attempt's protection rests on, kept with the run.
export interface ProtectionEvidence {
  backend: RuntimeBackend;
  backendVersion: string | null;
  hostKind: HostKind;
  hostId: string | null;
  bootId: string | null;
  requestedMode: RuntimeMode;
  mode: RuntimeMode;
  controls: RuntimeControlId[];
  policy: string | null;
  digest: string | null;
  planes: PlaneIdentity[];
  checks: ProtectionCheck[];
  state: ProtectionState;
  detail: string;
  verifiedAt: string | null;
  // After this, the evidence must be proven again before anyone may call the attempt protected.
  freshUntil: string | null;
  sensorGeneration: string | null;
}

export type ProtectionBadge = "protected" | "verifying" | "observing" | "degraded" | "contained" | "unprotected" | "unknown";

// The word a page shows for an attempt's protection: "protected" ONLY for PROTECTED with evidence still fresh -- stale
// evidence is unknown, never green.
export function protectionBadge(p: { state: ProtectionState; freshUntil: string | null }, nowMs: number): ProtectionBadge {
  const fresh = p.freshUntil !== null && Date.parse(p.freshUntil) > nowMs;
  const byState: Record<ProtectionState, ProtectionBadge> = {
    PROTECTED: fresh ? "protected" : "unknown",
    VERIFIED: "verifying",
    POLICY_APPLIED: "verifying",
    REGISTERED: "verifying",
    OBSERVING: "observing",
    DEGRADED: "degraded",
    CONTAINING: "contained",
    CONTAINED: "contained",
    UNREGISTERED: "unprotected",
    CLEANED_UP: "unprotected",
    UNKNOWN: "unknown",
  };
  return byState[p.state];
}

export interface WorkloadProtectionView {
  runId: string;
  assignmentId: string;
  missionId: string | null;
  employeeId: string;
  employeeName: string;
  departmentId: string | null;
  attempt: number;
  runState: string;
  state: ProtectionState;
  mode: RuntimeMode;
  controls: RuntimeControlId[];
  detail: string;
  verifiedAt: string | null;
  freshUntil: string | null;
  planes: PlaneIdentity[];
  checks: ProtectionCheck[];
  updatedAt: string;
}

// ---- what the sensor saw ----------------------------------------------------------------------------------------------

// OBSERVED: it happened. VIOLATION_DETECTED: it matched a rule that did not refuse it (observe, or a detection rule).
// OPERATION_PREVENTED: an enforcing rule refused it -- the policy read back in enforce mode AND the kernel's override.
// PROCESS_TERMINATED: a process was killed after it matched (never called prevented). WORKLOAD_CONTAINED: the attempt's
// containers were stopped and verified stopped.
export const RUNTIME_OUTCOMES = ["OBSERVED", "VIOLATION_DETECTED", "OPERATION_PREVENTED", "PROCESS_TERMINATED", "WORKLOAD_CONTAINED"] as const;
export type RuntimeOutcome = (typeof RUNTIME_OUTCOMES)[number];

// The sensor names the rule's action even when the rule only reports (monitor mode still says OVERRIDE): an outcome is
// decided from the policy's mode as READ BACK, never from the event's own word.
export function outcomeOf(e: { matched: boolean; policyMode: "enforce" | "monitor" | "unknown"; action: "override" | "sigkill" | "post" | "other" }): RuntimeOutcome {
  if (!e.matched) return "OBSERVED";
  if (e.policyMode !== "enforce") return "VIOLATION_DETECTED";
  if (e.action === "override") return "OPERATION_PREVENTED";
  if (e.action === "sigkill") return "PROCESS_TERMINATED";
  return "VIOLATION_DETECTED";
}

export const RUNTIME_EVENT_KINDS = ["process.exec", "process.exit", "control.match", "exec.fileless", "exec.model_plane", "telemetry.gap", "workload.contained"] as const;
export type RuntimeEventKind = (typeof RUNTIME_EVENT_KINDS)[number];

export const INCIDENT_SEVERITIES = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const RUN_KINDS_WATCHED = ["assignment", "chat", "research", "executive"] as const;
export type WatchedRunKind = (typeof RUN_KINDS_WATCHED)[number];

export interface RuntimeEventView {
  id: string;
  occurredAt: string;
  kind: RuntimeEventKind;
  outcome: RuntimeOutcome;
  severity: IncidentSeverity;
  runKind: WatchedRunKind;
  plane: RuntimePlane | "session-plane";
  runId: string | null;
  employeeId: string | null;
  binary: string | null;
  parentBinary: string | null;
  // What a control was asked about (the file being executed), when one matched.
  path: string | null;
  control: RuntimeControlId | null;
  execId: string | null;
  parentExecId: string | null;
  exitCode: number | null;
  signal: string | null;
  // Events the store did not keep for this run (its cap), or that the pipeline lost, said where they would have been.
  dropped: number | null;
}

export interface RuntimeEventPage {
  events: RuntimeEventView[];
  // Older events: pass back as `before`.
  next: string | null;
}

// ---- incidents ------------------------------------------------------------------------------------------------------

export const INCIDENT_STATES = ["OPEN", "INVESTIGATING", "CONTAINING", "CONTAINED", "RESOLVED"] as const;
export type IncidentState = (typeof INCIDENT_STATES)[number];

export const INCIDENT_CATEGORIES = ["unexpected_process", "restricted_operation", "policy_violation", "identity_mismatch", "policy_drift", "protection_missing", "sensor_failure", "telemetry_loss", "containment_failure"] as const;
export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];

export interface IncidentActionView {
  at: string;
  action: string;
  actor: string;
  outcome: string;
  detail: string | null;
}

export interface IncidentView {
  id: string;
  category: IncidentCategory;
  severity: IncidentSeverity;
  state: IncidentState;
  title: string;
  runId: string | null;
  assignmentId: string | null;
  missionId: string | null;
  employeeId: string | null;
  employeeName: string | null;
  firstSeen: string;
  lastSeen: string;
  count: number;
  // While true, a person's Retry of the assignment is refused until a review authorizes it.
  blocksRetry: boolean;
  evidence: Record<string, string | number | boolean | null>;
  review: { decision: IncidentDecision; note: string; at: string } | null;
  actions: IncidentActionView[];
  version: number;
}

export const INCIDENT_DECISIONS = ["investigate", "resolve", "authorize_retry"] as const;
export type IncidentDecision = (typeof INCIDENT_DECISIONS)[number];

export interface ReviewIncidentRequest {
  decision: IncidentDecision;
  note: string;
}

export const INCIDENT_LIMITS = { noteLength: 2000 } as const;

export function checkReviewIncident(body: unknown): Checked<ReviewIncidentRequest> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, errors: ["a review is a JSON object"] };
  const b = body as Record<string, unknown>;
  const errors = Object.keys(b).filter((k) => k !== "decision" && k !== "note").map((k) => `${k} is not part of a review`);
  if (!(INCIDENT_DECISIONS as readonly unknown[]).includes(b.decision)) errors.push(`decision must be one of ${INCIDENT_DECISIONS.join(", ")}`);
  if (typeof b.note !== "string" || b.note.length > INCIDENT_LIMITS.noteLength) errors.push(`note must be text of at most ${INCIDENT_LIMITS.noteLength} characters`);
  else if (b.decision === "authorize_retry" && b.note.trim() === "") errors.push("note: say why the work may run again");
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { decision: b.decision as IncidentDecision, note: b.note as string } };
}

// ---- the page's summary ---------------------------------------------------------------------------------------------

export interface RuntimeSecurityOverview {
  // What the account's policy in effect says, and what it composes to under the deployment's floor (a department may
  // still raise its own employees above it).
  configured: { mode: RuntimeMode; controls: RuntimeControlId[] };
  effective: { mode: RuntimeMode; controls: RuntimeControlId[]; floor: RuntimeMode; from: "deployment" | "company" | "department" };
  host: RuntimeHostView;
  // Running attempts, by what holds them now (never inferred from a configuration).
  coverage: { protected: number; observing: number; degraded: number; contained: number; unprotected: number; running: number };
  openIncidents: number;
  // In the last 24 hours, as the sensor and the policy's mode established them.
  prevented24h: number;
  detected24h: number;
  // What chats, research and CEO Chat are held to: observation by the deployment's floor, never an employee's policy.
  sessions: "observed" | "not_observed";
}
