// What a task LOOKS like to whoever reads it -- the CLI's --json, Orbit Control, the page -- and
// one shape for all three, so a person and an agent read the same thing.
//
// Everything here is read off the fold and the clock handed in. Readiness says only what the
// journal and the registry's last summary of the checkout say: no runtime is asked, nothing is
// probed, and what nothing says is UNKNOWN. An action Orbit holds a receipt for is `receipt`
// evidence; one only the agent reported is `reported`, and a page never shows the two alike.
import { boundaryOf } from "../protected/boundaries.mjs";
import { approvalState, stateOf } from "./model.mjs";

export const VIEW_VERSION = 1;

const headOf = (model, m = model.meta) => ({ id: m.id, project: m.project, checkout: m.checkout, objective: m.objective, work: m.work ?? null, parent: m.parent ?? null, root: m.root ?? null, snapshot: m.snapshot ?? null, snapshotDigest: m.snapshotDigest ?? null, baseRevision: model.workspace?.baseRevision ?? m.baseRevision ?? null, workspace: model.workspace?.workspace ?? m.workspace ?? null, provider: m.provider ?? null, actor: m.actor ?? null, host: m.host ?? null, createdAt: m.at, updatedAt: model.records.at(-1)?.at ?? m.at });

const numberOf = (model, id) => (id ? model.attempts.findIndex((a) => a.id === id) + 1 : null);

const limitOf = (model, k) => model.meta?.budget?.[k] ?? null;

const attemptSummary = (model, state) => ({ current: state.attempt, open: state.attempt !== null, number: numberOf(model, state.attempt) ?? state.attempts, count: state.attempts, limit: limitOf(model, "attempts") });

const budgetView = (model, state) => Object.fromEntries(["attempts", "actions", "minutes"].map((k) => [k, { spent: state.spent[k], limit: limitOf(model, k) }]));

// ---- readiness: what the journal and the registry say, first row that holds -----------------

const blockedFor = (m, stop) => m.blocked?.stop === stop;

const latestRuntime = (m) => [...m.receipts.values()].filter((r) => r.domain === "runtime").sort((a, b) => a.n - b.n).at(-1) ?? null;

const REQUIREMENT = [
  { when: (m) => blockedFor(m, "REQUIREMENT_BLOCKED"), is: (m) => ({ state: "BLOCKED", ref: m.meta.snapshot ?? m.meta.root ?? null, because: m.blocked.because ?? null }) },
  { when: (m) => Boolean(m.meta.snapshot), is: (m) => ({ state: "READY", ref: m.meta.snapshot }) },
  { when: (m) => Boolean(m.meta.root), is: (m) => ({ state: "UNKNOWN", ref: m.meta.root, because: "no snapshot of the requirement is referenced" }) },
  { when: () => true, is: () => ({ state: "UNKNOWN", ref: null }) },
];

const ENVIRONMENT = [
  { when: (m) => blockedFor(m, "ENVIRONMENT_BLOCKED"), is: (m) => ({ state: "BLOCKED", ref: null, because: m.blocked.because ?? null }) },
  { when: (m) => latestRuntime(m) !== null, is: (m) => ({ state: latestRuntime(m).outcome ?? "LINKED", ref: `runtime:${latestRuntime(m).ref}`, at: latestRuntime(m).at, source: "receipt" }) },
  { when: (m, c) => Boolean(c?.summary?.runtime), is: (m, c) => ({ state: c.summary.runtime, ref: null, at: c.lastSeen ?? null, source: "registry" }) },
  { when: () => true, is: () => ({ state: "UNKNOWN", ref: null }) },
];

const workspaceOf = (m) => m.workspace?.workspace ?? m.meta.workspace ?? null;

const WORKSPACE = [
  { when: (m) => workspaceOf(m) !== null, is: (m) => ({ state: "READY", ref: workspaceOf(m) }) },
  { when: () => true, is: () => ({ state: "UNKNOWN", ref: null }) },
];

const first = (rows, m, c) => rows.find((r) => r.when(m, c)).is(m, c);

export const readinessOf = (m, state, checkout) => ({ requirement: first(REQUIREMENT, m, checkout), environment: first(ENVIRONMENT, m, checkout), workspace: first(WORKSPACE, m, checkout), agent: { actor: m.meta.actor ?? null, stage: state.stage } });

// ---- the parts ---------------------------------------------------------------------------------

const decisionView = (d) => (d ? { id: d.id, attempt: d.attempt ?? null, at: d.at, observed: d.observed, hypothesis: d.hypothesis, nextAction: d.nextAction, evidence: d.evidence ?? [], reason: d.reason ?? null, ref: d.ref ?? null } : null);

const attemptView = (a, i) => ({ id: a.id, number: i + 1, cause: a.cause, startedAt: a.startedAt, endedAt: a.completed?.at ?? null, outcome: a.completed?.outcome ?? null, failureSignature: a.completed?.failureSignature ?? null, actions: a.actions, files: a.files.length });

const ACTION_STATES = [
  { when: (a) => !a.ended, state: () => "running" },
  { when: (a) => a.ended.kind === "action-failed", state: () => "error" },
  { when: () => true, state: (a) => a.ended.outcome ?? "ended" },
];

const actionState = (a) => ACTION_STATES.find((r) => r.when(a)).state(a);

const receiptsFor = (m, a) => [...m.receipts.entries()].filter(([key, r]) => r.action === a.id || key === a.ended?.receipt || r.ref === a.ended?.receipt).map(([key]) => key);

