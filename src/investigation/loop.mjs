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
import { ONE_SANDBOX } from "../qa/backend/shared.mjs";
import { controlRulesFor } from "../qa/generation/controls.mjs";
import { OWN_SLOTS } from "../qa/generation/design.mjs";
import { proposableOf } from "../qa/obligations/contract.mjs";
import { OBLIGATION_SHAPES } from "../qa/obligations/shapes.mjs";
import { EXPECT_OPS } from "../qa/vocab.mjs";
import { scrub } from "../scrub.mjs";
import { current, withJournal } from "./act.mjs";
import { judgeDecision, keptAction } from "./decision.mjs";
import { ACTIONS, ACTION_KINDS } from "./dispatch.mjs";
import { deriveFindings, recordFindings } from "./findings.mjs";
import { obligationBudgets, perObligation } from "./generate.mjs";
import { attemptsLimit } from "./run-version.mjs";
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
  return { investigation: w.id, position: lw.model.position, lifecycle: lw.model.lifecycle, inputMode: lw.inputMode, inputs: lw.model.inputs, unsettled: unsettled(lw.model).map(unsettledView), stop: stopOf(lw), budget: budgetOf(lw), obligations: countsOf(lw.obligations), frontier: lw.frontier.slice(0, 12).map(frontierView), findings: lw.model.findings.map(findingView), recall: { history, questions: lw.model.questions.filter((q) => !lw.model.answers.some((a) => a.question === q.id)) }, versions: lw.model.versions.slice(-12).map(versionView(lw.model)), bindings: bindingsOf(w), protocol: { schemaVersion: DECISION_SCHEMA, actions: ACTION_KINDS } };
}

const frontierView = (o) => ({ id: o.id, kind: o.kind, subject: o.subject, layer: o.layer, title: o.title, why: o.why, oracle: o.oracle, can: o.can, template: o.template });
// The names a design's refs may take here -- an endpoint, a channel, a state, a schedule, a workload, an identity, a
// clock -- as the sandbox's binder resolves them (src/runtime/sandbox/declarations.mjs bindableFrom). None when no
// generation port is bound; a graph that cannot be read lists nothing rather than failing the context.
const bindingsOf = (w) => {
  try { return w.generation?.bindable?.() ?? null; }
  catch { return null; }
};

// A frozen version as a host names it: `version` is the id a run-version step sends (<case>@<digest16>), and the
// obligation it was designed for -- so a host never has to read the journal to run what it generated.
const versionView = (model) => (v) => ({ id: v.id, version: v.version, obligation: model.designs.findLast((d) => d.design === v.design)?.obligation ?? null, design: v.design, case: v.case });
const findingView = (f) => ({ id: f.id, key: f.key, family: f.family, outcome: f.outcome, confidence: f.confidence, say: f.say, pattern: f.pattern ?? "consistent", reproduced: f.reproduced });
const unsettledView = (d) => ({ id: d.id, target: d.target, action: d.action?.kind, mutates: Boolean(d.mutates), say: d.mutates ? "it may have written: read back what it did, and never send it again" : "safe to try again, with a new decisionId" });

function countsOf(obligations) {
  const byState = Object.fromEntries(OBLIGATION_STATES.map((s) => [s.id, obligations.filter((o) => o.status === s.id).length]));
  return { total: obligations.length, ...byState };
}

// The investigation's own budget, and what each obligation and each frozen version may spend -- the limits generate and
// run-version refuse by (generate.mjs BUDGET, run-version.mjs attemptsLimit), shown before a host spends them, with what
// every obligation that has a design has spent so far.
function budgetOf(lw) {
  const started = Date.parse(lw.model.resumed.at(-1)?.at ?? lw.model.meta?.at);
  const left = Math.max(0, Math.round((started + lw.settings.limits.minutes * 60000 - (lw.now?.() ?? started)) / 60000));
  return { actions: { used: lw.model.actions.length, of: lw.settings.limits.actions }, decisions: { used: lw.model.decisions.length, of: lw.settings.limits.decisions }, minutesLeft: left, perObligation: perObligation(lw.settings), perVersion: { attempts: attemptsLimit(lw.settings) }, obligations: obligationBudgets(lw.model, lw.settings) };
}

