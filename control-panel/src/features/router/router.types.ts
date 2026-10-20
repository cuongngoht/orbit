// The shapes control-server answers with for the Router Inspector
// (control-server/src/router-inspector/resolve.mjs), which are the prompt
// router's own: src/resources/model.mjs and src/routing/resolve.mjs (v2).

export type Family = "skills" | "agents" | "mcp" | "tools" | "capabilities";

/** Every family, in reading order -- what to iterate instead of `Object.values`, which would also meet `version` and `problems`. */
export const FAMILY_NAMES: readonly Family[] = ["skills", "agents", "mcp", "tools", "capabilities"];
export type Verdict = "allow" | "approval" | "deny";

export interface FamilySummary {
  family: Family;
  total: number;
  /** Somebody wants it: a switch, a desired state. */
  enabled: number;
  /** Usable now: enabled AND runtime-ready. */
  available: number;
  /** The resolver may consider it: available, and its owner, selection and policy allow it. */
  eligible: number;
}

export interface Resource {
  kind: "skill" | "agent" | "mcp" | "tool" | "capability";
  id: string;
  key: string;
  source: string;
  ownership: string;
  enabled: boolean;
  runtimeReady: boolean;
  available: boolean;
  eligible: boolean;
  selection: "automatic" | "approval" | "disabled";
  /** Why it is not usable, when it is not: switched-off, external, not-installed… */
  state: string;
  summary: string;
  routing: { provides: string[]; optional: string[]; signals: string[]; needs: string[]; requiresSignal: boolean };
}

export interface Problem {
  family: Family;
  why: string;
}

/** The registry exactly as src/resources/registry.mjs answers it: the families, AND its version and problems beside them. */
export type EffectiveResources = Record<Family, Resource[]> & { version: number; problems: Problem[] };

export interface RouterResources {
  version: number;
  summary: FamilySummary[];
  resources: EffectiveResources;
  problems: Problem[];
}

export interface RouteEntry {
  kind: Resource["kind"] | "requirement";
  id: string;
  key: string;
  summary: string;
  reason: string;
  requirement: string;
  /** What the session already has -- part of the decision, never a line of context. */
  implicit: boolean;
}

/** One provider the resolver weighed for one requirement, and why it could or could not be chosen. */
export interface Candidate {
  kind: Resource["kind"];
  key: string;
  id: string;
  ownership: string;
  eligible: boolean;
  selectable: boolean;
  verdict: Verdict;
  /** Table words -- the provider's own signals the task named. Never a fragment of the prompt. */
  signals: string[];
  state: string;
  why: string | null;
}

export type NodeStatus = "selected" | "approval" | "blocked" | "missing" | "unprovided" | "unknown" | "skipped";

export interface GraphNode {
  requirement: string;
  level: "required" | "conditional" | "optional";
  transitive: boolean;
  /** The requirements it serves; empty for one the task asked directly. */
  from: string[];
  /** The provider that pulled it in. */
  via: string | null;
  because: string | null;
  workflow: string | null;
  status: NodeStatus;
  provider: { kind: Resource["kind"]; key: string; id: string } | null;
  why: string | null;
  candidates: Candidate[];
}

export interface PlanStep {
  step: number;
  requirement: string;
  kind: Resource["kind"];
  key: string;
  id: string;
  approval: boolean;
  implicit: boolean;
}

export interface RouteDecision {
  version: number;
  intent: { id: string; confidence: "high" | "low" };
  /** Table words the prompt matched -- never a fragment of the prompt. */
  cues: string[];
  requirements: string[];
  graph: { nodes: GraphNode[]; cycles: string[][]; truncated: boolean };
  selected: RouteEntry[];
  approval: RouteEntry[];
  blocked: RouteEntry[];
  missing: RouteEntry[];
  plan: PlanStep[];
}

export interface Resolved {
  decision: RouteDecision;
  /** Exactly what the hook would add beside the prompt, or null for nothing. */
  context: string | null;
  executed: false;
}
