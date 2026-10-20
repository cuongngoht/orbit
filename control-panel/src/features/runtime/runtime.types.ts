// What control-server answers for one checkout's runtime (control-server/src/project-runtime/),
// which is what `node cli/runtime.mjs <command> --json` prints. The shapes mirror
// src/runtime/lifecycle/status.mjs and the commands in src/runtime/index.mjs; the server is the
// source of truth and validates every change.
//
// The words are the engine's, kept apart on purpose: understanding is whether the evidence was
// read; a plan state is whether a component COULD start here; a session state is what is running;
// readiness is whether it ANSWERS; a capability is what could be checked right now. None of them is
// a verdict about the product.

import type { DataIsolationState, SandboxPolicy } from "./sandbox.types";

export type UnderstandingState = "NOT_DISCOVERED" | "CURRENT" | "STALE" | "PARTIAL" | "UNKNOWN";
export type ComponentState = "ready" | "blocked" | "unresolved" | "unknown" | "not-startable";
export type OverallState = "READY" | "PARTIAL" | "BLOCKED" | "UNRESOLVED" | "UNKNOWN" | "EMPTY";
export type Compatibility = "compatible" | "incompatible" | "needs-host" | "needs-environment" | "unknown";
export type CapabilityState = "AVAILABLE" | "BLOCKED" | "UNKNOWN";
export type ToolAnswer = "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";
export type Strategy = "auto" | "native" | "devcontainer";
export type Provider = "native" | "devcontainer";
export type ProbeKind = "http" | "tcp";
export type Ownership = "ORBIT_OWNED" | "EXTERNAL" | "UNKNOWN";
export type ProposalState = "CREATE" | "PATCH" | "NO_CHANGE" | "UNRESOLVED" | "UNSAFE";
export type InstanceState = "PROPOSED" | "ADOPTED" | "VALIDATING" | "VALIDATED" | "VALIDATION_FAILED";

export interface CheckoutRef {
  key: string;
  checkout: string;
}

export interface Command {
  declaredAs: string;
  text: string;
  argv: string[];
  cwd: string;
}

export interface Candidate {
  provider: string;
  state: Compatibility;
  because: string;
  blocking: string[];
}

/** One cell of the operating-system matrix: yes · no · unknown, and why when it is not yes. */
export interface OsCell {
  state: "yes" | "no" | "unknown";
  because: string | null;
}

/** A column of the matrix: the id a machine reports, the name a person reads. */
export interface Platform {
  id: string;
  name: string;
}

/** Where the checkout's own files show it is built or run -- evidence, never a requirement. */
export interface OsEvidence {
  os: string[];
  exclusive: boolean;
  /** Which kind of file said it: `ci` a pipeline, `script` the scripts a checkout keeps. */
  source: string | null;
  evidence: string[];
}

/** A component as a form names it: the key the engine keeps, the name a person reads. */
export interface ComponentRef {
  key: string;
  name: string;
}

export interface PlanComponent {
  key: string;
  name: string;
  kind: string;
  ecosystem: string;
  evidence: string[];
  state: ComponentState;
  provider: string | null;
  because: string;
  blocking: string[];
  candidates: Candidate[];
  command?: Command | null;
  /** Where it could run natively, by platform id. */
  os: Record<string, OsCell>;
}

export interface ServiceRow {
  service: string;
  image: string | null;
  port: number | null;
  reachable: boolean | null;
}

export interface Probe {
  kind: string;
  target: string | number;
  /** `human` when a person set it; anything else is something a file said. */
  source: string;
}

export interface Readiness {
  state: "READY" | "NOT_READY" | "READINESS_UNKNOWN" | "NOT_RUNNING" | "NOT_CHECKED";
  because?: string;
  probe?: Probe;
}

export interface Session {
  id: string;
  component: string;
  provider: string;
  state: string;
  ownership: Ownership;
  why: string;
  pid: number | null;
  startedAt: string | null;
  ports: number[];
  readiness: Readiness;
}

export interface Validation {
  state: "VALIDATED" | "VALIDATION_FAILED";
  at: string;
  because: string;
}

