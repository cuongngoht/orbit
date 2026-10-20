// THE LOOP, the engine's half: the host's model chooses one engineering step at a time; this
// keeps the state that makes each choice checkable and each step safe -- all of it in the task.
//
//   context    where the task stands and what may happen next. Writes NOTHING, so the revision it
//              hands out is still true when the decision comes back
//   step       one decision: judged, recorded BEFORE anything runs (the decision, then the action
//              started), run outside every lock through an owner's port, then SETTLED -- its
//              receipts, files and verifications, how it ended, and what that moves
//   finish     completes only when every completion row holds; otherwise ends the task with a stop
//              the evidence supports, or refuses and says what is unmet
//   reconcile  an action whose step died before it settled: read back where its owner can, closed
//              as interrupted where it cannot -- and never run again by itself
//   cleanup    an ended task: runtime asked to stop each session THIS task started, under runtime's
//              own ownership rules -- and the task's sandbox stopped (once) and released
//   start      a requirement-backed or ad-hoc task, created and taken through its requirement
//
// Two locks, never nested: the task's own, taken by its write door for each operation, and the
// orchestrator's (`ports.lock`), held to judge-and-record and to settle -- never across a run. A
// crash between "recorded" and "settled" leaves an action open, which is why it is recorded first.
import { Blocked, Refused } from "../errors.mjs";
import { scrub } from "../scrub.mjs";
import { briefOf } from "./checks.mjs";
import { judge, judgeForm, protocolRules } from "./decision.mjs";
import { ACTIONS, ACTION_KINDS, chkOf, lastRecorded } from "./dispatch.mjs";
import { excerptOf } from "./failure.mjs";
import { hintOf } from "./hints.mjs";
import { checkRuns, kindOf, openActions, receiptsOf, sandboxReceipt, sandboxSessions, startRuns } from "./journal.mjs";
import { owedIds, planView, requiredIds } from "./obligations.mjs";
import { gateOf } from "./policy.mjs";
import { requirementOf } from "./readiness.mjs";
import { sandboxOf, sbxOf } from "./sandbox.mjs";
import { allowedNow, beforeAct, movesOf, to, unblocks } from "./stages.mjs";
import { STOP_EVIDENCE, stopOf } from "./stop.mjs";
import { completable, liveEvidenceOf, unmet } from "./verification.mjs";
import { CHECK_TIMEOUT_MS, DECISION_FIELDS, DECISION_FORBIDDEN, DECISION_SCHEMA, DOMAIN, LIFE, MAX_PATHS, RESULT, SANDBOX_STATE, STAGE } from "./vocab.mjs";

// ---- the world one look sees ----------------------------------------------------------------------

const workspaceOf = (ports, view) => (view.task.workspace ? ((ws) => ({ id: view.task.workspace, path: ws?.path ?? null, ready: Boolean(ws) }))(ports.workspace.found(view.task.id)) : null);

const investigationsOf = (ports, view) => new Map(view.receipts.filter((r) => r.domain === DOMAIN.INVESTIGATION).map((r) => [r.ref, ports.investigations.outcome(r.ref)]));

const requirementLook = (ports, view) => requirementOf(view.task, view.task.root ? ports.requirements.look(view.task) : null);

// What a look at a task costs only when something asks: the source tree its workspace holds now
// (git names it) and what the checkout declares a sandbox could start (understanding's memory).
const memo = (make) => ((box) => () => (box.done ? box.value : Object.assign(box, { done: true, value: make() }).value))({ done: false });

function liveTree(ports, id, workspace) {
  if (!workspace?.ready) return null;
  try { return ports.workspace.treeOf?.(id) ?? null; }
  catch { return null; }
}

const recordedTree = (ports, lw) => ((a) => (a ? ports.room?.read(`trees/${a.id}`)?.tree ?? null : null))(lastRecorded(lw));

const treesOf = (ports, lw) => ({ live: liveTree(ports, lw.id, lw.workspace), recorded: recordedTree(ports, lw) });

function startableOf(ports) {
  try { return ports.sandbox?.startable?.() ?? []; }
  catch { return []; }
}

// The checkout's component graph, as runtime understanding read it: null when it cannot be read, and
// then every component with a check is held to it (obligations.mjs WIDENED).
function graphOf(ports) {
  try { return ports.checks.graph?.() ?? null; }
  catch { return null; }
}

