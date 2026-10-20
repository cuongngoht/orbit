// What control-server/src/autonomous-qa/ answers, as the page reads it. The
// shapes mirror src/investigation/settings.mjs and src/report/investigation.mjs;
// the server is the source of truth, and it validates every write.

export type ModeId = "observe" | "explore-write" | "security-test" | "regression";
export type EnvironmentKind = "test" | "staging" | "development" | "production";

export interface Environment {
  id: string;
  origin: string;
  kind: EnvironmentKind;
  modes: ModeId[];
}

export interface Limits {
  actions: number;
  requestsPerAction: number;
  minutes: number;
  pollSeconds: number;
  decisions: number;
  noProgress: number;
}

export interface NetworkSettings {
  details: boolean;
  fingerprints: boolean;
  correlationHeaders: string[];
  idempotencyHeaders: string[];
  ignoreFields: string[];
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface AqaSettings {
  enabled: boolean;
  environments: Environment[];
  identities: string[];
  limits: Limits;
  network: NetworkSettings;
  duplicates: { [list: string]: JsonValue };
  consistency: { [timing: string]: number };
  tenancy: JsonValue;
  reports: { internal: boolean };
  memory: { project: boolean };
}

export interface Mode {
  id: ModeId;
  mutates: boolean;
  crossIdentity: boolean;
  production: boolean;
  say: string;
}

export interface Blocker {
  id: string;
  stop: "refused" | "blocked";
  say: string;
}

export type Outcome = "CONFIRMED_DEFECT" | "SUSPECTED_DEFECT" | "REQUIRES_REQUIREMENT" | "INCONCLUSIVE" | "BLOCKED" | "OBSERVED_EXPECTED_BEHAVIOR";

export type Lifecycle = "active" | "paused" | "completed" | "cancelled";

export type InputMode = "screen" | "pbi" | "hybrid";

export interface InvestigationSummary {
  id: string;
  at: string | null;
  objective: string;
  mode: ModeId | null;
  environment: string | null;
  actions: number;
  findings: Partial<Record<Outcome, number>>;
  cancelled: boolean;
  lifecycle: Lifecycle;
  stop: string | null;
  inputMode: InputMode;
  openQuestions: number;
}

export interface AqaOverview {
  available: true;
  version: number;
  project: { name: string; root: string };
  settings: AqaSettings;
  revision: string | null;
  exists: boolean;
  unreadable: string | null;
  modes: Mode[];
  switchedOn: boolean;
  blockers: { environment: string | null; blockers: Blocker[] }[];
  investigations: InvestigationSummary[];
}

export interface Unavailable {
  available: false;
  why: string;
}

export interface Saved {
  saved: AqaSettings & { revision: string };
}

export interface ReportPage {
  version: number;
  html: string;
}
