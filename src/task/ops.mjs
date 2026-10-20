// The ONE write door of a task: every line after its first is written by `apply`, and its first
// by `createTask`. Nothing else under src/ appends to a task journal.
//
//   apply(ctx, task, op, given)   under the task's lock: read the journal, fold it, judge the op's
//                                 rules (src/task/rules.mjs), append its lines -- or refuse and
//                                 write nothing
//   createTask(ctx, given)        under the project's tasks lock: refuse a second ACTIVE task for
//                                 the same work and checkout, then write the first line
//
// `ctx`: { tasks (src/task/store.mjs), project, checkout, session, now, door? }. `door` is the
// composition root's word for itself: "control" only where Orbit Control has checked the page's
// mutation token, and never a value anything typed can set. The lock is held only
// for the read-judge-append, never across anything an agent does: a task records what happened,
// it does not do it.
//
// Each op's `phase` decides what the lifecycle allows (rules.mjs PHASES); `human` marks a
// person's decision, which must carry --human and the revision it was made on; `required` and
// `optional` are the only fields it takes; `lines` says what it writes.
import { Refused } from "../errors.mjs";
import { short } from "../hash.mjs";
import { printable } from "../printable.mjs";
import { ASKING, CONSUMING, DECIDING, EXPIRING, fingerprintOf } from "./approvals.mjs";
import { ATTEMPT_OUTCOME, RECEIPT_REF } from "./fields.mjs";
import { loadTask } from "./load.mjs";
import { modelOf, nextId, stateOf } from "./model.mjs";
import { ACTION_KNOWN, ACTION_OPEN, BUDGET_ACTIONS, BUDGET_ATTEMPTS, BUDGET_MINUTES, EVIDENCE_KNOWN, EVIDENCE_LIMIT, FIELD_RULES, HUMAN, IS_BLOCKED, PERSON, IS_PAUSED, NO_OPEN_ATTEMPT, NOT_YET_PAUSED, OPEN_ATTEMPT, PATH, PHASES, PROVEN_NEEDS_RECEIPT, RECEIPT_KNOWN, REFS, STALE, STILL_RUNNING, TEXT, UNFINISHED_ATTEMPT } from "./rules.mjs";
import { CODES, FREE_TEXT, TASK_SCHEMA } from "./vocab.mjs";

const current = (w) => w.model.current?.id ?? null;

function actionStarted(g, w) {
  const id = nextId(w.model, "action-started");
  const started = ["action-started", { id, attempt: current(w), type: g.type, tool: g.tool, label: g.label, fingerprint: fingerprintOf(g), approval: g.approval, mutates: g.mutates }];
  return g.approval ? [["approval-consumed", { id: g.approval, action: id, fingerprint: fingerprintOf(g) }], started] : [started];
}

const byPerson = (kind) => (g, w, ctx) => [[kind, { by: "person", session: ctx.session, seen: g.expected, because: g.because }]];

const decided = (kind) => (g, w, ctx) => [[kind, { id: g.approval, by: "person", session: ctx.session, seen: g.expected, reason: g.reason }]];