// Whether a check ran beside an ignored file, or its count could not be read: its record in the room says.
// A record that cannot be read says unpinned.
const unpinnedRun = (ports, run) => ((kept) => !kept || kept.unpinned !== false)(ports.room?.read(`checks/chk-${String(run.id).slice("act-".length)}`) ?? null);

// The tree the task's base revision holds, as git names it: what a baseline must have run on.
function baseTreeOf(ports, lw) {
  if (!lw.workspace?.ready || !lw.view.task.baseRevision) return null;
  try { return ports.workspace.treeAt?.(lw.id, lw.view.task.baseRevision) ?? null; }
  catch { return null; }
}

// The scope of the latest plan, read back from the task's room: what the change will reach before it does.
const plannedScope = (ports, view) => ((p) => (p ? ports.room?.read(`plans/${p.id}`)?.scope ?? null : null))(view.actions.filter((x) => x.type === "plan" && x.state === "succeeded").at(-1));

// ports: task · requirements · work · runtime · sandbox · workspace · checks · context · capabilities ·
// investigations · roomOf · lock · liveness · now · host · pid · pidStartedAt · actor (cli/autonomous-engineering.mjs)
export function loopWorld(ports, id) {
  const view = ports.task.view(id);
  const base = { id, view, events: ports.task.events(id), now: ports.now(), checks: ports.checks.declared(), describe: ports.capabilities.describe };
  const lw = { ...base, requirement: requirementLook(ports, view), workspace: workspaceOf(ports, view), investigations: investigationsOf(ports, view) };
  return Object.assign(lw, { tree: memo(() => treesOf(ports, lw)), startable: memo(() => startableOf(ports)), graph: memo(() => graphOf(ports)), planned: memo(() => plannedScope(ports, view)), baseTree: memo(() => baseTreeOf(ports, lw)), unpinned: (run) => unpinnedRun(ports, run) });
}

const roomed = (ports, id) => ({ ...ports, room: ports.roomOf(id) });

// ---- context ---------------------------------------------------------------------------------------

const openView = (lw, ports) => openActions(lw).map((a) => ({ id: a.id, kind: kindOf(a), mutates: a.mutates, startedAt: a.startedAt, settle: kindOf(a) === "implement" ? "record-changes reads the change back" : "reconcile reads it back, or closes it as interrupted" }));

// The latest run that failed: a declared check, or an application a sandbox started that stopped.
const failedRun = (lw) => [...checkRuns(lw), ...startRuns(lw)].sort((a, b) => a.at - b.at).reverse().find((r) => ["failed", "error"].includes(r.state)) ?? null;

// The ref a run's log and record are kept under: chk-n for a check, sbx-n for a sandbox's start.
const refOf = (run) => (run.purpose === "run" ? sbxOf(run) : chkOf(run));

function latestFailure(ports, lw) {
  const run = failedRun(lw);
  const kept = run ? ports.room.read(`checks/${refOf(run)}`) : null;
  if (!kept) return null;
  return { action: run.id, check: refOf(run), command: kept.command, class: kept.class, confidence: kept.confidence, signature: kept.signature, excerpt: excerptOf({ lines: (ports.room.log(refOf(run)) ?? "").split("\n") }, lw.workspace?.path ?? null) };
}

const checksView = (lw) => lw.checks.map((c) => ({ ...briefOf(c), required: requiredIds(lw).has(c.id), owed: owedIds(lw).includes(c.id) }));

const changesView = (lw) => ({ files: lw.view.changes.files, added: lw.view.changes.added, removed: lw.view.changes.removed, paths: lw.view.changes.paths.slice(0, MAX_PATHS).map((p) => p.path), more: Math.max(0, lw.view.changes.paths.length - MAX_PATHS) });

const stopView = (lw) => ((s) => (s ? { id: s.id, say: s.say } : null))(stopOf(lw));

const allowedSay = (lw) => `one of ${allowedNow(lw).join(", ") || "nothing"}`;

// What a stop says, and -- for the stop that leaves a way on -- what is worth trying.
const stopSay = (stop, lw) => [stop.say, stop.hints ? hintOf(lw) : null].filter(Boolean).join(". ");

const nextSay = (lw) => (stopOf(lw) ? stopSay(stopOf(lw), lw) : `next: ${hintOf(lw) ?? allowedSay(lw)} — decide on revision ${lw.view.revision}`);

