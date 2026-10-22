// The FOLD: a mission's journal, line by line, into one model. Pure and incremental -- `foldInto(model, record)` is the
// only way a line changes a model, and `modelOf(records)` is that, from an empty model. So a page that read the whole
// file and a viewer that followed it line by line hold the SAME model at the same line (test/projection.test.mjs).
//
// Every line is kept with its index `n`: a unit's reset, a run, an evidence row are compared by where they sit in the
// journal, never by a clock. A kind the table does not fold is counted and otherwise left alone.
import { STATUS_OF_KIND } from "../execution/vocab.mjs";

export function emptyModel() {
  return { meta: null, position: 0, counts: {}, lastAt: null, intent: null, plans: [], units: new Map(), keys: new Map(), roles: new Map(), templates: new Map(), skills: new Map(), drafts: new Map(), workflows: new Map(), factory: [], runs: new Map(), actions: new Map(), decisions: new Map(), handoffs: new Map(), evidence: new Map(), permissions: [], replans: [], checkpoints: [], recoveries: [], tools: { lines: 0, byRun: {}, eids: new Set() }, verification: null, ended: null };
}

export function foldInto(m, r) {
  const n = m.position;
  FOLDS[r.kind]?.(m, r, n);
  m.counts[r.kind] = (m.counts[r.kind] ?? 0) + 1;
  m.lastAt = r.at ?? m.lastAt;
  return Object.assign(m, { position: n + 1 });
}

export const modelOf = (records) => (records ?? []).reduce(foldInto, emptyModel());

const unitOf = (m, id) => m.units.get(id) ?? null;

const runOf = (m, id) => m.runs.get(id) ?? null;

// An action's status moves with the line that moved it; what that line said is kept under the status it set.
function moved(m, r, n) {
  const a = m.actions.get(r.id);
  if (!a) return;
  Object.assign(a, { status: STATUS_OF_KIND[r.kind], [r.kind.slice(7)]: { ...r, n } });
  return a;
}

// A NESTED action (one an agent run started under its own) puts its mode on top of the run's stack while it is open;
// when it closes the run's own mode shows again -- never a global "current mode".
function pushed(m, a) {
  const run = a?.agentRun && a.parentAction ? runOf(m, a.agentRun) : null;
  if (run) run.stack.push({ action: a.id, mode: a.mode });
}

function popped(m, a) {
  const run = a?.agentRun ? runOf(m, a.agentRun) : null;
  if (run) run.stack = run.stack.filter((s) => s.action !== a.id);
}

const opened = (m, r, n) => pushed(m, moved(m, r, n));

const closed = (m, r, n) => popped(m, moved(m, r, n));

function proposed(m, r, n) {
  m.actions.set(r.id, { ...r, n, status: STATUS_OF_KIND[r.kind] });
  if (r.decision) m.decisions.set(r.decision, r.id);
}

function unitCreated(m, r, n) {
  m.units.set(r.id, { ...r, n, kind: r.unitKind, rolePin: null, templatePin: null, skillPins: [], resetAt: n, cancelled: null, skipped: null });
  m.keys.set(r.key, r.id);
}

function unitUpdated(m, r, n) {
  const u = unitOf(m, r.id);
  if (!u) return;
  Object.assign(u, Object.fromEntries(["rolePin", "templatePin", "skillPins"].filter((k) => r[k] !== undefined).map((k) => [k, r[k]])));
  if (r.reset) u.resetAt = n;
}

const marked = (field) => (m, r, n) => ((u) => u && Object.assign(u, { [field]: { ...r, n } }))(unitOf(m, r.id));

const factoryLine = (room) => (m, r, n) => {
  m.factory.push({ ...r, n });
  if (r.pin) m[room].set(r.pin, { ...(m[room].get(r.pin) ?? {}), ...r, n });
};

const runLine = (field) => (m, r, n) => ((run) => run && Object.assign(run, { [field]: { ...r, n }, ...(r.providerRef ? { providerRef: r.providerRef } : {}) }))(runOf(m, r.id));