export const OPS = {
  stage: { phase: "start", required: ["stage"], optional: ["because"], lines: (g) => [["stage", { stage: g.stage, because: g.because }]] },
  "attempt-start": { phase: "start", required: [], optional: ["cause"], rules: [OPEN_ATTEMPT, BUDGET_ATTEMPTS, BUDGET_MINUTES], lines: (g, w) => [["attempt-started", { id: nextId(w.model, "attempt-started"), cause: g.cause ?? (w.model.attempts.length ? "retry" : "fresh") }]] },
  "attempt-complete": { phase: "record", required: ["outcome"], optional: ["failureSignature"], specs: { outcome: ATTEMPT_OUTCOME }, rules: [NO_OPEN_ATTEMPT], lines: (g, w) => [["attempt-completed", { id: current(w), outcome: g.outcome, failureSignature: g.failureSignature }]] },
  decide: { phase: "note", required: ["observed", "hypothesis", "nextAction"], optional: ["evidence", "reason", "ref"], rules: [EVIDENCE_LIMIT, REFS], lines: (g, w) => [["decision", { id: nextId(w.model, "decision"), attempt: current(w), observed: g.observed, hypothesis: g.hypothesis, nextAction: g.nextAction, evidence: g.evidence ?? [], reason: g.reason, ref: g.ref }]] },
  "act-start": { phase: "start", required: ["type"], optional: ["tool", "label", "mutates", "approval", "environment", "params"], rules: [BUDGET_ACTIONS, BUDGET_MINUTES, ...CONSUMING], lines: actionStarted },
  "act-complete": { phase: "record", required: ["action", "outcome"], optional: ["receipt", "summary"], specs: { outcome: ATTEMPT_OUTCOME }, rules: [ACTION_KNOWN, ACTION_OPEN, RECEIPT_KNOWN], lines: (g) => [["action-completed", { id: g.action, outcome: g.outcome, receipt: g.receipt, summary: g.summary }]] },
  "act-fail": { phase: "record", required: ["action"], optional: ["reason", "receipt", "summary"], rules: [ACTION_KNOWN, ACTION_OPEN, RECEIPT_KNOWN], lines: (g) => [["action-failed", { id: g.action, reason: g.reason, receipt: g.receipt, summary: g.summary }]] },
  "link-workspace": { phase: "note", required: ["workspace"], optional: ["baseRevision"], lines: (g) => [["workspace", { workspace: g.workspace, baseRevision: g.baseRevision }]] },
  "link-file": { phase: "record", required: ["path", "change"], optional: ["added", "removed"], rules: [PATH], lines: (g, w) => [["file-changed", { attempt: current(w), path: g.path.replace(/\\/g, "/"), change: g.change, added: g.added, removed: g.removed }]] },
  "link-receipt": { phase: "record", required: ["domain", "ref"], optional: ["outcome", "summary", "action", "environment", "sourceTree", "pin", "providerKey", "queryDigest", "resultDigest", "operation"], rules: [ACTION_KNOWN], lines: (g) => [["receipt", { domain: g.domain, ref: g.ref, outcome: g.outcome, summary: g.summary, action: g.action, environment: g.environment, sourceTree: g.sourceTree, pin: g.pin, providerKey: g.providerKey, queryDigest: g.queryDigest, resultDigest: g.resultDigest, operation: g.operation }]] },
  "link-verification": { phase: "record", required: ["obligation", "state"], optional: ["evidence", "subject"], specs: { evidence: RECEIPT_REF }, rules: [PROVEN_NEEDS_RECEIPT, EVIDENCE_KNOWN], lines: (g) => [["verification", { subject: g.subject, obligation: g.obligation, evidence: g.evidence, state: g.state }]] },
  "request-approval": { phase: "start", required: ["type", "environment", "reason", "risk"], optional: ["tool", "params", "expires"], rules: ASKING, lines: (g, w) => [["approval-requested", { id: nextId(w.model, "approval-requested"), action: g.type, fingerprint: fingerprintOf(g), environment: g.environment, reason: g.reason, risk: g.risk, expires: g.expires, attempt: current(w) }]] },
  "approval-expire": { phase: "govern", required: ["approval"], optional: [], rules: EXPIRING, lines: (g) => [["approval-expired", { id: g.approval }]] },
  block: { phase: "govern", required: ["stop", "needs"], optional: ["because"], lines: (g) => [["blocked", { stop: g.stop, needs: g.needs, because: g.because }]] },
  unblock: { phase: "govern", required: [], optional: ["because"], rules: [IS_BLOCKED], lines: (g) => [["unblocked", { because: g.because }]] },
  complete: { phase: "govern", required: [], optional: ["summary"], rules: [STILL_RUNNING, UNFINISHED_ATTEMPT], lines: (g) => [["completed", { summary: g.summary }]] },
  fail: { phase: "govern", required: ["stop"], optional: ["because"], lines: (g) => [["failed", { stop: g.stop, because: g.because }]] },
  pause: { phase: "govern", human: true, required: ["expected"], optional: ["because"], rules: [NOT_YET_PAUSED], lines: byPerson("paused") },
  resume: { phase: "govern", human: true, grants: true, required: ["expected"], optional: ["because"], rules: [IS_PAUSED], lines: byPerson("resumed") },
  cancel: { phase: "govern", human: true, required: ["expected"], optional: ["because"], lines: byPerson("cancelled") },
  approve: { phase: "govern", human: true, grants: true, required: ["approval", "expected"], optional: [], rules: DECIDING, lines: decided("approval-granted") },
  reject: { phase: "govern", human: true, required: ["approval", "expected"], optional: ["reason"], rules: DECIDING, lines: decided("approval-rejected") },
};

export const OP_NAMES = Object.keys(OPS);

export const HUMAN_OPS = OP_NAMES.filter((name) => OPS[name].human === true);

/** A person's decisions that ALLOW something: only a door that proves a person may write them. */
export const GRANT_OPS = OP_NAMES.filter((name) => OPS[name].grants === true);

// What was given, without what was not: an absent flag and an empty one say the same nothing.
const cleaned = (given) => Object.fromEntries(Object.entries(given ?? {}).filter(([, v]) => v !== undefined && v !== ""));