const nextOf = (lw, room) => (room.read("pending") && lw.view.lifecycle !== LIFE.PAUSED ? "what a pause held back is applied by the next step, which then asks for a decision on what is there" : nextSay(lw));

const taskBrief = (v) => ({ id: v.task.id, objective: v.task.objective, work: v.task.work, root: v.task.root, snapshot: v.task.snapshot, baseRevision: v.task.baseRevision, workspace: v.task.workspace });

// The sandbox as a context shows it, read off the journal and the workspace's tree: its environment,
// its state (a READY one the workspace has left is STALE), the tree it was prepared at and the
// sessions it holds -- and how current the live evidence is. Runtime is not asked.
const sandboxView = (lw) => sandboxOf(lw);

const evidenceOf = (lw) => liveEvidenceOf(lw);

export function contextOf(ports, id) {
  const bound = roomed(ports, id);
  const lw = loopWorld(bound, id);
  return { task: taskBrief(lw.view), revision: lw.view.revision, lifecycle: lw.view.lifecycle, stage: lw.view.stage, attempt: lw.view.attempt, budget: lw.view.budget, repeats: lw.view.repeats, approvals: lw.view.approvals.filter((a) => ["pending", "granted"].includes(a.state)), open: openView(lw, bound), blocked: lw.view.blocked, requirement: lw.requirement, workspace: lw.workspace, changes: changesView(lw), latestFailure: latestFailure(bound, lw), checks: checksView(lw), verificationPlan: planView(lw), verification: lw.view.verification, completion: lw.view.stage === STAGE.REVIEWING ? unmet(lw) : null, pending: Boolean(bound.room.read("pending")), stop: stopView(lw), allowed: allowedNow(lw), sandbox: sandboxView(lw), evidence: evidenceOf(lw), next: nextOf(lw, bound.room), protocol: { schemaVersion: DECISION_SCHEMA, actions: ACTION_KINDS } };
}

// ---- context, with what runtime says about the sandbox NOW ------------------------------------------

const LIVE_FIELDS = ["components", "leases", "connectivity", "dataIsolation", "qa"];

const liveOf = (view) => Object.fromEntries(LIVE_FIELDS.filter((k) => view[k] !== undefined).map((k) => [k, view[k]]));

async function sandboxLive(ports, c) {
  if (!c.sandbox || c.sandbox.state === SANDBOX_STATE.RELEASED) return null;
  try { return liveOf(await ports.sandbox.status({ task: c.task.id })); }
  catch { return null; }
}

// The context, and under `sandbox.live` what the sandbox's components and network say right now --
// asked of runtime only when the task has a sandbox, and never an error: a sandbox runtime cannot read
// is a context without its live part.
export async function contextNow(ports, id) {
  const c = contextOf(ports, id);
  const live = await sandboxLive(ports, c);
  return live ? { ...c, sandbox: { ...c.sandbox, live } } : c;
}

// ---- applying task operations ----------------------------------------------------------------------

// What a refusal of the task's own door means for the moves after it: a pause defers them (they are
// kept and applied after a person resumes), an ending drops them, a spent budget stops them (the
// derived stop then says why), and anything else is the engine failing, which is thrown.
const DEFER = [
  { when: (e) => e.code === "TASK_PAUSED", left: (ops, i) => ops.slice(i) },
  { when: (e) => e.code === "TASK_ENDED", left: () => [] },
  { when: (e) => /^BUDGET:/.test(e.message), left: () => [] },
];

function deferred(e, ops, i) {
  const row = e instanceof Refused ? DEFER.find((d) => d.when(e)) : null;
  if (!row) throw e;
  return row.left(ops, i);
}

// -> the ops a pause left unapplied.
function applied(ports, id, ops) {
  for (const [i, [op, given]] of ops.entries()) {
    try { ports.task.apply(id, op, given); }
    catch (e) { return deferred(e, ops, i); }
  }
  return [];
}

// -> whether moves a pause deferred were applied now.
function applyPending(ports, id) {
  const pending = ports.room.read("pending");
  if (!pending || ports.task.view(id).lifecycle === LIFE.PAUSED) return false;
  ports.room.remove("pending");
  keepLeft(ports, pending.action, applied(ports, id, pending.ops));
  return true;
}

function keepLeft(ports, action, left) {
  if (left.length) ports.room.write("pending", { action, ops: left });
}

// ---- step: judged and recorded ---------------------------------------------------------------------

