// THE LOOP, the engine's half: the host's model chooses one step at a time;
// this keeps the state that makes each choice checkable and each step safe.
//
//   context   where things stand -- the journal's position, what is still owed
//             (the frontier, first things first), the budget, why it would
//             stop -- and it writes NOTHING, so the position it hands out is
//             still true when the decision comes back
//   step      one decision: judged (src/investigation/decision.mjs) and written
//             down BEFORE it runs, run through the same operation and gates the
//             CLI uses, findings re-derived, then SETTLED with a snapshot of
//             what is owed now. The journal lock is held to judge-and-record and
//             to settle, never across the step itself: nothing nests the lock
//   finish    the stop the engine can justify (src/investigation/stop.mjs), a
//             snapshot, and what would come next
//   resume    a paused investigation goes on; its minutes budget restarts, the
//             action and decision budgets never do
//   answer    a PERSON's answer to a question the loop asked
//
// A crash between "written down" and "settled" leaves a decision that is
// AMBIGUOUS: if its step could write, nothing runs it again -- what it did is
// read back first. That is the whole reason the decision is recorded before
// the step, rather than after it.
import { Blocked, Refused } from "../errors.mjs";
import { scrub } from "../scrub.mjs";
import { current, withJournal } from "./act.mjs";
import { judgeDecision, keptAction } from "./decision.mjs";
import { ACTIONS, ACTION_KINDS } from "./dispatch.mjs";
import { deriveFindings, recordFindings } from "./findings.mjs";
import { nextId } from "./model.mjs";
import { OBLIGATION_KINDS, frontierOf, obligationsOf, snapshotOf } from "./obligations.mjs";
import { projectReceipts } from "./memory.mjs";
import { applicabilityOf, newReceipts, receiptsOf } from "./receipts.mjs";
import { stopOf, unsettled } from "./stop.mjs";
import { DECISION_FIELDS, DECISION_FORBIDDEN, DECISION_SCHEMA, LIFECYCLE, OBLIGATION_STATES, STOP_REASONS, TEXT_LIMIT, stopReason } from "./vocab.mjs";

// w: the investigation world (src/investigation/index.mjs worldFor), plus what
// the composition root binds: planOf(id), findCase(id, draft), digestOf(id),
// runCase(id, opts). Absent, each reads as "not available here".
export function loopWorld(w) {
  const model = current(w);
  const base = { model, ctx: { graph: w.ctx.graph }, settings: w.settings, mode: w.mode, inputMode: model.meta?.inputMode ?? "screen", plans: plansOf(w, model), digestOf: w.digestOf, findCase: w.findCase, versionCaseOf: (id) => versionCaseOf(w, model, id), now: w.now ?? w.ctx.now, applicable: (r) => applicabilityOf(r, w.receipting?.fingerprints?.(r.scope ?? [])), ...readersOf(w) };
  const obligations = obligationsOf(base);
  return { ...base, obligations, frontier: frontierOf(obligations) };
}

// A version this investigation froze, read back as frozen -- or null, never a guess.
function versionCaseOf(w, model, id) {
  const v = model.versions.find((x) => x.version === id);
  try { return v && w.store?.readVersion ? w.store.readVersion(w.id, `versions/${String(id).split("@")[1]}/${v.case}.json`)?.case ?? null : null; }
  catch { return null; }
}

const plansOf = (w, model) => model.inputs.filter((i) => i.type === "plan" && i.state === "read").map((i) => w.planOf?.(i.ref)).filter(Boolean);

// What can read below the screen here: SQL, or a registered read-only capability.
function readersOf(w) {
  const capabilities = (w.ctx.capabilities?.ids?.() ?? []).filter((id) => !w.ctx.capabilities.resolve(id).mutates);
  return { capabilities, dataLayer: Boolean(w.ctx.config?.sql?.command) || capabilities.length > 0 };
}