// --------------------------------------------------------------------- step
export function step(w, raw) {
  const taken = withJournal(w, () => takenDown(w, raw));
  if (taken.replay) return { ...responseOf(w, taken.replay, taken.before), replayed: true };
  const outcome = attempted(w, taken.decision);
  refreshed(w);
  return { ...responseOf(w, withJournal(w, () => settle(w, taken, outcome)), taken.before), result: resultView(outcome.result) };
}

// What the action itself came to, as its owner said it -- the word a generate or a run-version gives (DRAFT_CREATED,
// GENERATION_FAILED, ENVIRONMENT_BLOCKED, SATISFIED ...), the stage or rule behind it, and why; and of a run refused or
// blocked at a step, where it stopped and what that step's own stop said, of one that failed only where (`stopped`) -- by
// allow-list, so a host that sent a step learns what it did without reading the journal. Never the observed values.
// Beside a frozen version, only when there is any, what its design names that an earlier version did too (`shared`).
export const resultView = (r) => (r && typeof r === "object" ? { outcome: r.outcome ?? null, stage: r.stage ?? null, rule: r.rule ?? null, why: r.why ? scrub(String(r.why)).slice(0, 600) : null, version: typeof r.version === "string" ? r.version : null, execution: r.execution ?? null, findings: (r.findings ?? []).slice(0, 8).map(findingLine), stopped: stoppedView(r.stopped), ...sharedView(r.shared) } : null);

const findingLine = (f) => scrub(typeof f === "string" ? f : [f.rule ?? f.id ?? f.code, f.say ?? f.why ?? f.message].filter(Boolean).join(": ")).slice(0, 240);

// Where a run stopped short (src/investigation/run-version.mjs stoppedOf): the step, its verb and capability, refused,
// blocked or failed, and what a refusal or a block said there -- these five and nothing else, its words scrubbed and
// bounded at this door again; a failure says nothing. Beside them, only when the step's own match left something out of
// what it observed, `excluded`.
const stoppedView = (s) => (s && typeof s === "object" ? { step: Number.isInteger(s.step) ? s.step : null, do: typeof s.do === "string" ? s.do : null, capability: typeof s.capability === "string" ? s.capability : null, as: typeof s.as === "string" ? s.as : null, says: typeof s.says === "string" ? scrub(s.says).slice(0, 600) : null, ...excludedView(s.excluded) } : null);

// What the stopped step's own match read of the thing it observes and left out (run-version.mjs withExcluded): the list it
// was read from, how many, the match's fields that left them out, the newest three -- each field a name, each value a
// scalar or a short text -- and the sentence that says what it means; every word scrubbed and bounded at this door.
const EXCLUDED_ITEMS = 3;
const NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

const excludedView = (x) => (x && typeof x === "object" && Number.isInteger(x.count) && x.count > 0 ? { excluded: { field: named(x.field) ? x.field : null, count: x.count, by: (Array.isArray(x.by) ? x.by : []).filter(named).slice(0, 8), items: (Array.isArray(x.items) ? x.items : []).slice(-EXCLUDED_ITEMS).map(itemView), say: typeof x.say === "string" ? scrub(x.say).slice(0, 600) : null } } : {});

const named = (k) => typeof k === "string" && NAME.test(k);

const itemView = (i) => Object.fromEntries(Object.entries(i && typeof i === "object" ? i : {}).filter(([k]) => named(k)).slice(0, 8).map(([k, v]) => [k, scalarOf(v)]));

const scalarOf = (v) => (v === null || typeof v === "number" || typeof v === "boolean" ? v : scrub(typeof v === "string" ? v : JSON.stringify(v) ?? "").slice(0, 120));

