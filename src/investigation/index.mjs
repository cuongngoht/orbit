// AUTONOMOUS QA's engine half: the deterministic operations an investigating
// agent asks for, and nothing that decides WHAT to investigate. Claude reasons
// and orchestrates (skills/orbit-qa); this does exactly what it is
// asked, inside the gates, and keeps what it saw.
//
//   begin      an investigation: its record and its bounded plan -- no browser
//   act        one action inside an observation boundary      (act.mjs)
//   explore    the plan's controls, bounded                    (explore.mjs)
//   checkData  a read-only data check tied to an action        (data.mjs)
//   runMatrix  the tenant-isolation matrix                     (security.mjs)
//   analyse    findings derived from the journal, appended     (findings.mjs)
//   reproduce  one finding replayed beside the original        (reproduce.mjs)
//   draftFor   a regression DRAFT, only on an accepted oracle   (drafts.mjs)
//   linkRun    an accepted case's run-case result, recorded as execution --
//              its verdict stays the runner's
//
// Everything is bound here from what a composition root hands IN -- the run
// context, the machine store, the switch -- so nothing below reads
// process.env, spawns anything or knows where the store is.
import { Refused } from "../errors.mjs";
import { current, withJournal } from "./act.mjs";
import { contextOf, refreshed } from "./loop.mjs";
import { latestSnapshot, modelOf, nextId } from "./model.mjs";
import { planOf } from "./plan.mjs";
import { environmentOf, readSettings } from "./settings.mjs";
import { inputModeOf } from "./input.mjs";
import { JOURNAL_SCHEMA } from "./vocab.mjs";
import { createInvestigations, eventIdOf } from "./store.mjs";

export { act } from "./act.mjs";
export { answer, checkpoint, finish, loopWorld, protocolOf, release, resume, step } from "./loop.mjs";
export { explore } from "./explore.mjs";
export { checkData } from "./data.mjs";
export { runMatrix } from "./security.mjs";
export { reproduce } from "./reproduce.mjs";
export { draftFor } from "./drafts.mjs";
export { modelOf } from "./model.mjs";
export { readSettings, writeSettings, setPath, settingsProblems, DEFAULTS as SETTINGS_DEFAULTS, STALE_REVISION } from "./settings.mjs";
export { createInvestigations, investigationPaths } from "./store.mjs";
export { MODES, OUTCOMES, STATES, LAYERS } from "./vocab.mjs";
export { INPUT_KINDS, INPUT_MODES, inputModeOf, pbiInput, planAsInput, screenInput, snapshotAsInput } from "./input.mjs";

// b: { ctx, machine: { store, io }, env, mode, id, on, identity, pace, runtime, environment }
// `environment` is a PROJECTION a composition root hands in (a task's sandbox, src/investigation/sandbox.mjs):
// it wins over the settings' declared ones, and `enabled` is still a person's.
export function worldFor(b) {
  const store = createInvestigations(b.machine.store.root, b.machine.io);
  const { settings } = readSettings(store.paths, b.machine.io);
  const id = b.id ?? null;
  const model = id ? modelOf(store.read(id)) : null;
  return { ctx: b.ctx, store, io: b.machine.io, settings, environment: b.environment ?? environmentOf(settings, b.env ?? model?.meta?.environment?.id), mode: b.mode ?? model?.meta?.mode ?? "observe", id, on: b.on, identity: b.identity ?? model?.meta?.identity ?? null, now: b.ctx.now, pace: b.pace, runtime: b.runtime ?? null, task: b.task ?? model?.meta?.task ?? null };
}

// What a plan is made of, from the world and the question.
export function planInput(w, q) {
  const ctx = w.ctx;
  return { graph: ctx.graph, cases: q.cases ?? [], settings: w.settings, environment: w.environment, mode: w.mode, objective: q.objective, scope: q.scope, history: historyOf(w.store), sqlConfigured: Boolean(ctx.config?.sql?.command), detailSupported: typeof ctx.browser?.requestDetail === "function", capabilities: ctx.capabilities?.ids?.() ?? [], on: w.on, runtime: w.runtime ?? null };
}

export const planFor = (w, q) => planOf(planInput(w, q));

// q: { objective, scope, cases, revision, inputs } -- `inputs` are records
// src/investigation/input.mjs built (a screen, a plan, a requirement snapshot);
// which way in they make is derived from them, never declared.
export function begin(w, q) {
  const plan = planFor(w, q);
  const id = w.store.create({ objective: q.objective ?? "", scope: q.scope ?? "", mode: w.mode, environment: w.environment ? { id: w.environment.id, origin: w.environment.origin, kind: w.environment.kind } : null, identity: w.identity, revision: q.revision ?? null, budget: w.settings.limits, by: "session", schema: JOURNAL_SCHEMA, inputMode: inputModeOf(q.inputs), ...boundTo(w) });
  (q.inputs ?? []).forEach((input, i) => w.store.append(id, "input", { ...input, id: `inp-${i + 1}` }));
  w.store.append(id, "plan", plan);
  return { id, plan };
}

