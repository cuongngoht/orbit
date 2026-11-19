// What the Orbit panel shows, read back from Orbit's own commands (`live status`, `task show`,
// `autonomous-engineering context`). Every word below is Orbit's: the API copies lifecycles, stages, check states,
// evidence levels and completion rows as Orbit printed them, and decides nothing of its own. Where Orbit has not
// spoken (no seated checkout, no task, no verdict) the panel says `unknown` -- never a pass.

export type OrbitAvailability = "available" | "not_seated" | "unavailable";

// `verified` only when Orbit itself says so (its work evidence level `verified`, or a task it COMPLETED -- which it
// does only when every completion row holds); `not_verified` only when Orbit reports a FAILED task, a violated
// verification row or a regressed check; `unknown` otherwise.
export type OrbitVerdictWord = "verified" | "not_verified" | "unknown";

export interface OrbitVerdict {
  word: OrbitVerdictWord;
  label: string;
  // Which of Orbit's fields decided the word (e.g. "task lifecycle = COMPLETED"), or why nothing could.
  source: string;
}

export interface OrbitTaskView {
  id: string;
  objective: string | null;
  lifecycle: string | null;
  stage: string | null;
  stopReason: string | null;
  attempt: number | null;
  attemptLimit: number | null;
  terminal: boolean;
  revision: number | null;
  changedFiles: number | null;
}

export interface OrbitWorkView {
  lifecycle: string | null;
  evidence: string | null;
  evidenceSays: string | null;
  liveness: string | null;
}

// A check the change is held to (verificationPlan.required), in Orbit's words.
export interface OrbitCheckView {
  id: string;
  purpose: string | null;
  component: string | null;
  declaredAs: string | null;
  state: string;
}

export interface OrbitVerificationRow {
  obligation: string;
  state: string;
  evidence: string | null;
}

export interface OrbitCompletionRow {
  id: string;
  says: string;
}

export interface OrbitApprovalView {
  id: string;
  title: string | null;
  boundary: string | null;
  state: string;
  risk: string | null;
  destructive: boolean;
  expires: string | null;
}

// A command the session ran that Orbit's hooks observed and recognised as a check (by its words).
export interface OrbitSessionCheck {
  at: string | null;
  kind: string | null;
  program: string | null;
  ok: boolean | null;
}

export interface OrbitFailureView {
  failureClass: string | null;
  command: string | null;
  excerpt: string[];
}

export interface OrbitPanel {
  state: OrbitAvailability;
  reason: string | null;
  checkedAt: string;
  association: { how: string; taskId: string | null } | null;
  presentation: string | null;
  task: OrbitTaskView | null;
  work: OrbitWorkView | null;
  planWord: string | null;
  checks: OrbitCheckView[];
  missing: string[];
  verification: OrbitVerificationRow[];
  // Unmet completion rows; null when Orbit is not at its review stage.
  completion: OrbitCompletionRow[] | null;
  approvals: OrbitApprovalView[];
  sessionChecks: OrbitSessionCheck[];
  failure: OrbitFailureView | null;
  stop: { id: string; says: string } | null;
  verdict: OrbitVerdict;
}

export const UNKNOWN_VERDICT = (source: string): OrbitVerdict => ({ word: "unknown", label: "Unknown", source });