const decisionOf = (d) => ({ observed: d.observed, hypothesis: d.hypothesis, nextAction: d.action.kind, evidence: d.evidence, reason: d.reason });

const gateFor = (lw, d) => gateOf(d.action.kind, d.action, lw.describe);

const actStart = (row, d, lw, gate) => ({ type: row.type(d.action, lw), tool: row.tool(d.action, lw) ?? undefined, label: String(row.label(d.action, lw) ?? "").slice(0, 240) || undefined, mutates: row.mutates(d.action, lw, gate) || undefined, approval: d.approval, environment: gate?.environment, params: gate?.params });

function asked(ports, lw, d, gate) {
  const done = ports.task.apply(lw.id, "request-approval", { type: gate.type, tool: gate.tool, environment: gate.environment, params: gate.params, reason: d.reason ?? d.hypothesis, risk: gate.risk });
  return { done: { task: lw.id, state: "waiting-approval", approval: done.lines[0].id, say: `${done.lines[0].id} asks a person to allow this action, once, in Orbit Control (Mission Control → Approvals). Read the context again; once it is granted, send the same action with "approval": "${done.lines[0].id}"` } };
}

const runningOf = (ports, act, kind) => ({ action: act.id, kind, host: ports.host, pid: ports.pid, pidStartedAt: ports.pidStartedAt?.() ?? null, at: act.at });

function started(ports, lw, d, gate) {
  const row = ACTIONS[d.action.kind];
  applied(ports, lw.id, beforeAct(lw, d.action.kind));
  const act = ports.task.apply(lw.id, "act-start", actStart(row, d, lw, gate)).lines.find((l) => l.kind === "action-started");
  ports.room.write("running", runningOf(ports, act, d.action.kind));
  return { lw, d, row, act, kind: d.action.kind };
}

function recorded(ports, lw, d) {
  const gate = gateFor(lw, d);
  judge(d, { lw, gate, fp: gate ? ports.task.fingerprint(gate) : null });
  ports.task.apply(lw.id, "decide", decisionOf(d));
  return gate && !d.approval ? asked(ports, lw, d, gate) : started(ports, lw, d, gate);
}

// A stop the evidence says to WRITE -- a requirement that moved, a loop going round, a spent budget --
// is written instead of anything the decision asked for; a cancel is cleaned up after.
function halted(ports, lw) {
  const stop = stopOf(lw);
  if (stop?.id === "cancelled") return { cancelled: true };
  if (!stop?.writes) return null;
  ports.task.apply(lw.id, ...stop.writes);
  return { done: { task: lw.id, state: "stopped", stop: stop.id, say: stop.say } };
}

// A decision made before moves a pause deferred were applied was made on a stage the host never
// saw: the moves are applied, and the host decides again on what is there now.
const caughtUp = (ports, id) => ({ done: { task: id, state: "caught-up", say: `what a pause held back was applied (now ${ports.task.view(id).stage}) — read the context again and decide on revision ${ports.task.view(id).revision}` } });

function takenDown(ports, id, d) {
  if (applyPending(ports, id)) return caughtUp(ports, id);
  const lw = loopWorld(ports, id);
  return halted(ports, lw) ?? recorded(ports, lw, d);
}

// ---- step: run ---------------------------------------------------------------------------------

function stoppedBy(e) {
  if (e instanceof Refused || e instanceof Blocked) return { outcome: RESULT.ERROR, reason: scrub(e.message).slice(0, 240), summary: scrub(e.message).slice(0, 240) };
  throw e;
}

async function attempted(ports, taken) {
  try { return await taken.row.run(ports, taken.lw, taken.d.action, taken.act); }
  catch (e) { return stoppedBy(e); }
}

// ---- step: settled -----------------------------------------------------------------------------

const keyOf = (r) => `${r.domain}:${r.ref}`;

const endOf = (act, r) => (r.outcome === RESULT.ERROR ? ["act-fail", { action: act.id, reason: r.reason ?? undefined, receipt: r.receipts?.[0] ? keyOf(r.receipts[0]) : undefined, summary: r.summary ?? undefined }] : ["act-complete", { action: act.id, outcome: r.outcome, receipt: r.receipts?.[0] ? keyOf(r.receipts[0]) : undefined, summary: r.summary ?? undefined }]);