// The task's sandbox and the source tree an investigation was begun against, when its environment is one;
// and the task it was begun FOR, when a task began it (`created.task`, read by discover.mjs belongsTo).
const boundTo = (w) => ({ ...(w.runtime?.environment ? { runtime: { environment: w.runtime.environment, task: w.runtime.task, sourceTree: w.runtime.sourceTree } } : {}), ...(w.task ? { task: w.task } : {}) });

// Derived from the journal as it stands, then recorded under the journal lock
// against the journal as it is by then -- the ids are the lock's to hand out.
export function analyse(w) {
  const added = refreshed(w);
  return { added, findings: current(w).findings };
}

// The loop's context, with what earlier investigations touched and found.
export const contextFor = (w) => contextOf(w, historyOf(w.store, w.id));

export function cancel(w, why) {
  return withJournal(w, () => cancelled(w, why));
}

function cancelled(w, why) {
  if (current(w).cancelled) throw new Refused(`${w.id} is already cancelled`);
  return w.store.append(w.id, "cancelled", { why: why ?? "cancelled by a person", by: "person" });
}

// One more thing this investigation was asked about -- a draft plan the agent
// wrote from a requirement, a snapshot read later -- recorded under the lock.
export function addInput(w, input) {
  return withJournal(w, () => w.store.append(w.id, "input", { ...input, id: nextId(current(w), "input") }));
}

export { linkRun } from "./runs.mjs";

// ---- a generated test's lifecycle (0.1.0, ADR 0032) ---------------------------------------------
// Every write below is taken under the journal lock and recorded ONCE: an event appended again with
// the same eventId is the same event, and the record already there is what comes back.

// One lifecycle record. `subject` is what it is about (an obligation, a version, an execution),
// `inputs` what it was made from; together with the kind and the attempt they are its eventId.
export function recordOnce(w, kind, record, { subject, attempt, inputs } = {}) {
  const eventId = record.eventId ?? eventIdOf(kind, subject ?? record.obligation ?? record.version ?? record.execution ?? null, attempt ?? record.attempt, inputs ?? record);
  return withJournal(w, () => w.store.appendOnce(w.id, kind, { ...record, eventId, id: record.id ?? nextId(current(w), kind) }));
}

// A document the test is bound to, written once under the name of its own digest.
export const keepArtifact = (w, kind, value) => withJournal(w, () => w.store.putArtifact(w.id, kind, value));

// A frozen case version (src/qa/generation/version.mjs freezeVersion), written once.
export const keepVersion = (w, frozen) => withJournal(w, () => w.store.putVersion(w.id, frozen));

export { testsOf, lineageOf } from "./model.mjs";
export { VERIFICATION_OUTCOMES, countsForCoverage, accusesProduct } from "./verification.mjs";
export { MILESTONES, milestoneOf } from "./vocab.mjs";

// Every investigation, newest first, as a list can show it.
export function summaries(store, limit = 50) {
  return store.list().slice(0, limit).map((id) => summaryOf(id, modelOf(store.read(id))));
}

// What a person scanning a list needs: where each stands, why it stopped, and
// whether it is waiting for somebody -- read off the journal, never re-derived.
function summaryOf(id, m) {
  const counts = Object.fromEntries(m.findings.map((f) => f.outcome).map((o, _, all) => [o, all.filter((x) => x === o).length]));
  return { id, at: m.meta?.at ?? null, objective: m.meta?.objective ?? "", mode: m.meta?.mode ?? null, environment: m.meta?.environment?.id ?? null, actions: m.actions.length, findings: counts, cancelled: Boolean(m.cancelled), lifecycle: m.lifecycle, stop: stopNow(m), inputMode: m.meta?.inputMode ?? "screen", openQuestions: m.questions.filter((q) => !m.answers.some((a) => a.question === q.id)).length };
}

const stopNow = (m) => (m.lifecycle === "active" ? latestSnapshot(m)?.stop ?? null : m.completed.at(-1)?.reason ?? null);

// What earlier investigations touched and found, for a plan to weigh.
export function historyOf(store, except = null) {
  return store.list().filter((id) => id !== except).slice(0, 20).map((id) => modelOf(store.read(id))).map((m) => ({ id: m.meta?.id, surfaces: [...new Set(m.actions.map((a) => a.surface).filter(Boolean))], findings: m.findings.map((f) => ({ key: f.key, outcome: f.outcome })) }));
}
