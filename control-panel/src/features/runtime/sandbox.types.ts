// What control-server answers for a task's SANDBOX and for a checkout's sandbox policy
// (control-server/src/tasks/sandbox.mjs, control-server/src/project-runtime/sandbox.mjs), which is what
// `node cli/runtime.mjs sandbox|sandboxes|sandbox-logs|trust --json` prints. The runtime is the source of
// truth and the server validates every change.
//
// A sandbox is an ENVIRONMENT a task owns, not a runtime of its own: its state is whether it was built
// from the source tree the task holds now, never whether the product is right. Nothing here carries a
// path of this machine -- the runtime does not send one -- and nothing starts, restarts or builds it.
import type { Provider, Readiness, ReachState, RuntimeSettings, Strategy, StopResult } from "./runtime.types";

export type SandboxState = "ALLOCATED" | "PREPARING" | "READY" | "STALE" | "AMBIGUOUS" | "RELEASED";
export type RestoreMode = "manual" | "approved";
export type PortMode = "lease" | "fixed";

/** Who a sandbox belongs to. A task, always: a person's own runtime is not a sandbox. */
export interface SandboxOwner {
  kind: "task";
  id: string;
}

/** One component of the sandbox, as it runs there: which way, which session, and where it answers. */
export interface SandboxComponent {
  component: string;
  execution: Provider;
  session: string | null;
  requestedAt: string | null;
  state: string;
  readiness: Readiness | null;
  /** Where it answers, as text: a sandbox never offers a link to a server. */
  endpoint: string | null;
}

export interface SandboxLease {
  port: number;
  component: string;
  since: string;
}

/** What one location last answered about a server a component of the sandbox needs. */
export interface SandboxReach {
  /** The reach target's id, a person's setting. */
  target: string;
  from: Provider;
  state: ReachState;
  because: string;
  checkedAt: string | null;
  stale: boolean;
}

/** How many things of the sandbox Orbit can prove are its own, and how many it found and never touches. */
export interface SandboxOwnership {
  processes: number;
  containers: number;
  external: number;
}

/** Whose data the sandbox's components reach: the worst a person declared, or unknown. */
/** Whose data the components reach, worst first as the runtime folds it; NONE when nothing outside the sandbox is needed. */
export type DataIsolationState = "production" | "external-readonly" | "shared-development" | "task-isolated" | "unknown" | "NONE";

export interface DataIsolation {
  state: DataIsolationState;
  because: string;
}

export interface SandboxQa {
  modes: string[];
  entry: string | null;
  browser: string;
}

export interface SandboxView {
  environment: string;
  owner: SandboxOwner;
  workspace: string;
  state: SandboxState;
  /** The source tree the sandbox was built from. */
  tree: string | null;
  /** The source tree the task's workspace holds now. */
  currentTree: string | null;
  stale: boolean;
  because?: string | null;
  components: SandboxComponent[];
  leases: SandboxLease[];
  connectivity: SandboxReach[];
  ownership: SandboxOwnership;
  dataIsolation: DataIsolation;
  qa: SandboxQa;
  createdAt: string;
  updatedAt: string;
}

/** One row of a checkout's sandboxes. */
export interface SandboxBrief {
  id: string;
  owner: SandboxOwner;
  workspace: string;
  state: SandboxState;
  tree: string | null;
  stale: boolean;
  components: number;
  leases: number[];
  updatedAt: string;
}

/** A lease nobody holds any more: dropped by the next acquire, and shown so a person can see it. */
export interface StaleLease {
  port: number;
  owner: string;
  component: string;
}

export interface SandboxList {
  sandboxes: SandboxBrief[];
  staleLeases: StaleLease[];
}

export type LogStream = "out" | "err";

/** A log read from a byte offset: `next` is where the next read starts, always at a line start. */
export interface SandboxLogPage extends SandboxLogs {
  from: number;
  next: number;
  size: number;
  reset?: boolean;
}

/** A session's output: bounded and scrubbed by the runtime, a line at a time. */
export interface SandboxLogs {
  session: string;
  stream: LogStream;
  lines: string[];
  truncated: boolean;
  bytes: number;
}

export type SandboxStopResult = Pick<StopResult, "stopped" | "gone" | "refused">;

export interface SandboxReleaseResult {
  released: boolean;
  environment: string;
  why?: string;
  leases: readonly unknown[];
  containers: readonly unknown[];
}

/** What a person's Stop or Release answered, and the sandbox as it stands after it. */
export interface SandboxOperationResult<R> {
  result: R;
  sandbox: SandboxView | null;
}

// ---- the policy: what a PERSON allows, saved with the rest of the runtime settings ----------------------

export interface SandboxPolicy {
  enabled: boolean;
  strategy: Strategy;
  limits: { active: number };
  restore: { mode: RestoreMode; /** Fingerprints of restore plans a person trusts. */ trusted: string[] };
  ports: { mode: PortMode; from: number; to: number };
  /** Fingerprints of container definitions a person approves. */
  trustedDefinitions: string[];
  qa: { modes: string[]; entry: string | null; browser: string };
  network: { denyProductionWrites: boolean };
}

export type TrustKind = "restore" | "definition";

/** A trust is a kind, the fingerprint a person read, and the settings revision they read it against. */
export interface TrustBody {
  kind: TrustKind;
  fingerprint: string;
  /** Null when the settings were never saved. */
  revision: string | null;
}

/** The runtime's own answer to a trust: the settings after the revisioned write. */
export interface SavedTrust {
  saved: RuntimeSettings;
}