const recordsOf = (act, r) => [...(r.receipts ?? []).map((x) => ["link-receipt", { ...x, action: act.id }]), ...(r.files ?? []).map((f) => ["link-file", { path: f.path, change: f.change, added: f.added, removed: f.removed }]), ...(r.verifications ?? []).map((v) => ["link-verification", v]), ...(r.closes ? [["act-complete", { action: r.closes, outcome: "succeeded", summary: "the change was read back" }]] : []), endOf(act, r)];

const summaryOf = (lw) => `${lw.view.changes.files} file(s) changed, +${lw.view.changes.added} -${lw.view.changes.removed}; ${checkRuns(lw).filter((r) => r.state === "succeeded").length} check run(s) passed; reviewed against its plan`;

// After the moves: complete what a passing review proved, or write a stop the evidence now says.
function concluded(ports, id, taken, r) {
  const lw = loopWorld(ports, id);
  if (lw.view.terminal || lw.view.lifecycle === LIFE.PAUSED) return;
  if (taken.kind === "review" && r.outcome === RESULT.SUCCEEDED && completable(lw)) return void ports.task.apply(id, "complete", { summary: summaryOf(lw) });
  const stop = stopOf(lw);
  if (stop?.writes) ports.task.apply(id, ...stop.writes);
}

function moved(ports, id, taken, r) {
  const lw = loopWorld(ports, id);
  keepLeft(ports, taken.act.id, applied(ports, id, [...unblocks(lw, taken.kind, r), ...movesOf(lw, taken.kind, r)]));
  concluded(ports, id, taken, r);
}

const failureBrief = (f) => (f ? { class: f.class, confidence: f.confidence, because: f.because, signature: f.signature } : null);

function answerOf(ports, id, taken, r) {
  const lw = loopWorld(ports, id);
  return { task: id, action: taken.act.id, kind: taken.kind, outcome: r.outcome, summary: r.summary ?? null, reason: r.reason ?? null, receipts: (r.receipts ?? []).map(keyOf), failure: failureBrief(r.failure), data: r.data ?? null, revision: lw.view.revision, lifecycle: lw.view.lifecycle, stage: lw.view.stage, attempt: lw.view.attempt, completion: lw.view.stage === STAGE.REVIEWING ? unmet(lw) : null, stop: stopView(lw), allowed: allowedNow(lw), next: nextSay(lw) };
}

function settled(ports, id, taken, r) {
  ports.room.remove("running");
  if (r.outcome === "open") return answerOf(ports, id, taken, r);
  applied(ports, id, recordsOf(taken.act, r));
  moved(ports, id, taken, r);
  return answerOf(ports, id, taken, r);
}

// What a step that ran nothing answers: a stop it wrote, an approval it asked for, a cancel it
// cleaned up after.
async function shortOf(ports, id, taken) {
  if (taken.cancelled) return { task: id, state: "cancelled", cleanup: await cleanup(ports, id) };
  return taken.done ?? null;
}

// -> the step's answer. Throws Refused (nothing written) for a decision the protocol refuses.
export async function step(ports, id, d) {
  judgeForm(d);
  const bound = roomed(ports, id);
  const taken = bound.lock(id, () => takenDown(bound, id, d));
  return (await shortOf(ports, id, taken)) ?? ran(bound, id, taken);
}

async function ran(ports, id, taken) {
  const r = await attempted(ports, taken);
  return ports.lock(id, () => settled(ports, id, taken, r));
}

// ---- an engine step: no decision, an action the engine takes itself (start's requirement check) ---

async function engineStep(ports, id, kind) {
  const taken = ports.lock(id, () => started(ports, loopWorld(ports, id), { action: { kind } }, null));
  const r = await attempted(ports, taken);
  return ports.lock(id, () => settled(ports, id, taken, r));
}

// ---- finish ------------------------------------------------------------------------------------

function named(ports, lw, stop, because) {
  const row = STOP_EVIDENCE[stop];
  if (!row) throw new Refused(`STOP: ${stop} is not a stop a host may name — one of ${Object.keys(STOP_EVIDENCE).join(", ")}`);
  if (!row.holds(lw)) throw new Refused(`STOP: ${stop} needs ${row.needs}, and the journal does not show it`);
  ports.task.apply(lw.id, "fail", { stop, because });
  return { task: lw.id, state: "failed", stop };
}

function completedNow(ports, lw) {
  ports.task.apply(lw.id, "complete", { summary: summaryOf(lw) });
  return { task: lw.id, state: "completed" };
}