function evidenceLinked(m, r, n) {
  m.evidence.set(r.id, { ...r, n });
  const a = r.verified ? m.actions.get(r.action) : null;
  if (a && a.status === "RESULT_RECORDED") a.status = "EVIDENCE_VERIFIED";
}

const handoffLine = (field) => (m, r, n) => ((h) => h && h[field].push({ ...r, n }))(m.handoffs.get(r.id));

function toolObserved(m, r, n) {
  if (!r.eid || m.tools.eids.has(r.eid)) return;
  m.tools.eids.add(r.eid);
  m.tools.lines += 1;
  m.tools.byRun[r.agentRun ?? "session"] = [...(m.tools.byRun[r.agentRun ?? "session"] ?? []), { ...r, n }];
}

const ended = (m, r, n) => {
  m.ended ??= { ...r, n };
};

const FOLDS = {
  "mission.created": (m, r, n) => Object.assign(m, { meta: { ...r, n } }),
  "intent.recorded": (m, r, n) => Object.assign(m, { intent: { ...r, n } }),
  "plan.revised": (m, r, n) => m.plans.push({ ...r, n }),
  "unit.created": unitCreated,
  "unit.updated": unitUpdated,
  "unit.cancelled": marked("cancelled"),
  "unit.skipped": marked("skipped"),
  "role.reused": factoryLine("roles"),
  "role.validated": factoryLine("roles"),
  "role.generated": factoryLine("roles"),
  "role.registered": factoryLine("roles"),
  "role.rejected": factoryLine("roles"),
  "template.reused": factoryLine("templates"),
  "template.generated": factoryLine("templates"),
  "template.registered": factoryLine("templates"),
  "skill.discovered": factoryLine("skills"),
  "skill.reused": factoryLine("skills"),
  "skill.generated": (m, r, n) => (factoryLine("skills")(m, r, n), m.drafts.set(r.draft, { ...r, n })),
  "skill.written": factoryLine("skills"),
  "skill.validated": factoryLine("skills"),
  "skill.registered": factoryLine("skills"),
  "skill.invoked": factoryLine("skills"),
  "workflow.reused": factoryLine("workflows"),
  "workflow.validated": factoryLine("workflows"),
  "workflow.generated": factoryLine("workflows"),
  "workflow.registered": factoryLine("workflows"),
  "agentrun.created": (m, r, n) => m.runs.set(r.id, { ...r, n, startedBy: null, started: null, reported: null, ended: null, providerRef: null, stack: [] }),
  "agentrun.started": runLine("started"),
  "agentrun.reported": runLine("reported"),
  "agentrun.ended": runLine("ended"),
  "action.proposed": proposed,
  "action.refused": closed,
  "action.intended": opened,
  "action.accepted": moved,
  "action.observed": moved,
  "action.recorded": closed,
  "action.ambiguous": closed,
  "permission.evaluated": (m, r, n) => m.permissions.push({ ...r, n }),
  "permission.denied": (m, r, n) => m.permissions.push({ ...r, n }),
  "handoff.published": (m, r, n) => m.handoffs.set(r.id, { ...r, n, consumed: [], rejected: [] }),
  "handoff.consumed": handoffLine("consumed"),
  "handoff.rejected": handoffLine("rejected"),
  "evidence.linked": evidenceLinked,
  "verification.derived": (m, r, n) => Object.assign(m, { verification: { ...r, n } }),
  "replan.triggered": (m, r, n) => m.replans.push({ ...r, n }),
  "mission.completed": ended,
  "mission.reported": ended,
  "mission.failed": ended,
  "mission.cancelled": ended,
  "checkpoint.written": (m, r, n) => m.checkpoints.push({ ...r, n }),
  "recovery.reconciled": (m, r, n) => m.recoveries.push({ ...r, n }),
  "tool.observed": toolObserved,
};

export const FOLDED_KINDS = Object.freeze(Object.keys(FOLDS));