function actionView(m, a) {
  const receipts = receiptsFor(m, a);
  return { id: a.id, attempt: a.attempt ?? null, type: a.type, tool: a.tool ?? null, label: a.label ?? null, mutates: a.mutates === true, approval: a.approval ?? null, startedAt: a.startedAt, endedAt: a.ended?.at ?? null, state: actionState(a), summary: a.ended?.summary ?? null, reason: a.ended?.reason ?? null, receipts, evidence: receipts.length ? "receipt" : "reported" };
}

const mergedFile = (was, f) => ({ path: f.path, change: f.change, added: (was?.added ?? 0) + (f.added ?? 0), removed: (was?.removed ?? 0) + (f.removed ?? 0), attempts: [...new Set([...(was?.attempts ?? []), f.attempt].filter(Boolean))], at: f.at });

const total = (rows, k) => rows.reduce((n, r) => n + r[k], 0);

// What changed, by repository-relative path: a file changed in three attempts is one file.
function changesView(files) {
  const paths = [...files.reduce((byPath, f) => byPath.set(f.path, mergedFile(byPath.get(f.path), f)), new Map()).values()];
  return { files: paths.length, added: total(paths, "added"), removed: total(paths, "removed"), paths };
}

// A run's receipts (0.0.4) carry what they rest on -- a pin, a provider's key, digests, what the call did -- and say so
// only when they do, so every other receipt reads exactly as it did.
const RUN_FIELDS = ["pin", "providerKey", "queryDigest", "resultDigest", "operation"];

const runFieldsOf = (r) => Object.fromEntries(RUN_FIELDS.filter((k) => r[k] !== undefined).map((k) => [k, r[k]]));

const receiptsView = (m) => [...m.receipts.entries()].map(([key, r]) => ({ key, domain: r.domain, ref: r.ref, outcome: r.outcome ?? null, summary: r.summary ?? null, action: r.action ?? null, environment: r.environment ?? null, sourceTree: r.sourceTree ?? null, ...runFieldsOf(r), at: r.at }));

const verificationView = (m) => [...m.verifications.values()].map((v) => ({ subject: v.subject ?? null, obligation: v.obligation, evidence: v.evidence ?? null, state: v.state, at: v.at }));

const DECISION_WORD = { "approval-granted": "granted", "approval-rejected": "rejected" };

// Which protected boundary an approval guards, when it says (src/protected/): its title and what a person reads. An
// approval from before 0.2.0 says none, and reads as it always did.
const boundaryView = (a) => ({ boundary: a.boundary ?? null, title: boundaryOf(a.boundary)?.title ?? null, destructive: a.destructive === true, shows: a.shows ?? null });

// What became of the action an approval let start: running, or how it ended -- the "executing / completed / failed" a
// viewer says of a protected action, read off the same fold.
const outcomeOf = (m, a) => ((act) => (act ? actionState(act) : null))(a.consumed ? m.actions.get(a.consumed.action) : null);

function approvalView(m, a, now) {
  const state = approvalState(a, now);
  return { id: a.id, action: a.action, environment: a.environment ?? null, reason: a.reason ?? null, risk: a.risk ?? null, attempt: a.attempt ?? null, requestedAt: a.requestedAt, expires: a.expires ?? null, state, open: !m.ended && state === "pending", decision: DECISION_WORD[a.decision?.kind] ?? null, decidedAt: a.decision?.at ?? null, decidedBy: a.decision?.by ?? null, consumedBy: a.consumed?.action ?? null, consumedAt: a.consumed?.at ?? null, ...boundaryView(a), outcome: outcomeOf(m, a) };
}

const pausedView = (m) => (m.paused ? { at: m.paused.at, by: m.paused.by ?? null, because: m.paused.because ?? null } : null);

const blockedView = (m) => (m.blocked ? { at: m.blocked.at, stop: m.blocked.stop, needs: m.blocked.needs ?? null, because: m.blocked.because ?? null } : null);

const endedView = (m) => (m.ended ? { kind: m.ended.kind, at: m.ended.at, stop: m.ended.stop ?? null, summary: m.ended.summary ?? null, because: m.ended.because ?? null, by: m.ended.by ?? null } : null);

// The whole task, as of `now`. `checkout` is the registry's entry for its checkout, when known.
export function taskView(model, now, checkout = null) {
  const state = stateOf(model, now);
  return { version: VIEW_VERSION, task: headOf(model), revision: model.position, lifecycle: state.lifecycle, terminal: state.ended, stage: state.stage, stopReason: state.stop, attempt: attemptSummary(model, state), repeats: state.repeats, budget: budgetView(model, state), readiness: readinessOf(model, state, checkout), paused: pausedView(model), blocked: blockedView(model), decision: decisionView(model.decisions.at(-1)), decisions: model.decisions.map(decisionView), attempts: model.attempts.map(attemptView), actions: [...model.actions.values()].map((a) => actionView(model, a)), changes: changesView(model.files), receipts: receiptsView(model), verification: verificationView(model), approvals: [...model.approvals.values()].map((a) => approvalView(model, a, now)), ended: endedView(model) };
}

// The journal itself, from a position on: what a timeline is drawn from, and what a page that
// already holds the first n lines asks for next.
export function eventsView(model, since = 0) {
  const from = Math.min(Math.max(0, Number.isInteger(since) ? since : 0), model.position);
  return { version: VIEW_VERSION, task: model.meta.id, revision: model.position, since: from, events: model.records.slice(from).map((r, i) => ({ n: from + i, ...r })) };
}