function stoppedNow(ports, lw, stop) {
  ports.task.apply(lw.id, ...stop.writes);
  return { task: lw.id, state: "stopped", stop: stop.id, say: stop.say };
}

const unmetSay = (lw) => `NOT_COMPLETE: ${unmet(lw).map((u) => u.say).join("; ")} — keep going, or end it with a stop the journal supports: finish --stop=<${Object.keys(STOP_EVIDENCE).join("|")}>`;

function concludedNow(ports, lw) {
  if (completable(lw)) return completedNow(ports, lw);
  const stop = stopOf(lw);
  if (stop?.writes) return stoppedNow(ports, lw, stop);
  throw new Refused(unmetSay(lw));
}

const ENDED_ALREADY = (lw) => ({ task: lw.id, state: lw.view.lifecycle.toLowerCase(), say: `the task is ${lw.view.lifecycle} already` });

function finishing(ports, id, opts) {
  applyPending(ports, id);
  const lw = loopWorld(ports, id);
  if (lw.view.lifecycle === LIFE.CANCELLED) return { cancelled: true };
  if (lw.view.terminal) return ENDED_ALREADY(lw);
  return opts.stop ? named(ports, lw, opts.stop, opts.because) : concludedNow(ports, lw);
}

export async function finish(ports, id, opts = {}) {
  const bound = roomed(ports, id);
  const done = bound.lock(id, () => finishing(bound, id, opts));
  return done.cancelled ? { task: id, state: "cancelled", cleanup: await cleanup(ports, id) } : done;
}

// ---- reconcile -------------------------------------------------------------------------------------

// How old an action must be before a host that cannot ask the machine it ran on may call it gone.
const STALE_AFTER_MS = CHECK_TIMEOUT_MS + 5 * 60000;

const runnerOf = (ports, act) => ((r) => (r?.action === act.id ? r : null))(ports.room.read("running"));

const LIVENESS = [
  { when: (alive) => alive === true, gone: () => false },
  { when: (alive) => alive === false, gone: () => true },
  { when: () => true, gone: (lw, act) => Date.parse(lw.now) - Date.parse(act.startedAt) > STALE_AFTER_MS },
];

const gone = (ports, lw, act) => ((runner) => !runner || LIVENESS.find((l) => l.when(ports.liveness(runner))).gone(lw, act))(runnerOf(ports, act));

const unsettledIn = (lw) => openActions(lw).filter((a) => kindOf(a) !== "implement");

function stillRunning(ports, lw, open) {
  const running = open.filter((a) => !gone(ports, lw, a));
  if (running.length) throw new Refused(`STILL_RUNNING: ${running.map((a) => a.id).join(", ")} is still being run by its process — it settles itself`);
}

function reconcilable(ports, id) {
  const lw = loopWorld(ports, id);
  if (!unsettledIn(lw).length) throw new Refused("NOTHING_OPEN: no action of this task is waiting to be settled");
  stillRunning(ports, lw, unsettledIn(lw));
  return { lw, open: unsettledIn(lw) };
}

async function readBack(ports, lw, act) {
  try { return await ACTIONS[kindOf(act)].readBack(ports, lw, act); }
  catch (e) { return stoppedBy(e); }
}

function reconciledOne(ports, id, taken, r) {
  applied(ports, id, recordsOf(taken.act, r));
  if (r.outcome === RESULT.SUCCEEDED) moved(ports, id, taken, r);
  return { action: taken.act.id, kind: taken.kind, outcome: r.outcome, summary: r.summary ?? null };
}

function reconciledAll(ports, id, answers) {
  const settledNow = answers.map((a) => reconciledOne(ports, id, a.taken, a.r));
  ports.room.remove("running");
  return { task: id, settled: settledNow, context: contextOf(ports, id) };
}

export async function reconcile(ports, id) {
  const bound = roomed(ports, id);
  const found = bound.lock(id, () => reconcilable(bound, id));
  const answers = [];
  for (const act of found.open) answers.push({ taken: { act, kind: kindOf(act) }, r: await readBack(bound, found.lw, act) });
  return bound.lock(id, () => reconciledAll(bound, id, answers));
}

// ---- cleanup -----------------------------------------------------------------------------------

const ENDED_SESSION = ["STOPPED", "GONE", "LOST", "NOT_RUNNING", "UNKNOWN", "EXITED"];