export interface Instance {
  id: string;
  name: string;
  provider: string;
  state: InstanceState;
  /** An environment file was edited since it was validated: it is adopted again, not validated. */
  changed?: boolean;
  validation: Validation | null;
}

export interface ProposalBrief {
  id: string;
  state: ProposalState;
  because: string;
  createdAt: string;
}

export interface ProposalFile {
  path: string;
  text: string;
}

export interface ProposalPatch {
  path: string;
  edits: unknown[];
}

export interface Proposal {
  id: string;
  state: ProposalState;
  /** open · adopted. */
  status: string;
  because: string;
  files: { create: ProposalFile[]; patch: ProposalPatch[] };
  gaps: { id: string; state: string; because: string | null }[];
  unresolved: { id: string; why: string }[];
  risks: string[];
  notes: string[];
  createdAt: string;
}

/** How a component is TOLD the port a sandbox leases it: data, with `{port}` once in the format. A person edits it in the Settings card. */
export type PortBinding = { kind: "env"; name: string; format: string } | { kind: "argv"; flag: string; format: string; after?: string };

export interface ComponentSetting {
  /** A person's word on how a sandbox tells this component its port: the Settings card's Port column, judged by the engine on save. */
  port?: { override?: PortBinding };
  provider?: Provider;
  command?: string;
  env?: string[];
  readiness?: { kind: ProbeKind; target: string | number; expect?: number };
}

/** How hard a connectivity check tries: bounded on every side, by the engine. */
export interface RetryPolicy {
  attempts: number;
  intervalMs: number;
  timeoutMs: number;
}

/** A server a component needs and Orbit does not run: a host and a port a person set. Never a URL, a credential or a command. */
export interface ReachTargetSetting {
  label: string;
  host: string;
  port: number;
  protocol: "tcp";
  requiredBy: string[];
  /** Where it is asked from: this machine (native), inside the dev container, or both -- each its own network. */
  checkFrom: Provider[];
  /** A start of a component that requires it waits for it to answer from where the component will run. */
  beforeStart: boolean;
  /** This target's own policy, laid over the block's: only the fields it names. */
  retry?: Partial<RetryPolicy>;
  note?: string;
  /** Whose data a person says this server holds. Read by a sandbox's data-isolation line; this form keeps it as read. */
  classification?: DataIsolationState;
}

export interface ConnectivityBlock {
  /** Read back whole (the engine fills a default for a number left out); a save may leave one out. */
  retry: Partial<RetryPolicy>;
  targets: Record<string, ReachTargetSetting>;
}

export interface SettingsBlock {
  strategy: Strategy;
  reuseExternal: boolean;
  components: Record<string, ComponentSetting>;
  connectivity: ConnectivityBlock;
  /** What a person allows a task's sandbox. A save of any other field sends it back untouched. */
  sandbox: SandboxPolicy;
}

// ---- connectivity: what a check observed, per target and per location ---------------------------

export type ReachState = "NOT_CHECKED" | "REACHABLE" | "UNREACHABLE" | "UNKNOWN" | "BLOCKED";
export type Resolution = "RESOLVED" | "FAILED" | "UNKNOWN" | "NOT_ATTEMPTED";
export type Transport = "REACHABLE" | "UNREACHABLE" | "UNKNOWN" | "NOT_ATTEMPTED";

export interface ReachAttempt {
  number: number;
  state: ReachState;
  because: string;
}

/** What one location last answered about one target. Kept, never current once it is stale. */
export interface Observation {
  target: string;
  provider: Provider;
  state: ReachState;
  resolution: Resolution;
  transport: Transport;
  because: string;
  checkedAt: string | null;
  attemptsUsed: number;
  configuredAttempts: number;
  attempts: ReachAttempt[];
  freshness: { age: number | null; stale: boolean };
}

export type Observations = Partial<Record<Provider, Observation>>;

export interface ReachTarget {
  id: string;
  label: string;
  host: string;
  port: number;
  protocol: "tcp";
  requiredBy: string[];
  checkFrom: Provider[];
  beforeStart: boolean;
  /** The policy that applies to it: its own over the block's. */
  retry: RetryPolicy;
  note?: string;
  observations: Observations;
}

