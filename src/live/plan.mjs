// What a viewer reads of a coordinated workflow's PLAN (1.8.6, ADR 0022): each step with where it stands, how much of
// the plan is DONE on its own contract, every revision and why, and what the skill factory is doing for each
// capability it drafts. Pure: the plan is the projection its source made (src/automation/source.mjs, handed in by a
// composition root), where each step stands is the step's own receipt in the task's journal, and nothing here reads
// a file. With no projection -- a task from before 1.8.6, an artifact gone -- the steps and the revisions are read off
// the receipts the coordinator wrote, and what those cannot say is said to be unknown.
//
//   stepsOf(plan, view) -> [{ id, kind, after, for, because, strict, outcome, action, summary, at }]
//   progressOf(steps) -> { done, verified, reported, total } | null     done on each step's own contract
//   replansOf(plan, view) -> [{ n, trigger, response, step, summary }]
//   skillsOf(plan, view) -> [{ capability, drafted, checked, registered, followed, pin, reused, summary }]
const receiptsOf = (view, domain) => (view?.receipts ?? []).filter((r) => r.domain === domain);

const stepReceipt = (view, id) => receiptsOf(view, "step").find((r) => r.ref === id) ?? null;

const PLAN = /(\d+) step\(s\): (.+)$/;

// A step a receipt names when the plan cannot be read: its id is all that is known.
const fromReceipts = (view) => ((m) => [...new Set([...(m ? m[2].split(",").map((s) => s.trim().replace(/…$/, "")).filter(Boolean) : []), ...receiptsOf(view, "step").map((r) => r.ref)])].map((id) => ({ id, kind: id.split(".")[0], after: [], for: null, because: null, strict: null })))(PLAN.exec(receiptsOf(view, "plan").filter((r) => r.outcome === "ACTIVE").at(-1)?.summary ?? ""));

const withState = (view) => (s) => ((r) => ({ ...s, outcome: r?.outcome ?? "PENDING", action: r?.action ?? null, summary: r?.summary ?? null, at: r?.at ?? null }))(stepReceipt(view, s.id));

export const stepsOf = (plan, view) => (plan?.steps?.length ? plan.steps : fromReceipts(view)).map(withState(view));

// Done on its own contract (src/automation/plan.mjs doneFor): succeeded or skipped, or -- for a step whose kind may
// stand on a report -- reported. A strict step that succeeded was VERIFIED on its owner's record.
export const doneOn = (s) => ["SUCCEEDED", "SKIPPED"].includes(s.outcome) || (s.outcome === "REPORTED" && s.strict === false);

export const progressOf = (steps) => (steps.length ? { done: steps.filter(doneOn).length, verified: steps.filter((s) => s.strict === true && s.outcome === "SUCCEEDED").length, reported: steps.filter((s) => s.outcome === "REPORTED").length, total: steps.length } : null);

// ---- revisions ---------------------------------------------------------------------------------------------

const REVISED = /^plan-(\d+) \([^,)]+(?:, after ([A-Z_]+) at ([^)]+))?\)/;

const fromSummary = (r) => ((m) => (m && Number(m[1]) > 1 ? { n: Number(m[1]), trigger: m[2] ?? null, response: null, step: m[3] ?? null, summary: null } : null))(REVISED.exec(r.summary ?? ""));

export const replansOf = (plan, view) => (plan ? plan.replans ?? [] : receiptsOf(view, "plan").map(fromSummary).filter(Boolean));

// ---- the skill factory, per capability a draft is planned for ---------------------------------------------------

const ofKind = (steps, kind, capability) => steps.find((s) => s.kind === kind && (s.for ?? null) === capability) ?? null;

// The skill receipt an action of this workflow linked: the draft a draft step wrote, the version a register step
// registered -- matched by the action, so two capabilities' drafts are never confused.
const skillBy = (view, action) => (action ? receiptsOf(view, "skill").filter((r) => r.action === action).at(-1) ?? null : null);

// One capability's generation, in the order it moves: the draft written, held to the contract, registered (or the
// version in place reused), followed. A word the journal has not said yet stays null -- never filled in.
const capabilityRow = (steps, view) => (p) => {
  const reg = ofKind(steps, "register-skill", p.for ?? null);
  const play = ofKind(steps, "playbook", p.for ?? null) ?? steps.find((s) => s.kind === "playbook") ?? null;
  const draft = skillBy(view, p.action);
  const version = skillBy(view, reg?.action);
  return { capability: p.for ?? play?.for ?? play?.provides ?? null, drafted: p.outcome, checked: draft?.outcome ?? null, registered: version?.outcome ?? reg?.outcome ?? "PENDING", followed: play?.outcome ?? null, pin: version?.ref?.includes(":") ? version.ref : null, reused: /^reused: /.test(version?.summary ?? ""), summary: version?.summary ?? draft?.summary ?? null };
};

export const skillsOf = (plan, view) => ((steps) => steps.filter((s) => s.kind === "propose-skill").slice(0, 10).map(capabilityRow(steps, view)))(stepsOf(plan, view));