// The runtime sessions THIS task started in the developer's checkout and has not seen end -- and only
// those. A session of its sandbox names an environment, and is stopped through the sandbox.
const owedStops = (lw) => receiptsOf(lw, DOMAIN.RUNTIME).filter((r) => !r.environment && !ENDED_SESSION.includes(r.outcome));

const owedBoxed = (lw) => sandboxSessions(lw).filter((r) => !ENDED_SESSION.includes(r.outcome));

const STOP_WORDS = [
  { from: "stopped", outcome: "STOPPED" },
  { from: "gone", outcome: "GONE" },
  { from: "refused", outcome: "REFUSED" },
];

function stopAnswer(ref, done) {
  const hit = STOP_WORDS.map((w) => ({ ...w, row: (done[w.from] ?? []).find((x) => x.session === ref) })).find((w) => w.row);
  return hit ? { ref, outcome: hit.outcome, why: hit.row.why ?? hit.row.how ?? null } : { ref, outcome: "NOT_RUNNING", why: "runtime holds nothing open under it" };
}

async function stoppedOne(ports, ref) {
  try { return stopAnswer(ref, await ports.runtime.stop({ session: ref })); }
  catch (e) { return { ref, outcome: "UNKNOWN", why: scrub(e.message).slice(0, 200) }; }
}

// The one receipt a session keeps as it moves: its environment and tree stay, only its word changes.
const stopReceipt = (a) => ["link-receipt", { domain: DOMAIN.RUNTIME, ref: a.ref, outcome: a.outcome, summary: `asked to stop when the task ended: ${a.why ?? a.outcome}`.slice(0, 240), environment: a.environment, sourceTree: a.sourceTree }];

async function stopsOwed(ports, lw) {
  const answers = [];
  for (const r of owedStops(lw)) answers.push(await stoppedOne(ports, r.ref));
  return answers;
}

// ONE stop for the sandbox, whatever it holds: runtime stops only what it proves is the sandbox's own.
async function boxStopped(ports, id) {
  try { return await ports.sandbox.stop({ task: id }); }
  catch (e) { return { failed: scrub(e.message).slice(0, 200) }; }
}

const boxAnswer = (r, done) => ({ ...(done.failed ? { ref: r.ref, outcome: "UNKNOWN", why: done.failed } : stopAnswer(r.ref, done)), environment: r.environment, sourceTree: r.sourceTree ?? undefined });

async function boxStops(ports, lw) {
  const owed = owedBoxed(lw);
  if (!owed.length) return [];
  const done = await boxStopped(ports, lw.id);
  return owed.map((r) => boxAnswer(r, done));
}

// The sandbox itself is owed a release until a receipt says it was released.
const owedRelease = (lw) => ((r) => (r && r.outcome !== SANDBOX_STATE.RELEASED ? r : null))(sandboxReceipt(lw));

const releaseAnswer = (r, done) => ({ ref: r.ref, environment: r.environment ?? r.ref, sourceTree: r.sourceTree ?? undefined, released: done.released === true, why: done.why ?? null });

async function boxReleased(ports, lw) {
  const owed = owedRelease(lw);
  if (!owed) return null;
  try { return releaseAnswer(owed, await ports.sandbox.release({ task: lw.id })); }
  catch (e) { return releaseAnswer(owed, { released: false, why: scrub(e.message).slice(0, 200) }); }
}

const releaseReceipt = (a) => ["link-receipt", { domain: DOMAIN.SANDBOX, ref: a.ref, outcome: a.released ? SANDBOX_STATE.RELEASED : SANDBOX_STATE.REFUSED, summary: (a.released ? "released when the task ended" : `not released: ${a.why ?? "runtime could not prove it all the task's own"}`).slice(0, 240), environment: a.environment, sourceTree: a.sourceTree }];

const stoppedAll = async (ports, lw) => [...(await stopsOwed(ports, lw)), ...(await boxStops(ports, lw))];

const endingReceipts = (answers, sandbox) => [...answers.map(stopReceipt), ...(sandbox ? [releaseReceipt(sandbox)] : [])];

async function endedUp(ports, lw) {
  const answers = await stoppedAll(ports, lw);
  const sandbox = await boxReleased(ports, lw);
  ports.lock(lw.id, () => applied(ports, lw.id, endingReceipts(answers, sandbox)));
  return { task: lw.id, sessions: answers.map(({ ref, outcome, why }) => ({ ref, outcome, why })), sandbox };
}

