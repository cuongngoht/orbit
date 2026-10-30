// The shapes control-server answers for AUTONOMOUS IMPROVEMENT (0.3.0, ADR 0045): the campaign projection is the one
// `improve show` prints and Orbit Live draws (src/improvement/views.mjs). A value the engine could not measure is null.
export type SettingValue = boolean | number | string | null;

export interface ImprovementMetric {
  id: string;
  say: string;
  numerator: number | null;
  denominator: number | null;
  value: number | null;
  unit: "ratio" | "count" | "delta";
  because: string | null;
}

export interface CampaignRow {
  id: string;
  phase: string;
  subject: string | null;
  pin: string | null;
  candidate: string | null;
  signal: string | null;
  outcome: string | null;
  carrier: string;
  revision: number;
  lastAt: string | null;
}

export interface ImprovementField {
  key: string;
  path: string;
  type: "boolean" | "integer" | "enum";
  values: string[] | null;
  min: number | null;
  max: number | null;
  default: SettingValue;
  narrow: string;
  say: string;
}

export interface ImprovementSettings {
  fields: ImprovementField[];
  values: Record<string, SettingValue>;
  by: Record<string, string>;
  revision: string | null;
  machineRevision: string | null;
}

export interface ImprovementOverview {
  version: number;
  project: string;
  settings: ImprovementSettings;
  analysed: { at: string; groups?: number; eligible?: number; started?: number } | null;
  phases: Record<string, number>;
  opportunities: { total: number; eligible: number; unreadable: number };
  campaigns: CampaignRow[];
  metrics: ImprovementMetric[];
}

export interface Opportunity {
  id: string;
  unreadable?: string;
  subject?: { kind: string; id: string };
  pin?: string;
  signal?: string;
  category?: string;
  signature?: string[];
  runs?: number;
  sessions?: number;
  against?: number;
  eligible?: boolean;
  check?: string;
  because?: string;
  missing?: string[];
  cause?: string;
  confidence?: string;
  campaign?: string | null;
  environment?: string[];
  limitations?: string[];
  attribution?: { bound: number; of: number; words: string[] };
  lastSeen?: string | null;
}

export interface EvaluationSide {
  runs: number;
  met: number;
  verified: number;
  failing: number;
  blocked: number;
  retries: number;
  calls: number;
  ms: number | null;
}

export interface Ratio {
  id: string;
  numerator: number;
  denominator: number;
  value: number | null;
}

export interface Evaluation {
  evaluation: string;
  task: string | null;
  at: string;
  session: string | null;
  host: string | null;
  baseline: string;
  candidate: string;
  planned: number | null;
  recorded: number;
  links: { mission: string; side: string }[];
  open: boolean;
  verdict: string | null;
  because: string | null;
  regressions: string[];
  metrics: { baseline: EvaluationSide; candidate: EvaluationSide; delta: { calls: number | null; retries: number | null; ms: number | null }; ratios: Ratio[]; unknown: { id: string; because: string }[] } | null;
  attribution: string[];
}

export interface CampaignEvent {
  event: string;
  campaign: string;
  n: number;
  at: string;
  verdict?: string;
  outcome?: string;
  stop?: string;
  mode?: string;
  door?: string;
  by?: string;
  from?: string;
  to?: string;
}

export interface Campaign {
  id: string;
  revision: number;
  phase: string;
  say: string | null;
  carrier: string;
  mode: string;
  subject: { kind: string | null; id: string | null };
  pin: string | null;
  opportunity: string | null;
  signal: string | null;
  category: string | null;
  signature: string[];
  evidence: string[];
  sessions: number | null;
  runs: number | null;
  diagnosis: { cause: string; confidence: string; hypothesis?: string; supporting?: string[]; contradicting?: string[]; unknowns?: string[]; risk?: string; test?: string; expected?: string } | null;
  proposal: { strategy?: string; change?: string; expected?: string } | null;
  candidate: { id: string; pin: string; digest: string; successorOf: string | null; reused: boolean; changed: string[]; at: string | null } | null;
  evaluations: Evaluation[];
  open: string | null;
  aggregate: { verdict: string; because: string; sessions: number; evaluations: number } | null;
  gates: { rows: { id: string; holds: boolean }[]; failed: string | null; at: string | null } | null;
  awaiting: string | null;
  promotion: { from: string; to: string; door: string; by: string; at: string } | null;
  observations: { word: string; runs: number; sessions: number; because?: string; at?: string }[];
  regression: { runs?: number; sessions?: number; because?: string; evidence?: string[]; at?: string } | null;
  rollback: { state: string; from: string; to: string; door: string; at: string } | null;
  blocked: { stop: string; needs: string | null; because: string | null; at: string } | null;
  rejected: { reason: string; because?: string; by?: string } | null;
  ended: { outcome: string; because: string | null; at: string } | null;
  learned: { lesson?: string; state?: string; kept: boolean; because?: string } | null;
  lastAt: string | null;
  events: CampaignEvent[];
}

export interface CampaignResponse {
  version: number;
  project: string;
  campaign: Campaign;
}

export type Decision = "promote" | "revert" | "reject";
