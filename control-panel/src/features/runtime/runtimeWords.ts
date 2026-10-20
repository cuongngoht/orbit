import type { CapabilityState, Compatibility, ComponentState, Observation, OverallState, ProposalState, Provider, ReachState, Resolution, Strategy, Transport } from "./runtime.types";
import type { PortMode, RestoreMode, SandboxState } from "./sandbox.types";
import { formatAge } from "../../shared/format";

// The engine's states in a person's words. The order of detection, what each state means and every
// decision are the engine's (src/runtime/); this only names them. Nothing here says "healthy",
// "passing" or "verified": a runtime is up or it is not, and whether it is right is a test's.

export type Tone = "success" | "warning" | "danger" | "informative" | "subtle";

const TONES: readonly (readonly [readonly string[], Tone])[] = [
  [["CURRENT", "READY", "ready", "RUNNING", "AVAILABLE", "compatible", "VALIDATED", "ORBIT_OWNED", "NO_CHANGE", "adopted", "REACHABLE", "RESOLVED"], "success"],
  [["PARTIAL", "STALE", "unknown", "UNKNOWN", "READINESS_UNKNOWN", "needs-host", "needs-environment", "unresolved", "UNRESOLVED", "ADOPTED", "NOT_CHECKED", "AMBIGUOUS", "PREPARING", "CREATE", "PATCH", "unreachable"], "warning"],
  [["BLOCKED", "blocked", "incompatible", "UNAVAILABLE", "VALIDATION_FAILED", "UNSAFE", "NOT_READY", "LOST", "UNREACHABLE", "FAILED"], "danger"],
  [["STOPPED", "NOT_DISCOVERED", "EMPTY", "not-startable", "NOT_RUNNING", "EXTERNAL", "PROPOSED", "open", "NOT_ATTEMPTED", "RELEASED", "ALLOCATED"], "subtle"],
];

export const toneOf = (word: string): Tone => TONES.find(([words]) => words.includes(word))?.[1] ?? "informative";

export const OVERALL_SAY: Record<OverallState, string> = {
  READY: "Everything that can start can start here",
  PARTIAL: "Part of it can start here",
  BLOCKED: "Nothing can start here yet",
  UNRESOLVED: "A requirement has no way to be met",
  UNKNOWN: "This machine has not been asked yet",
  EMPTY: "There is nothing to start",
};

export const COMPONENT_SAY: Record<ComponentState, string> = {
  ready: "can start here",
  blocked: "blocked",
  unresolved: "no way to run it",
  unknown: "not known yet",
  "not-startable": "nothing to start",
};

export const COMPATIBILITY_SAY: Record<Compatibility, string> = {
  compatible: "compatible",
  incompatible: "incompatible",
  "needs-host": "needs something on this machine",
  "needs-environment": "needs an environment",
  unknown: "not known",
};

export const CAPABILITY_LABEL: Record<"browser" | "http" | "database" | "testRunner", string> = {
  browser: "A browser can drive it",
  http: "An API call can reach it",
  database: "Its data can be read",
  testRunner: "Its tests can be run",
};

export const CAPABILITY_SAY: Record<CapabilityState, string> = { AVAILABLE: "available", BLOCKED: "blocked", UNKNOWN: "not known" };

export const STRATEGIES: readonly Strategy[] = ["auto", "native", "devcontainer"];

// Where a component runs, in a person's words. The values are the engine's, unchanged.
export const STRATEGY_SAY: Record<Strategy, string> = {
  auto: "Auto",
  native: "Host (native)",
  devcontainer: "Dev Container",
};

export const PROVIDERS: readonly Provider[] = ["native", "devcontainer"];

export const PROVIDER_SAY: Record<Provider, string> = { native: "Host (native)", devcontainer: "Dev Container" };

export const isProvider = (value: string): value is Provider => PROVIDERS.some((p) => p === value);

// What a connectivity check answered, in words: never "connected" for a port that accepted, because a
// connection is not a login, and never "currently" for an answer that was kept.
export const REACH_SAY: Record<ReachState, string> = {
  NOT_CHECKED: "not checked yet",
  REACHABLE: "reachable",
  UNREACHABLE: "unreachable",
  UNKNOWN: "could not tell",
  BLOCKED: "blocked: could not be checked",
};

// "resolves" is that the name became an address here -- by DNS or by this machine's hosts file -- and
// an address needs no lookup at all.
export const RESOLUTION_SAY: Record<Resolution, string> = { RESOLVED: "resolves", FAILED: "does not resolve", UNKNOWN: "could not tell", NOT_ATTEMPTED: "no lookup" };

// Refused and nothing-answered are both "not reached": the sentence beside it says which, where it can.
export const TRANSPORT_SAY: Record<Transport, string> = { REACHABLE: "accepts a connection", UNREACHABLE: "not reached", UNKNOWN: "could not tell", NOT_ATTEMPTED: "not tried" };

// One location's answer as a line: when, after how many attempts, and why.
export function observationLine(o: Observation): string {
  if (o.state === "NOT_CHECKED") return o.because;
  const when = `checked ${formatAge(o.freshness.age)} · attempt ${o.attemptsUsed} of ${o.configuredAttempts}`;
  return o.because ? `${when} · ${o.because}` : when;
}

export const PROPOSAL_SAY: Record<ProposalState, string> = {
  CREATE: "creates a dev container definition",
  PATCH: "changes the existing dev container definition",
  NO_CHANGE: "the existing environment already provides what is needed",
  UNRESOLVED: "something it needs cannot be provided by an environment feature: a person decides",
  UNSAFE: "adopting it would rewrite something that is never edited automatically",
};

export const isStrategy = (value: string): value is Strategy => STRATEGIES.some((s) => s === value);

// ---- a task's sandbox -----------------------------------------------------------------------------------
// A sandbox is READY when it was built from the source tree the task holds now, and STALE when the task has
// moved on since. Neither says the product is right.
export const SANDBOX_SAY: Record<SandboxState, string> = {
  ALLOCATED: "reserved, nothing prepared yet",
  PREPARING: "being prepared",
  READY: "built from the task's current source tree",
  STALE: "built from an older source tree than the task holds now",
  AMBIGUOUS: "a preparation never settled: a person decides what to do with it",
  RELEASED: "released: nothing of it runs and nothing is leased",
};

/** A fingerprint is a whole SHA-256 to the engine and its first characters to a person; only the whole one is ever sent. */
export const FINGERPRINT = /^[a-f0-9]{64}$/;

export const shortFingerprint = (fingerprint: string) => fingerprint.slice(0, 12);

/** A source tree id as a person reads it: the first characters, never the whole hash. */
export const shortTree = (tree: string | null) => (tree ? tree.slice(0, 12) : "none");

export const RESTORE_MODES: readonly RestoreMode[] = ["manual", "approved"];

export const RESTORE_SAY: Record<RestoreMode, string> = { manual: "Never restore: a person does it", approved: "Restore only plans a person trusts" };

export const PORT_MODES: readonly PortMode[] = ["lease", "fixed"];

export const PORT_SAY: Record<PortMode, string> = { lease: "Lease a free port from the range", fixed: "Use the port a component declares" };

export const isRestoreMode = (value: string): value is RestoreMode => RESTORE_MODES.some((m) => m === value);

export const isPortMode = (value: string): value is PortMode => PORT_MODES.some((m) => m === value);

/** The ways an investigation may work in a sandbox, in the engine's words (src/investigation/vocab.mjs). */
export const QA_MODES: readonly string[] = ["observe", "explore-write", "security-test", "regression"];