export async function cleanup(ports, id) {
  const lw = loopWorld(roomed(ports, id), id);
  if (!lw.view.terminal) throw new Refused("RUNNING: cleanup is for a task that ended — a running task keeps what it started");
  return endedUp(roomed(ports, id), lw);
}

export function removeWorkspace(ports, id) {
  const lw = loopWorld(roomed(ports, id), id);
  if (!lw.view.terminal) throw new Refused("RUNNING: a workspace is removed only once its task ended — the change and its evidence are still in use");
  return ports.workspace.remove({ task: id, project: lw.view.task.project, checkout: lw.view.task.checkout });
}

// ---- start and resume --------------------------------------------------------------------------

const PROVIDER = "autonomous-engineering";

const budgetOf = (spec) => ({ attempts: spec.attempts, actions: spec.actions, minutes: spec.minutes });

function activeFor(ports, work) {
  const views = ports.task.list().map((t) => ports.task.view(t)).filter((v) => !v.terminal);
  return views.find((v) => v.task.work === work)?.task.id ?? null;
}

function snapshotChosen(ports, req, spec) {
  const latest = ports.requirements.latest(req.root);
  if (!latest) throw new Refused(`NO_SNAPSHOT: ${spec.ref} has no frozen snapshot — settle it and freeze one first (orbit-requirements: requirements snapshot ${req.root})`);
  return latest;
}

// The work rests on the snapshot the task does: found or started on it, never moved to a newer one
// without a person's choice.
function workOn(ports, req, latest, objective) {
  const work = ports.work.ensure({ root: req.root, identity: req.identity, objective, snapshot: latest.id });
  if (work.snapshot && work.snapshot !== latest.id) throw new Refused(`WORK_SNAPSHOT: the work rests on ${work.snapshot}, and the requirement's newest snapshot is ${latest.id} — a person chooses which the work rests on (work start --ref=${req.root} --snapshot=${latest.id}), then a task starts`);
  return work;
}

const created = (ports, given) => ports.task.create({ ...given, provider: PROVIDER, actor: ports.actor ?? undefined, baseRevision: ports.base.head() }).task;

function requirementTask(ports, spec) {
  const req = ports.requirements.resolve(spec.ref);
  const latest = snapshotChosen(ports, req, spec);
  const objective = spec.objective ?? ports.work.objectiveOf(req.root) ?? `Implement ${req.identity?.id ?? spec.ref}`;
  const work = workOn(ports, req, latest, objective);
  return ((active) => (active ? { resumed: active } : { created: created(ports, { objective, work: work.work, root: req.root, snapshot: latest.id, snapshotDigest: latest.digest, ...budgetOf(spec) }) }))(activeFor(ports, work.work));
}

async function begun(ports, id, first) {
  ports.lock(id, () => applied(ports, id, [to(first)]));
  if (first === STAGE.REQUIREMENT) await engineStep(roomed(ports, id), id, "check-requirement");
  return { task: id, created: true, dirty: ports.base.dirty(), context: contextOf(ports, id) };
}

export async function start(ports, spec) {
  if (!spec.ref) return begun(ports, created(ports, { objective: spec.objective, ...budgetOf(spec) }), STAGE.CONTEXT);
  const got = requirementTask(ports, spec);
  if (got.resumed) return { task: got.resumed, created: false, resumed: true, context: contextOf(ports, got.resumed) };
  return begun(ports, got.created, STAGE.REQUIREMENT);
}

// A ref of a task, or of the work an active task executes. It never un-pauses: a person resumes.
export function resume(ports, ref) {
  if (/^tsk-[a-f0-9]{12}$/.test(String(ref))) return { task: ref, context: contextOf(ports, ref) };
  const work = ports.work.find(ref);
  const id = work ? activeFor(ports, work) : null;
  if (!id) throw new Refused(`NO_ACTIVE_TASK: no task is running for ${ref} in this checkout — start one`);
  return { task: id, context: contextOf(ports, id) };
}

// ---- the protocol, as the tables say it ---------------------------------------------------------

export const protocolOf = () => ({ schemaVersion: DECISION_SCHEMA, fields: DECISION_FIELDS, forbidden: DECISION_FORBIDDEN, rules: protocolRules(), actions: ACTION_KINDS.map((kind) => ({ kind, fields: ACTIONS[kind].fields, required: ACTIONS[kind].required })), stops: Object.keys(STOP_EVIDENCE) });

