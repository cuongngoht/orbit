// The SESSION TRAIL as control-server answers it (control-server/src/trace/read.mjs,
// over src/trace/projections/). Every shape here mirrors the server's own
// allow-list: the trail holds metadata only -- no prompt text, no argument, no
// output, no path -- so there is no field for any of them to arrive in.

export type StepKind = "skill" | "agent" | "orbit" | "shell" | "tool" | "opportunity" | "decision" | "gap";

/** One thing the session did, in order. */
export interface TraceStep {
  at: string;
  kind: StepKind;
  label: string;
  ok: boolean | null;
  refused?: boolean;
}

/** Consecutive identical steps, counted: "Read ×4". */
export interface PathStep {
  kind: StepKind;
  label: string;
  ok: boolean | null;
  times: number;
}

export type FollowVerdict = "nothing-routed" | "nothing-suggested" | "followed" | "diverged" | "not-invoked";

export type TurnOutcome = "refused" | "failed" | "open" | "ok" | "unknown";

export interface Followed {
  verdict: FollowVerdict;
  say: string;
}

/** A salted fingerprint and a length -- never the prompt. */
export interface PromptFacts {
  chars: number;
  hash?: string;
}

export interface RoutedEntry {
  kind: string;
  id: string;
  requirement?: string;
}

export interface GraphNode {
  requirement: string;
  level: string;
  status: string;
  transitive: boolean;
  provider: { kind: string; id: string } | null;
}

/** What the prompt router decided -- table words and resource ids. */
export interface RoutingFacts {
  routing: "on" | "off";
  intent?: string | null;
  confidence?: string | null;
  cues?: string[];
  requirements?: string[];
  graph?: GraphNode[];
  selected?: RoutedEntry[];
  approval?: RoutedEntry[];
  blocked?: RoutedEntry[];
  missing?: RoutedEntry[];
  injected?: boolean;
}

/** What the server says it records, where, and what it never keeps. */
export interface Recording {
  where: string;
  retentionDays: number;
  switch: string;
  never: string[];
}

export interface TurnRow {
  id: string;
  session: string | null;
  project: string | null;
  at: string;
  endedAt: string | null;
  ms: number | null;
  prompt: PromptFacts | null;
  intent: string | null;
  confidence: string | null;
  routing: "on" | "off" | null;
  suggested: { kind: string; id: string }[];
  followed: Followed;
  outcome: TurnOutcome;
  steps: number;
  path: PathStep[];
}

export interface TurnsResponse {
  version: 1;
  days: number;
  recording: Recording;
  turns: TurnRow[];
}

export interface TurnDetail {
  id: string;
  session: string | null;
  project: string | null;
  at: string;
  endedAt: string | null;
  ms: number | null;
  prompt: PromptFacts | null;
  routing: RoutingFacts | null;
  steps: TraceStep[];
  path: PathStep[];
  followed: Followed;
  outcome: TurnOutcome;
}

export interface TurnResponse {
  version: 1;
  turn: TurnDetail;
}

// ---- usage analytics ---------------------------------------------------------------

export interface UsageTotals {
  sessions: number;
  turns: number;
  orbit: number;
  shell: number;
  tools: number;
  skills: number;
  agents: number;
  /** Every ratio with its denominator. */
  failed: { failed: number; of: number };
}

export interface CommandUse {
  key: string;
  id: string;
  sub: string | null;
  runs: number;
  failed: number;
  sessions: number;
  last: string;
}

export interface ShellUse {
  key: string;
  class: string;
  exe: string | null;
  runs: number;
  failed: number;
  sessions: number;
  last: string;
}

export interface SkillUse {
  id: string;
  invoked: number;
  refused: number;
  commands: number;
  failed: number;
}

export interface Transition {
  from: string;
  to: string;
  count: number;
}

export interface CommonPath {
  path: string;
  turns: number;
}

export interface FailureUse {
  label: string;
  failed: number;
  of: number;
  followedBy: { label: string; count: number }[];
}

export interface Privilege {
  unused: { skill: string; rule: string }[];
  unapproved: { skill: string; command: string }[];
  note: string;
}

export interface UsageResponse {
  version: 1;
  days: number;
  recording: Recording;
  window: { from: string | null; to: string | null; events: number };
  totals: UsageTotals;
  commands: CommandUse[];
  shell: ShellUse[];
  skills: SkillUse[];
  transitions: Transition[];
  paths: CommonPath[];
  failures: FailureUse[];
  privilege: Privilege;
}
