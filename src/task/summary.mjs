// A task as ONE ROW of the machine-wide view: what a person scanning many projects needs to see
// -- where it stands, why it is not going on, which attempt, and what waits for them -- taken
// from the same view a task page shows, so a row and its page cannot disagree.

const approvalBrief = (a) => ({ id: a.id, action: a.action, environment: a.environment, reason: a.reason, risk: a.risk, attempt: a.attempt, requestedAt: a.requestedAt, expires: a.expires });

const decisionBrief = (d) => (d ? { observed: d.observed, nextAction: d.nextAction, at: d.at } : null);

export function summaryOf(view) {
  const t = view.task;
  return { id: t.id, project: t.project, checkout: t.checkout, objective: t.objective, work: t.work, parent: t.parent ?? null, provider: t.provider ?? null, root: t.root, snapshot: t.snapshot, actor: t.actor, revision: view.revision, lifecycle: view.lifecycle, terminal: view.terminal, stage: view.stage, stopReason: view.stopReason, attempt: view.attempt, actions: view.budget.actions, running: view.actions.filter((a) => a.state === "running").length, decision: decisionBrief(view.decision), approvals: view.approvals.filter((a) => a.open).map(approvalBrief), createdAt: t.createdAt, updatedAt: t.updatedAt, endedAt: view.ended?.at ?? null };
}
