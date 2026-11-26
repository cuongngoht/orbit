// RUNTIME SECURITY ON THE ALLOCATOR'S WIRE (ADR 0063): what an attempt asks to be held to, what the allocator proved about
// it, what the sensor reported (attributed by the allocator, never by anything a process said), and what the host can
// do. Shared by the allocator (allocator/runtime-security/) and Orbit Web's side (the provider, the security context).
import type { CapabilityResult, HostKind, ProtectionEvidence, RuntimeOutcome, SensorState, WatchedRunKind } from "@orbit-web/contracts";
import type { RuntimeControlId, RuntimeMode, RuntimePlane } from "@orbit-web/governance-core";

// What an attempt is to be held to, as Orbit Web composed it from the account's (and department's) policy and the
// deployment's floor. The allocator applies the floor again itself.
export interface AttemptRuntimeSecurity {
  mode: RuntimeMode;
  controls: RuntimeControlId[];
}

export type WirePlane = RuntimePlane | "session-plane";

export interface WireRuntimeEvent {
  seq: number;
  // Stable across a restart of the allocator: what Orbit Web dedupes on.
  key: string;
  time: string;
  kind: "process.exec" | "process.exit" | "control.match" | "identity.mismatch" | "workload.contained";
  outcome: RuntimeOutcome;
  accountId: string;
  runKind: WatchedRunKind;
  runId: string;
  dispatchKey: string;
  employeeId: string | null;
  assignmentId: string | null;
  sessionId: string | null;
  plane: WirePlane | null;
  binary: string | null;
  parentBinary: string | null;
  path: string | null;
  control: RuntimeControlId | null;
  execId: string | null;
  parentExecId: string | null;
  exitCode: number | null;
  signal: string | null;
  policy: string | null;
}

export interface WireProtection extends ProtectionEvidence {
  dispatchKey: string;
  runId: string;
  accountId: string;
  assignmentId: string | null;
  employeeId: string | null;
  fence: number;
  opened: boolean;
  lostSince: string | null;
  updatedAt: string;
}

export interface WireSensor {
  state: SensorState;
  generation: string | null;
  since: string | null;
  version: string | null;
  image: string | null;
  detail: string;
}

export interface RuntimePull {
  epoch: string;
  // The cursor's epoch was another allocator's (it restarted): numbering starts over from what this one holds.
  reset: boolean;
  events: WireRuntimeEvent[];
  next: number;
  // Events between the cursor and the oldest the ring still holds.
  lost: number;
  unattributed: number;
  // Times the sensor's export could not be read whole.
  gaps: number;
  protections: WireProtection[];
  sensor: WireSensor | null;
  canaryProvenAt: string | null;
}

// What this host can do for runtime security, each capability from a probe the allocator ran.
export interface RuntimeHostProbe {
  backend: "tetragon" | "disabled";
  backendVersion: string | null;
  backendImage: string | null;
  hostKind: HostKind;
  kernel: string | null;
  arch: string | null;
  floor: RuntimeMode;
  sensor: WireSensor;
  capabilities: CapabilityResult[];
  resources: { cpuPercent: number | null; memoryMiB: number | null };
  probedAt: string;
}

export interface OpenedAttempt {
  // The model plane's runner credential: released only here, once the gate holds.
  runnerCredential: string;
  protection: ProtectionEvidence | null;
}
