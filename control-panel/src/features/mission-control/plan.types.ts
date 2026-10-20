// A coordinated workflow's PLAN, as control-server serves it (0.0.4): the ONE projection every viewer draws -- the
// live core's own `planViewOf` (src/live/plan.mjs), computed by the server from the task's journal, the plan artifact
// and the pinned skill. The page shows it as it is; it derives no state of its own.

export interface PlanStep {
  id: string;
  kind: string;
  after: string[];
  for: string | null;
  because: string | null;
  /** VERIFIED · DONE · REPORTED · RUNNING · FAILED · BLOCKED · SKIPPED · PENDING -- each earned by its receipt. */
  state: string;
  summary: string | null;
  at: string | null;
}

export interface SkillRunStep {
  id: string;
  capability: string | null;
  tool: string | null;
  required: boolean | null;
  evidence: string | null;
  approval: string | null;
  /** The word the step's own `skillstep` receipt carries, or PENDING when none was written. */
  word: string;
  because: string | null;
  provider: string | null;
  action: string | null;
  startedAt: string | null;
  endedAt: string | null;
  calls: number;
  retries: number;
  waiting: string | null;
  verification: { state: string; evidence: string | null } | null;
  receipt: string | null;
  invocation: string | null;
}

export interface SkillRun {
  run: string;
  pin: string | null;
  step: string | null;
  /** The run's own receipt word: RUNNING until it settles, then VERIFIED · REPORTED · FAILED · BLOCKED · INTERRUPTED. */
  word: string;
  /** Where it stands: BINDING · RUNNING · VERIFYING while open, else its word. */
  state: string;
  /** Its pinned workflow could not be read: the steps are the ones its receipts name. */
  unread: boolean;
  steps: SkillRunStep[];
  calls: number;
  at: string | null;
  summary: string | null;
}

export interface PlanView {
  ref: string | null;
  n: number | null;
  workflow: string | null;
  readable: boolean;
  goal: { goal: string; unit: string | null } | null;
  steps: PlanStep[];
  progress: { done: number; verified: number; reported: number; total: number } | null;
  replans: { n: number; trigger: string | null; response: string | null; step: string | null; summary: string | null }[];
  runs: SkillRun[];
}

export interface PlanResponse {
  task: string;
  revision: number | null;
  terminal: boolean;
  plan: PlanView | null;
}
