// What a task IS at any moment: a fold over its journal, and nothing stored beside it.
//
// `modelOf(records)` folds the lines in order; `stateOf(model, now)` reads the answer every
// caller shares -- the CLI, Orbit Control and, as JSON, the page -- so there is exactly one
// derivation of "where does this task stand". Each answer is a small table read in order,
// first row that holds, the last always holding:
//
//   an approval     consumed · rejected · expired · granted · pending
//   the lifecycle   CANCELLED · COMPLETED · FAILED · PAUSED · WAITING_APPROVAL · BLOCKED ·
//                   QUEUED · PREPARING · VERIFYING · EXECUTING
//   the stop        why it is not going on, when it is not
//
// PAUSED outranks WAITING_APPROVAL because a person's word outranks a wait: a paused task
// starts nothing, approved or not. WAITING_APPROVAL outranks BLOCKED because a person's
// decision is the thing that can move it. A pending approval is the ONLY source of
// WAITING_APPROVAL; nothing writes that state.
//
// Expiry is read against the clock the caller hands in, never written by a read, so a request
// that lapsed reads as lapsed without the journal having moved.
import { Refused } from "../errors.mjs";
import { PREFIX, TASK_SCHEMA, stageRow } from "./vocab.mjs";

// A journal from a newer engine is refused, never guessed at or written over.
export function readable(meta) {
  if ((meta?.schema ?? 1) > TASK_SCHEMA) throw new Refused(`this task was written by a newer Orbit (journal format ${meta.schema}); upgrade the plugin before reading or changing it`);
  return meta;
}

const emptyModel = () => ({ meta: null, records: [], position: 0, stages: [], attempts: [], decisions: [], actions: new Map(), files: [], receipts: new Map(), verifications: new Map(), approvals: new Map(), workspace: null, paused: null, blocked: null, ended: null });

const attemptOf = (m, id) => m.attempts.find((a) => a.id === id) ?? null;

// The first line that settles something stands: an attempt completes once, an action ends
// once, an approval is decided once -- the write door refuses a second, and the fold keeps
// the first if one ever reached the disk anyway.
function completedAttempt(m, r) {
  const attempt = attemptOf(m, r.id);
  if (attempt && !attempt.completed) attempt.completed = r;
}

function startedAction(m, r) {
  m.actions.set(r.id, { ...r, startedAt: r.at, ended: null });
  attemptOf(m, r.attempt)?.actions.push(r.id);
}

function endedAction(m, r) {
  const action = m.actions.get(r.id);
  if (action && !action.ended) action.ended = r;
}

function changedFile(m, r) {
  m.files.push(r);
  attemptOf(m, r.attempt)?.files.push(r);
}

function onApproval(m, r, slot) {
  const approval = m.approvals.get(r.id);
  if (approval && approval[slot] === null) approval[slot] = r;
}

const attemptRow = (r) => ({ id: r.id, cause: r.cause ?? null, startedAt: r.at, n: r.n, completed: null, actions: [], files: [] });

// How each kind of line changes the picture.
const FOLDS = {
  created: (m, r) => { m.meta ??= r; },
  stage: (m, r) => { m.stages.push(r); },
  "attempt-started": (m, r) => { m.attempts.push(attemptRow(r)); },
  "attempt-completed": completedAttempt,
  decision: (m, r) => { m.decisions.push(r); },
  "action-started": startedAction,
  "action-completed": endedAction,
  "action-failed": endedAction,
  workspace: (m, r) => { m.workspace = r; },
  "file-changed": changedFile,
  receipt: (m, r) => { m.receipts.set(`${r.domain}:${r.ref}`, r); },
  verification: (m, r) => { m.verifications.set(r.subject ?? r.obligation, r); },
  "approval-requested": (m, r) => { m.approvals.set(r.id, { ...r, requestedAt: r.at, decision: null, consumed: null, expired: null }); },
  "approval-granted": (m, r) => onApproval(m, r, "decision"),
  "approval-rejected": (m, r) => onApproval(m, r, "decision"),
  "approval-consumed": (m, r) => onApproval(m, r, "consumed"),
  "approval-expired": (m, r) => onApproval(m, r, "expired"),
  paused: (m, r) => { m.paused = r; },
  resumed: (m) => { m.paused = null; },
  blocked: (m, r) => { m.blocked = r; },
  unblocked: (m) => { m.blocked = null; },
  cancelled: (m, r) => { m.ended ??= r; },
  completed: (m, r) => { m.ended ??= r; },
  failed: (m, r) => { m.ended ??= r; },
};

// The fold, and what is read straight off it. A newer journal format is refused before
// anything is used.
export function modelOf(records) {
  const model = emptyModel();
  for (const [n, line] of records.entries()) FOLDS[line.kind]?.(model, { ...line, n });
  readable(model.meta);
  return Object.assign(model, { records, position: records.length, stage: model.stages.at(-1)?.stage ?? null, current: model.attempts.findLast((a) => !a.completed) ?? null });
}