// What a generate step's design names -- a business key, a message, an occurrence -- that an earlier frozen version of
// this investigation named too (generate.mjs, src/qa/backend/shared.mjs): advice beside the answer, never its outcome.
// The newest four, each by its version, obligation and shape, the values both name and the words they were named under,
// and the sentence; every word scrubbed and bounded at this door.
const SHARED = 4;

const sharedView = (xs) => (Array.isArray(xs) && xs.length ? { shared: xs.slice(-SHARED).map(sharedLine) } : {});

const sharedLine = (x) => ({ version: textOf(x?.version, 140), obligation: textOf(x?.obligation, 80), shape: textOf(x?.shape, 80), keys: (Array.isArray(x?.keys) ? x.keys : []).slice(0, SHARED).map(keyLine), say: textOf(x?.say, 600) });

const keyLine = (k) => ({ value: textOf(k?.value, 120), as: (Array.isArray(k?.as) ? k.as : []).filter(named).slice(0, 8) });

const textOf = (v, n) => (typeof v === "string" ? scrub(v).slice(0, n) : null);

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

// What this step put on the journal, in journal order: the records after its decision. A design and the version
// frozen from it are steps a generated test's obligation took -- written once each, so proposing the same design
// again puts nothing new here and teaches nothing.
const EVIDENCE = new Set(["action", "observation", "check", "security", "run", "reproduction", "question", "draft", "designed", "version"]);

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
  return { decision: settled.decision, state: settled.state, why: settled.why, refs: settled.refs ?? [], progress: settled.progress, position: lw.model.position, frozen: lw.model.versions.filter((v) => (settled.refs ?? []).includes(v.id)).map(versionView(lw.model)), changed: moved(before ?? [], lw.obligations).map((o) => ({ id: o.id, kind: o.kind, subject: o.subject, layer: o.layer, status: o.status, why: o.why })), findings: lw.model.findings.map(findingView), budget: budgetOf(lw), next: lw.frontier.slice(0, 3).map(frontierView), stop: stopOf(lw) };
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
// The protocol as the tables say it, so no playbook carries a copy of it -- a generate step's DESIGN included: what each
// part of one may carry (src/qa/obligations/contract.mjs DEFINITIONS), the assertion template each criterion op
// compiles to (src/qa/vocab.mjs EXPECT_OPS), what a rule over its controls says a design must do that their contract
// does not show (src/qa/generation/controls.mjs `says`), what an obligation's own slots are to its verdict (`slots`,
// src/qa/generation/design.mjs OWN_SLOTS), that the tests of one investigation share its sandbox (`sandbox`,
// src/qa/backend/shared.mjs ONE_SANDBOX) and what a shape says a design for it must know (`shapes`,
// src/qa/obligations/shapes.mjs `says`), so a host reads them before it designs instead of learning them by refusal --
// or by a false alarm.
export const protocolOf = () => ({ schemaVersion: DECISION_SCHEMA, fields: DECISION_FIELDS, forbidden: DECISION_FORBIDDEN, textLimit: TEXT_LIMIT, actions: ACTION_KINDS.map((kind) => ({ kind, fields: ACTIONS[kind].fields, required: ACTIONS[kind].required, modes: ACTIONS[kind].modes })), obligations: OBLIGATION_KINDS, states: OBLIGATION_STATES, stops: STOP_REASONS, lifecycle: LIFECYCLE, design: designProtocol() });

const DESIGN_PARTS = ["design", "assertion", "control", "trigger", "observation-plan", "page"];

const designProtocol = () => ({ definitions: proposableOf(DESIGN_PARTS), templates: EXPECT_OPS.map((o) => ({ op: o.name, template: o.template, window: o.window === true, doc: o.doc })), rules: controlRulesFor(), slots: OWN_SLOTS, sandbox: ONE_SANDBOX, shapes: OBLIGATION_SHAPES.filter((s) => s.says).map((s) => ({ shape: s.id, says: s.says })) });
