// Which DECLARED check verifies changes where, from a TASK that completed on its own proof (1.8.9).
//
// A finished engineering task keeps what no session's working set can: which declared check -- by its component and
// the name the project gave it -- passed AFTER the task's last change, and which scopes that change touched, each read
// back by the engine from the workspace and the check's own receipt, never typed by a host. So one completed task can
// say "changes there were verified by this component's declared test", as an observation of one task: possible,
// observed, and nothing a rule may rest on until independent sessions agree.
//
// Nothing from a task that did not complete, a check that failed (a failure as before included), or a check that was
// only reported: src/engineering/observe/task.mjs hands those in empty, and with nothing to stand on this proposes
// nothing. Names and outcomes only -- never a file's contents, never a command line.
export const MAX_VERIFIED = 6;
export const MAX_SCOPES = 8;

export function verified(input) {
  const checks = (input.verified ?? []).slice(0, MAX_VERIFIED);
  const scopes = [...new Set(input.verifiedScopes ?? [])].sort().slice(0, MAX_SCOPES);
  if (!checks.length || !scopes.length) return { candidates: [], unknowns: [] };
  return { candidates: checks.map((c) => candidate(c, scopes)), unknowns: [] };
}

const slug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "root";

const candidate = (c, scopes) => ({
  kind: "workflow",
  key: `verified-by-${slug(c.purpose)}-${slug(c.component)}-${slug(c.declaredAs)}`,
  statement: `a change here is verified by ${c.component}'s declared ${c.purpose} check (${c.declaredAs})`,
  scope: scopes,
  evidence: scopes,
  source: "test-suite",
  strength: "observed",
  because: `an engineering task completed on its own proof, and this declared ${c.purpose} check passed after its last change`,
  unknowns: ["whether every change there must pass it — that is a rule, and rules are adopted, not observed", "which cases ran — only the check's id and how it ended are kept"],
});