const refusal = (rule, args) => Object.assign(new Refused(`${rule.id}: ${rule.say(...args)}`), rule.code ? { code: rule.code } : {});

// The order a refusal is told in: who may ask, through which door, what was sent, then what the task allows.
const rulesOf = (op) => [...(op.human ? [HUMAN, PERSON] : []), FIELD_RULES, TEXT, ...(PHASES[op.phase] ?? []), ...(op.rules ?? []), ...(op.human ? [STALE] : [])];

function judged(rules, args) {
  const failed = rules.find((rule) => rule.fails(...args));
  if (failed) throw refusal(failed, args);
}

// Free text, once judged a sentence, kept as ONE line a terminal may print: control characters
// and reordering marks removed (src/printable.mjs), whitespace collapsed. Never src/quote.mjs,
// which drops `<` and `>` for text bound for markdown -- "refund <= paid amount" must keep its
// meaning, and a page escapes what it shows.
const oneLine = (text) => printable(text).replace(/\s+/g, " ").trim();

const flattened = (g) => Object.fromEntries(Object.entries(g).map(([k, v]) => [k, FREE_TEXT.includes(k) && typeof v === "string" ? oneLine(v) : v]));

export function apply(ctx, id, name, given) {
  const op = OPS[name];
  if (!op) throw new Refused(`a task has no "${name}" operation — it has ${OP_NAMES.join(", ")}`);
  return ctx.tasks.transact(id, () => applied(ctx, id, name, op, cleaned(given)));
}

function applied(ctx, id, name, op, given) {
  const w = { ...loadTask(ctx, id), door: ctx.door ?? null };
  judged(rulesOf(op), [given, w, op, name]);
  const written = op.lines(flattened(given), w, ctx).map(([kind, record]) => ctx.tasks.append(id, kind, record));
  return { task: id, op: name, kinds: written.map((l) => l.kind), revision: w.model.position + written.length, lines: written };
}

// ---- the first line ---------------------------------------------------------------------------

const CREATE = { required: ["project", "checkout", "objective"], optional: ["work", "parent", "root", "snapshot", "snapshotDigest", "baseRevision", "workspace", "provider", "actor", "attempts", "actions", "minutes"] };

export const DEFAULT_BUDGET = { attempts: 8, actions: 100, minutes: null };

const taskId = (g, now) => `tsk-${short(`${g.project}\u0000${g.checkout}\u0000${g.objective}\u0000${now}`, 12)}`;

const budgetOf = (g) => ({ attempts: g.attempts ?? DEFAULT_BUDGET.attempts, actions: g.actions ?? DEFAULT_BUDGET.actions, minutes: g.minutes ?? DEFAULT_BUDGET.minutes });

const createdRecord = (id, g, ctx) => ({ id, project: g.project, checkout: g.checkout, objective: g.objective, work: g.work, parent: g.parent, root: g.root, snapshot: g.snapshot, snapshotDigest: g.snapshotDigest, baseRevision: g.baseRevision, workspace: g.workspace, provider: g.provider, actor: g.actor, budget: budgetOf(g), by: "session", session: ctx.session, host: ctx.tasks.host, schema: TASK_SCHEMA });

// A task another engine wrote, or one that cannot be read past its first line, counts as still
// going: two executions of one work at once is the thing this check exists to stop.
function stillGoing(records, now) {
  try { return !stateOf(modelOf(records), now).ended; }
  catch { return true; }
}

const sameWork = (head, g) => head?.kind === "created" && head.work === g.work && head.checkout === g.checkout;

const goingFor = (ctx, g, now) => (id) => {
  const records = ctx.tasks.read(id) ?? [];
  return sameWork(records[0], g) && stillGoing(records, now);
};

const activeFor = (ctx, g) => ctx.tasks.list().find(goingFor(ctx, g, ctx.now())) ?? null;

function begun(ctx, g) {
  const active = g.work ? activeFor(ctx, g) : null;
  if (active) throw Object.assign(new Refused(`TASK_ACTIVE: ${active} is already executing ${g.work} in this checkout — let it end, or cancel it, before another starts`), { code: CODES.TASK_ACTIVE });
  const id = taskId(g, ctx.now());
  ctx.tasks.begin(id, createdRecord(id, g, ctx));
  return { task: id, op: "create", kinds: ["created"], revision: 1 };
}

export function createTask(ctx, given) {
  const g = cleaned(given);
  judged([FIELD_RULES, TEXT], [g, null, CREATE, "create"]);
  return ctx.tasks.creating(() => begun(ctx, flattened(g)));
}