const countOf = (model, kind) => model.records.filter((r) => r.kind === kind).length;

// The next counted id of a kind, under the lock that stops two writers counting at once.
export const nextId = (model, kind) => `${PREFIX[kind]}-${countOf(model, kind) + 1}`;

// ---- approvals ------------------------------------------------------------------------------

const lapsed = (a, now) => Boolean(a.expires) && Date.parse(a.expires) <= Date.parse(now);

export const APPROVAL_STATES = [
  { state: "consumed", when: (a) => a.consumed !== null, doc: "the action it allowed has started; it allows nothing more" },
  { state: "rejected", when: (a) => a.decision?.kind === "approval-rejected", doc: "a person said no" },
  { state: "expired", when: (a, now) => a.expired !== null || lapsed(a, now), doc: "its time ran out before the action started" },
  { state: "granted", when: (a) => a.decision?.kind === "approval-granted", doc: "a person approved it once; the action it names may start, once" },
  { state: "pending", when: () => true, doc: "it waits for a person" },
];

export const approvalState = (a, now) => APPROVAL_STATES.find((s) => s.when(a, now)).state;

const pendingOf = (m, now) => [...m.approvals.values()].filter((a) => approvalState(a, now) === "pending");

// ---- the lifecycle --------------------------------------------------------------------------

export const LIFECYCLE = [
  { state: "CANCELLED", when: (m) => m.ended?.kind === "cancelled", doc: "a person cancelled it; nothing new starts" },
  { state: "COMPLETED", when: (m) => m.ended?.kind === "completed", doc: "it finished" },
  { state: "FAILED", when: (m) => m.ended?.kind === "failed", doc: "it stopped for a reason it records" },
  { state: "PAUSED", when: (m) => m.paused !== null, doc: "a person paused it; nothing new starts until they resume it" },
  { state: "WAITING_APPROVAL", when: (m, now) => pendingOf(m, now).length > 0, doc: "an action it asked for waits for a person" },
  { state: "BLOCKED", when: (m) => m.blocked !== null, doc: "it cannot go on, for the reason it records" },
  { state: "QUEUED", when: (m) => m.stages.length === 0 && m.attempts.length === 0, doc: "nothing has started yet" },
  { state: "PREPARING", when: (m) => stageRow(m.stage)?.preparing === true, doc: "getting ready: requirement, context, environment, workspace" },
  { state: "VERIFYING", when: (m) => stageRow(m.stage)?.verifying === true, doc: "checking what it changed" },
  { state: "EXECUTING", when: () => true, doc: "working on the change" },
];

export const TERMINAL = ["CANCELLED", "COMPLETED", "FAILED"];

export const lifecycleOf = (m, now) => LIFECYCLE.find((r) => r.when(m, now)).state;

// Why it is not going on, when it is not. Only a person cancels, so a cancel's reason is theirs;
// waiting for a person is what a pending approval means, so that reason is never written.
const STOPS = [
  { when: (m) => m.ended?.kind === "cancelled", stop: () => "CANCELLED_BY_HUMAN" },
  { when: (m) => m.ended?.kind === "failed", stop: (m) => m.ended.stop ?? null },
  { when: (m) => m.ended !== null, stop: () => null },
  { when: (m) => m.blocked !== null, stop: (m) => m.blocked.stop ?? null },
  { when: (m, now) => pendingOf(m, now).length > 0, stop: () => "HUMAN_APPROVAL_REQUIRED" },
  { when: () => true, stop: () => null },
];

export const stopOf = (m, now) => STOPS.find((r) => r.when(m, now)).stop(m);

// How many attempts in a row, counting back from the last, ended on the same failure signature.
// Data for whoever decides NO_PROGRESS; this concludes nothing.
export function repeatsOf(attempts) {
  const signatures = attempts.filter((a) => a.completed).map((a) => a.completed.failureSignature ?? null);
  const last = signatures.at(-1);
  if (!last) return 0;
  return signatures.length - 1 - signatures.findLastIndex((s) => s !== last);
}

const minutesBetween = (from, to) => (from ? Math.max(0, Math.floor((Date.parse(to) - Date.parse(from)) / 60000)) : 0);

export const spentOf = (m, now) => ({ attempts: m.attempts.length, actions: m.actions.size, minutes: minutesBetween(m.meta?.at, m.ended?.at ?? now) });

// The one answer to "where does this task stand", as of `now`.
export function stateOf(m, now) {
  const lifecycle = lifecycleOf(m, now);
  return { lifecycle, ended: TERMINAL.includes(lifecycle), stage: m.stage, stop: stopOf(m, now), attempt: m.current?.id ?? null, attempts: m.attempts.length, open: m.ended ? [] : pendingOf(m, now).map((a) => a.id), spent: spentOf(m, now), repeats: repeatsOf(m.attempts) };
}