// ------------------------------------------------------------------ context
export function contextOf(w, history = []) {
  const lw = loopWorld(w);
  return { investigation: w.id, position: lw.model.position, lifecycle: lw.model.lifecycle, inputMode: lw.inputMode, inputs: lw.model.inputs, unsettled: unsettled(lw.model).map(unsettledView), stop: stopOf(lw), budget: budgetOf(lw), obligations: countsOf(lw.obligations), frontier: lw.frontier.slice(0, 12).map(frontierView), findings: lw.model.findings.map(findingView), recall: { history, questions: lw.model.questions.filter((q) => !lw.model.answers.some((a) => a.question === q.id)) }, protocol: { schemaVersion: DECISION_SCHEMA, actions: ACTION_KINDS } };
}

const frontierView = (o) => ({ id: o.id, kind: o.kind, subject: o.subject, layer: o.layer, title: o.title, why: o.why, oracle: o.oracle, can: o.can, template: o.template });
const findingView = (f) => ({ id: f.id, key: f.key, family: f.family, outcome: f.outcome, confidence: f.confidence, say: f.say, pattern: f.pattern ?? "consistent", reproduced: f.reproduced });
const unsettledView = (d) => ({ id: d.id, target: d.target, action: d.action?.kind, mutates: Boolean(d.mutates), say: d.mutates ? "it may have written: read back what it did, and never send it again" : "safe to try again, with a new decisionId" });

function countsOf(obligations) {
  const byState = Object.fromEntries(OBLIGATION_STATES.map((s) => [s.id, obligations.filter((o) => o.status === s.id).length]));
  return { total: obligations.length, ...byState };
}

function budgetOf(lw) {
  const started = Date.parse(lw.model.resumed.at(-1)?.at ?? lw.model.meta?.at);
  const left = Math.max(0, Math.round((started + lw.settings.limits.minutes * 60000 - (lw.now?.() ?? started)) / 60000));
  return { actions: { used: lw.model.actions.length, of: lw.settings.limits.actions }, decisions: { used: lw.model.decisions.length, of: lw.settings.limits.decisions }, minutesLeft: left };
}

// --------------------------------------------------------------------- step
export function step(w, raw) {
  const taken = withJournal(w, () => takenDown(w, raw));
  if (taken.replay) return { ...responseOf(w, taken.replay, taken.before), replayed: true };
  const outcome = attempted(w, taken.decision);
  refreshed(w);
  return responseOf(w, withJournal(w, () => settle(w, taken, outcome)), taken.before);
}

// Judged against the journal as it is UNDER the lock, and written down before
// the step runs: the record is what makes a crash mid-step visible afterwards.
function takenDown(w, raw) {
  const lw = loopWorld(w);
  const judged = judgeDecision(raw, lw);
  if (judged.replay) return { replay: judged.replay, before: lw.obligations };
  const record = { id: raw.decisionId, revision: raw.expectedRevision, target: raw.target, action: keptAction(raw.action), evidence: [raw.evidenceRefs ?? []].flat(), hypothesis: raw.hypothesis, reason: raw.reason, mutates: ACTIONS[raw.action.kind].mutates(raw.action, lw) };
  return { decision: w.store.append(w.id, "decision", record), before: lw.obligations };
}

// A typed stop is the step's outcome; anything else is the ENGINE failing, and
// is thrown -- the decision stays unsettled, and says so the next time.
function attempted(w, decision) {
  try { return { state: "done", result: ACTIONS[decision.action.kind].run(w, decision.action, decision) }; }
  catch (e) { return stoppedBy(e); }
}

function stoppedBy(e) {
  if (e instanceof Refused) return { state: "refused", why: scrub(e.message).slice(0, 300) };
  if (e instanceof Blocked) return { state: "blocked", why: scrub(e.message).slice(0, 300) };
  throw e;
}

// Findings re-derived from everything the journal now holds, recorded under the lock.
export function refreshed(w) {
  const derived = deriveFindings(current(w), w);
  return withJournal(w, () => recordFindings(w.store, w.id, current(w), derived));
}