export interface Connectivity {
  retry: RetryPolicy;
  /** How long an answer stands for now; older is STALE. */
  freshMs: number;
  targets: ReachTarget[];
}

export interface CheckResult {
  target: Omit<ReachTarget, "observations">;
  mode: "check" | "retry";
  results: Observations;
}

/** A server answering for a component Orbit is not running, which a start would reuse: EXTERNAL, never stopped. */
export interface ExternalServer {
  component: string;
  provider: string | null;
  ownership: "EXTERNAL";
  readiness: Readiness;
}

export interface RuntimeSettings {
  exists: boolean;
  settings: SettingsBlock;
  /** Other machines that keep settings for this checkout: advice here, never applied. */
  others: string[];
  revision: string | null;
  unreadable: string | null;
}

export interface ToolObservation {
  state: ToolAnswer;
  version: string | null;
  reason: string | null;
  checkedAt: string | null;
}

export interface CapabilityAnswer {
  state: CapabilityState;
  because: string;
  commands?: { component: string; declaredAs: string; text: string; safe: boolean }[];
}

export interface Verification {
  browser: CapabilityAnswer;
  http: CapabilityAnswer;
  database: CapabilityAnswer;
  testRunner: CapabilityAnswer;
}

export interface RuntimeStatus {
  checkout: { id: string; root: string; name: string; host: string; branch: string | null; commit: string | null };
  understanding: { state: UnderstandingState; facts: number; at: string | null; commit: string | null; branch: string | null; unknowns: string[]; gaps: string[]; stale: string[]; dirty: string[]; added: string[]; removed: string[] };
  plan: { overall: OverallState; strategy: Strategy; host: { platform: string; arch: string }; platforms: Platform[]; osEvidence: OsEvidence[]; components: PlanComponent[] };
  sessions: Session[];
  services: ServiceRow[];
  instances: Instance[];
  proposals: ProposalBrief[];
  settings: RuntimeSettings;
  machine: { platform: string; arch: string; tools: Record<string, ToolObservation> };
  verification: Verification;
  /** With reuse allowed: what answers for a component Orbit is not running. */
  external?: ExternalServer[];
}

// ---- what each operation answers ------------------------------------------------------------------

export interface DiscoverResult {
  decision: { name: string; say: string; scan: string; writes: boolean; dry: boolean };
  state: UnderstandingState;
  facts: number;
  byKind: Record<string, number>;
  gaps: string[];
  notes: string[];
}

export interface DoctorResult {
  understanding: { state: UnderstandingState };
  machine: { platform: string; arch: string; tools: Record<string, ToolObservation> };
  plan: { overall: OverallState };
}

export interface PrepareResult {
  apply: boolean;
  plans: { provider: string; host: { say: string }[]; environment: { step: string; needed: boolean; say: string }[]; repository: string }[];
  applied?: { provider: string; ok: boolean; because: string }[];
}

export interface StartResult {
  /** `withheld`: variable NAMES a container could not be handed (a value with a line break). */
  started: { component: string; session: string; pid: number; provider: string; readiness: Readiness | null; withheld?: string[] }[];
  /** An external server answered as the component should: used, never started or owned. */
  reused?: { component: string; provider: string; ownership: "EXTERNAL"; readiness: Readiness; because: string }[];
  skipped: { component: string; pid: number }[];
  blocked: { component: string; blocking: string[] }[];
  notReady: { component: string; state: string; because: string }[];
}

export interface StopResult {
  stopped: { component: string; how: string; residual?: string | null }[];
  gone: { component: string; outcome: string }[];
  refused: { component?: string; session?: string; why: string }[];
  released: { component: string; session: string }[];
  environment?: { because: string } | null;
}

export interface AdoptResult {
  instance: { id: string; state: InstanceState };
  files: { path: string; created: boolean }[];
}

export interface ValidateResult {
  id: string;
  state: InstanceState;
  validation: Validation;
}

export interface SavedSettings {
  saved: RuntimeSettings;
}
