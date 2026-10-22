// What control-server/src/autonomous-qa/ answers, as the page reads it. The
// shapes mirror src/investigation/settings.mjs and src/report/investigation.mjs;
// the server is the source of truth, and it validates every write.

export type ModeId = "observe" | "explore-write" | "security-test" | "regression" | "fixture-write";
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
  obligations: number;
  designs: number;
  repairs: number;
  attempts: number;
  writes: number;
  caseSeconds: number;
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

// ── generated tests (0.1.0) ─────────────────────────────────────────────────
// One generated test, as src/investigation/model.mjs testsOf folds the journal: the obligation (every revision, the
// current one last), the designs made for it with their frozen versions, each version's execution attempts, and what
// every attempt came to. The words are the engine's verification outcomes, never a PASS or a FAIL.

export interface ObligationRevision {
  obligation: string;
  revision?: string;
  digest?: string;
  shape: string;
  target: string | null;
  authority: string | null;
  method?: string | null;
}

export interface TestEvaluation {
  id: string;
  execution: string;
  attempt: number;
  outcome: string;
  cause: string | null;
  runner?: string | null;
  result?: string | null;
}

export interface TestRun {
  id: string;
  status: string;
  proved?: { [layer: string]: number } | null;
  evidence?: string | null;
}

export interface TestExecution {
  execution: string;
  attempt: number;
  version: string;
  runs: TestRun[];
  evaluations: TestEvaluation[];
}

export interface TestVersion {
  version: string;
  case: string;
  digest: string;
  design: string;
  validations: { state: string; findings?: string | null }[];
  executions: TestExecution[];
}

export interface TestDesign {
  design: string;
  digest?: string | null;
  state: string;
  why?: string | null;
  versions: TestVersion[];
}

export interface GeneratedTest {
  obligation: string;
  current: ObligationRevision;
  revisions: ObligationRevision[];
  designs: TestDesign[];
  evaluations: TestEvaluation[];
}

export interface TestsView {
  version: number;
  investigation: string;
  tests: GeneratedTest[];
}

export interface ArtifactView {
  version: number;
  investigation: string;
  kind: string;
  digest: string;
  artifact: JsonValue;
}

export interface VersionView {
  version: number;
  investigation: string;
  record: { version: string; case: string; digest: string };
  frozen: JsonValue;
}