function settle(w, taken, outcome) {
  const lw = loopWorld(w);
  const refs = evidenceSince(w, taken.decision.id);
  const progress = refs.some((r) => learned(r, lw.model)) || moved(taken.before, lw.obligations).length > 0;
  return w.store.append(w.id, "settled", { id: nextId(lw.model, "settled"), decision: taken.decision.id, state: outcome.state, refs: refs.map((r) => r.id), why: outcome.why ?? null, progress, snapshot: { ...snapshotOf(lw.obligations, lw.model.position + 1), stop: stopOf(lw) } });
}

// What this step put on the journal, in journal order: the records after its decision.
const EVIDENCE = new Set(["action", "observation", "check", "security", "run", "reproduction", "question", "draft"]);

function evidenceSince(w, decisionId) {
  const records = w.store.read(w.id);
  const from = records.findIndex((r) => r.kind === "decision" && r.id === decisionId);
  return records.slice(from + 1).filter((r) => EVIDENCE.has(r.kind) && r.id);
}

// Evidence is what LOOKED and saw something (or saw nothing): a refused or a
// blocked read is a record, and it is not evidence.
const evidenceful = (r) => (r.kind === "action" ? r.state === "done" : r.kind === "check" ? ["observed", "empty"].includes(r.state) : r.kind === "security" ? r.state === "observed" : true);

// And a read that asked what an earlier one asked, and got the same answer,
// taught nothing: counted as progress, a loop could re-read one row until the
// budget ran out and never trip the attempts rule or the no-progress stop.
const learned = (r, model) => evidenceful(r) && !repeated(r, model);

const SAME_READ = ["action", "query", "via", "input", "expect", "within", "state", "rows"];

const repeated = (r, model) => r.kind === "check" && model.checks.some((c) => c.id !== r.id && SAME_READ.every((k) => JSON.stringify(c[k]) === JSON.stringify(r[k])));

const moved = (before, after) => after.filter((o) => before.find((b) => b.id === o.id)?.status !== o.status);

function responseOf(w, settled, before) {
  const lw = loopWorld(w);
  return { decision: settled.decision, state: settled.state, why: settled.why, refs: settled.refs ?? [], progress: settled.progress, position: lw.model.position, changed: moved(before ?? [], lw.obligations).map((o) => ({ id: o.id, kind: o.kind, subject: o.subject, layer: o.layer, status: o.status, why: o.why })), findings: lw.model.findings.map(findingView), budget: budgetOf(lw), next: lw.frontier.slice(0, 3).map(frontierView), stop: stopOf(lw) };
}

// ------------------------------------------------------- finish · resume · answer
export function finish(w, why) {
  return withJournal(w, () => finished(w, why));
}

// The stop the engine can justify; with work still open and no reason to stop,
// the agent chose to stop early -- which pauses, it never completes.
function finished(w, why) {
  const lw = loopWorld(w);
  if (lw.model.lifecycle !== "active") throw new Refused(`${w.id} is already ${lw.model.lifecycle}`);
  const reason = stopOf(lw) ?? "stopped-early";
  return w.store.append(w.id, "completed", { id: nextId(lw.model, "completed"), reason, lifecycle: stopReason(reason).lifecycle, by: "session", why: why ?? stopReason(reason).say, snapshot: snapshotOf(lw.obligations, lw.model.position + 1), next: lw.frontier.slice(0, 5).map((o) => o.id) });
}

export function resume(w, why) {
  return withJournal(w, () => resumed(w, why));
}

// Stamped with the WORLD's clock -- the one the deadline gate reads -- so the
// minutes budget restarts from the moment it did.
function resumed(w, why) {
  const model = current(w);
  if (model.lifecycle !== "paused") throw new Refused(`${w.id} is ${model.lifecycle} — only a paused investigation resumes${model.lifecycle === "completed" ? "; start a new one to look again" : ""}`);
  return w.store.append(w.id, "resumed", { id: nextId(model, "resumed"), by: "session", why: why ?? "resumed", at: new Date((w.now ?? w.ctx.now)()).toISOString() });
}

// A PERSON's word that a step which never settled is settled: they looked at
// what it did. Only then may anything write again (decision.mjs READ_BACK_FIRST).
export function release(w, decisionId, why) {
  return withJournal(w, () => released(w, decisionId, why));
}

function released(w, decisionId, why) {
  const model = current(w);
  if (!unsettled(model).some((d) => d.id === decisionId)) throw new Refused(`${decisionId} is not a step of ${w.id} that is waiting to be settled`);
  return w.store.append(w.id, "settled", { id: nextId(model, "settled"), decision: decisionId, state: "released", refs: [], why: why ?? "a person looked at what it did and released it", progress: false });
}

// A person's answer, relayed with --human. It settles the question; the
// obligation that asked it goes back to being pending, with the answer beside it.
export function answer(w, questionId, says) {
  return withJournal(w, () => answered(w, questionId, says));
}

function answered(w, questionId, says) {
  const model = current(w);
  if (!model.questions.some((q) => q.id === questionId)) throw new Refused(`${questionId} is not a question of ${w.id}`);
  if (!String(says ?? "").trim()) throw new Refused("an answer says something — --says=\"…\"");
  return w.store.append(w.id, "answer", { id: nextId(model, "answer"), question: questionId, says, by: "person" });
}

// --------------------------------------------------------------- checkpoint
// Findings first, from everything the journal holds -- a direct act or check
// the loop did not take counts too. Then what every settled obligation came to, kept as RECEIPTS (the ones the journal
// does not hold yet), then projected into the project's knowledge -- only the
// ones not projected at an earlier checkpoint, so a replay writes nothing new.
// The checkpoint says what reached memory: synced, pending, failed or off.
// w.receipting: { scopeOf, fingerprints, seen } and w.memory -- bound by the
// composition root (cli/autonomous-qa.mjs).
export function checkpoint(w) {
  refreshed(w);
  const receipts = withJournal(w, () => receiptsAppended(w));
  const memory = projectReceipts(w, unprojected(current(w)));
  return withJournal(w, () => checkpointed(w, receipts, memory));
}

function receiptsAppended(w) {
  const lw = loopWorld(w);
  const fresh = newReceipts(lw.model, receiptsOf(lw, w.receipting ?? {}));
  fresh.forEach((r, i) => w.store.append(w.id, "receipt", { ...r, id: `rct-${lw.model.receipts.length + i + 1}` }));
  return fresh.map((r, i) => `rct-${lw.model.receipts.length + i + 1}`);
}

function unprojected(model) {
  const done = new Set(model.checkpoints.flatMap((c) => c.projected ?? []));
  return model.receipts.filter((r) => !done.has(r.id));
}

function checkpointed(w, receipts, memory) {
  const lw = loopWorld(w);
  return w.store.append(w.id, "checkpoint", { id: nextId(lw.model, "checkpoint"), upto: lw.model.position, receipts, projected: memory.projected, memory: memory.state, why: memory.why, snapshot: { ...snapshotOf(lw.obligations, lw.model.position + 1), stop: stopOf(lw) } });
}

// ----------------------------------------------------------------- protocol
// The protocol as the tables say it, so no playbook carries a copy of it.
export const protocolOf = () => ({ schemaVersion: DECISION_SCHEMA, fields: DECISION_FIELDS, forbidden: DECISION_FORBIDDEN, textLimit: TEXT_LIMIT, actions: ACTION_KINDS.map((kind) => ({ kind, fields: ACTIONS[kind].fields, required: ACTIONS[kind].required, modes: ACTIONS[kind].modes })), obligations: OBLIGATION_KINDS, states: OBLIGATION_STATES, stops: STOP_REASONS, lifecycle: LIFECYCLE });
