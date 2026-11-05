// ONE BENCHMARK RUN carried by a ship: its room named and journaled BEFORE it starts (so a crash never loses which room
// to read back), the run started as a command, the ship's own task read every 15 seconds while it runs (a person's pause
// or cancel stops the child and removes its containers by their label; the run is carried on by `resume`, never sent
// again), the run's task linked to the ship's as soon as its manifest names it (so Orbit Live follows the child), and
// what it came to judged from its room by the tables in rows.mjs -- never from the command's word alone.
//
//   begun(ctx, type, label, doc) -> act        settledAct(ctx, act, doc, settled, close)
//   dispatched(ctx, f, row, kind) -> verdict-bearing result     carriedOn(ctx, x) -> result   (an action left running)
//   runRoomOf(storeRoot, run) -> { dir, manifest, ending, report, verified }
import { randomBytes } from "node:crypto";
import { copyFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sha } from "../../../src/hash.mjs";
import { physical, within } from "../../../src/project/boundary.mjs";
import { argvOf, controlRuns, controlVerdict, repairVerdict, rowVerdict } from "./rows.mjs";
import { docWritten, jsonAtFile } from "./room.mjs";
import { touchedBy } from "./workspace.mjs";

const RUN_ID = /^bnr-[a-f0-9]{12}$/;

export const newRunIdOf = () => `bnr-${randomBytes(6).toString("hex")}`;

export const iso = (ctx) => new Date(ctx.now()).toISOString();

export function runRoomOf(storeRoot, run) {
  const dir = RUN_ID.test(String(run)) ? join(storeRoot, "benchmark", run) : null;
  const at = (rel) => (dir ? jsonAtFile(join(dir, rel)) : null);
  return { dir, manifest: at("manifest.json"), ending: at("ending.json"), report: at("report.json"), verified: at("verified.json") };
}

// A row that did not hold, with its diagnosis bundle (0.5.0, B6): what its latest run's own report says of how it ended
// -- the host's finish, the budget it used, what the relay refused, where a run stopped short -- beside the run's room,
// so nobody has to read the room to diagnose it. A run that never began has no room and no bundle.
export const runDiagnosis = (storeRoot, r) => ((room) => ({ row: r.row.id, state: r.v.state, code: r.v.code, says: r.v.says, run: room.dir ? r.v.run : null, room: room.dir, diagnosis: room.report?.diagnosis ?? null }))(runRoomOf(storeRoot, String(r.v.run ?? "").split(" ")[0]));

// ---- an action, its document written first and replaced whole when it settles ------------------------------------------

export function begun(ctx, type, label, doc) {
  const act = ctx.door.actStart(ctx.task, type, label);
  docWritten(ctx.room, `steps/${act}.json`, { act, type, ...doc, at: iso(ctx) });
  return act;
}

// The document is replaced BEFORE the journal is told, so an action whose process died between the two is completed
// from what it settled -- read back, never run again.
export function settledAct(ctx, act, doc, settled, close) {
  docWritten(ctx.room, `steps/${act}.json`, { ...doc, act, settled: { ...settled, at: iso(ctx) } });
  for (const r of close.receipts ?? []) ctx.door.receipt(ctx.task, { ...r, action: act });
  if (close.verification) ctx.door.verification(ctx.task, close.verification);
  return ctx.door.actComplete(ctx.task, act, close.outcome, close.receipt, close.summary);
}

// ---- while a run runs ----------------------------------------------------------------------------------------------------

const HELD = ["PAUSED", "CANCELLED"];

// Every 15 seconds: whether a person held the ship (then the child stops), and whether the child's task can be linked.
const watcher = (ctx, act, run) => {
  const s = { linked: false };
  return () => (HELD.includes(ctx.door.show(ctx.task).lifecycle) ? "stop" : (s.linked ||= childLinked(ctx, act, run), null));
};

function childLinked(ctx, act, run) {
  const child = run ? runRoomOf(ctx.storeRoot, run).manifest?.task : null;
  if (child) ctx.door.receipt(ctx.task, { domain: "task", ref: child, outcome: "STARTED", summary: `benchmark run ${run}`, action: act });
  return Boolean(child);
}

// ---- what a row, a control set or a repair came to -------------------------------------------------------------------

const outcomeWord = (v) => (/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(String(v.outcome ?? "")) ? v.outcome : v.state);

// A run a restart interrupted proved nothing either way: not verified, never violated.
const STATE_OF = { HELD: "satisfied", VERIFIED: "satisfied", BLOCKED: "blocked", UNSETTLED: "not-verified", HELD_BY_PERSON: "not-verified", INTERRUPTED: "not-verified" };

// The row's word in the ship's journal: its receipt (the run, by the benchmark's id), a verification row naming what
// it had to come to -- satisfied or violated only on that receipt, otherwise blocked or not verified -- and the action
// closed on it.
const PROVEN = ["satisfied", "violated"];

const stateOf = (v, receipt) => ((s) => (receipt || !PROVEN.includes(s) ? s : "not-verified"))(STATE_OF[v.state] ?? "violated");

export function closeOf(row, v, label) {
  const ref = String(v.run ?? "").split(" ")[0];
  const receipt = RUN_ID.test(ref) ? `test:${ref}` : undefined;
  const state = stateOf(v, receipt);
  return { receipts: receipt ? [{ domain: "test", ref, outcome: outcomeWord(v), summary: `${row.id}: ${v.says}` }] : [], verification: { subject: row.id, obligation: `${row.id} ${label}`, state, evidence: PROVEN.includes(state) ? receipt : undefined }, outcome: state === "satisfied" ? "succeeded" : "failed", receipt, summary: `${row.id}: ${v.state} — ${v.says}` };
}

// What a run cost the ship's budget: nothing for a verification or a control set; what a model-carried run's host
// REPORTED; for a run a restart interrupted, UNKNOWN -- what its ended rounds reported, and never the allowance of a round
// nobody saw end, so interruptions (bounded by INTERRUPTED_RUNS) never spend --usd; otherwise -- only to keep the budget
// from being overrun, never as a cost anyone reads -- the most it was allowed, said as ESTIMATED.
const COSTS = [
  { when: (kind) => kind === "verify" || kind === "controls", cost: () => ({ usd: 0, basis: "NONE" }) },
  { when: (kind, v) => v.state === "INTERRUPTED", cost: (kind, v) => ({ usd: typeof v.costUsd === "number" ? v.costUsd : null, basis: "UNKNOWN" }) },
  { when: (kind, v) => typeof v.costUsd === "number", cost: (kind, v) => ({ usd: v.costUsd, basis: "REPORTED" }) },
  { when: () => true, cost: (kind, v, usd) => ({ usd, basis: "ESTIMATED" }) },
];

const costOf = (kind, v, usd) => COSTS.find((r) => r.when(kind, v)).cost(kind, v, usd);

const expectedSaid = (row) => (row.run === "controls" ? "holds its controls" : `comes to ${(row.expect ?? ["REPAIRED_VERIFIED"]).join(" or ")}`);

const cycleOf = (f, doc) => ({ commit: doc.commit, tree: doc.tree, digest: doc.kind === "repair" ? null : f.firstDigest ?? null });

const shipOf = (f, row) => ({ harness: firstSeen(f, "harness"), caseDigest: firstSeen(f, "caseDigest", row.case) });

// The harness and each case's digest as the ship FIRST saw them, across every cycle: what every later run must match.
const firstSeen = (f, key, c = null) => f.acts.map((x) => x.d.settled?.verdict).filter((v) => v && v[key] && (!c || v.case === c)).map((v) => v[key])[0] ?? null;

function verdictOf(ctx, f, doc, answer) {
  const room = runRoomOf(ctx.storeRoot, doc.planned.run);
  const base = { row: doc.rowDef, answer, room, cycle: cycleOf(f, doc), ship: shipOf(f, doc.rowDef) };
  if (doc.kind === "repair") return repairVerdict({ ...base, ...repairFacts(ctx, doc, room) });
  return doc.rowDef.run === "controls" ? controlVerdict({ ...base, rooms: controlRuns(answer?.json).map((r) => runRoomOf(ctx.storeRoot, r)), case: ctx.cases.get(doc.rowDef.case), realHeld: realHeld(f, doc.rowDef.case) }) : rowVerdict(base);
}

const realHeld = (f, c) => f.rows.get(`${c}:real`)?.v.state === "HELD";

// A verified candidate's patch, copied out of the run's room into the ship's (a file of the room only, never a link out
// of it), digested as the verifier digested it, and read by git for the paths it really touches.
function repairFacts(ctx, doc, room) {
  const verified = room.verified;
  const file = inside(verified?.candidate?.patch, room.dir) ? copied(ctx, doc, verified.candidate.patch) : null;
  return { verified, case: ctx.cases.get(doc.rowDef.case), policy: ctx.policy, patch: file ? { file, digest: sha(readFileSync(file, "utf8")), touched: touchedBy(ctx.world, doc.workspace, file) } : null };
}

// Inside the run's room by the real path of each -- the native one on Windows, where a short name (RUNNER~1) and the
// long one are one directory -- and never the room itself.
function inside(file, dir) {
  try { return Boolean(file && dir) && physical(file) !== physical(dir) && within(physical(dir), physical(file)); }
  catch { return false; }
}

function copied(ctx, doc, file) {
  ctx.room.io.ensureDir(ctx.room.at("repairs"));
  copyFileSync(file, ctx.room.at("repairs", `${doc.act}.patch`));
  return ctx.room.at("repairs", `${doc.act}.patch`);
}

// What a run came to, settled into its action -- unless the ship was held while it ran: then the action stays open,
// and `resume` reads the run back.
function settledRun(ctx, f, doc, answer) {
  const v = verdictOf(ctx, f, doc, answer);
  const settled = { verdict: { ...v, case: doc.rowDef.case }, cost: costOf(doc.kind === "repair" ? "repair" : doc.rowDef.run, v, doc.usd), answer: { code: answer?.code ?? null, err: answer?.err ?? null }, patch: v.patchDigest ? { file: ctx.room.at("repairs", `${doc.act}.patch`), digest: v.patchDigest } : null };
  settledAct(ctx, doc.act, doc, settled, closeOf(doc.rowDef, v, doc.kind === "repair" ? "is repaired and independently verified" : expectedSaid(doc.rowDef)));
  return { settled: true, verdict: v };
}

async function heldWhileRunning(ctx, doc) {
  if (doc.planned.run) await ctx.world.bench(["cleanup", doc.planned.run], {});
  return { settled: false, held: true };
}

// ---- dispatching -----------------------------------------------------------------------------------------------------

// One row (kind "row") or one repair (kind "repair"), on the tree and commit named: planned, journaled, run, judged.
// Every row's room is named before it starts -- a control set's too (`controls --run-id`), so a set a restart cut short
// is carried on from its room by `resume`, never started again (B6: a source case's controls take twenty minutes).
export async function dispatched(ctx, f, rowDef, o) {
  const run = newRunIdOf();
  const at = { tree: o.tree, parent: ctx.task, runId: run, usd: o.usd, model: ctx.options.model, credential: ctx.options.credential, caFile: ctx.options.caFile };
  const argv = argvOf(o.kind === "repair" ? { ...rowDef, run: "repair" } : rowDef, at);
  const doc = { kind: o.kind, attempt: f.open.id, row: rowDef.id, case: rowDef.case, rowDef, commit: o.commit, tree: o.tree, workspace: o.workspace ?? null, usd: o.usd, planned: { run, argv } };
  return ranAs(ctx, f, { ...doc, act: begun(ctx, o.kind === "repair" ? "release.repair" : "release.row", o.label, doc) });
}

async function ranAs(ctx, f, doc) {
  const answer = await ctx.world.bench(doc.planned.argv, { watch: watcher(ctx, doc.act, doc.planned.run), everyMs: ctx.everyMs ?? 15000 });
  return answer.stopped ? heldWhileRunning(ctx, doc) : settledRun(ctx, f, doc, answer);
}

// A run's room as its end leaves it: its ending, then -- after its tidying, the leak scan of the room among it -- its
// report, which says the host and the leaks a verdict reads. A restart between the two leaves an ending with no report
// that agrees with it: such a room is never judged as it stands, but carried on by `resume`, which does that tail again.
const complete = (room) => Boolean(room.ending) && room.report?.outcome === room.ending.outcome;

// An action a ship left running when it stopped: settled from what it already wrote, from the run's own ending, or by
// carrying the run on (`resume`) -- never by starting it again. One that never reached its run is closed, to be run anew.
const LEFT = [
  { when: (x) => Boolean(x.d.settled?.verdict) && Boolean(x.d.rowDef), then: (ctx, f, x) => settledAct(ctx, x.a.id, x.d, x.d.settled, closeOf(x.d.rowDef, x.d.settled.verdict, "as it settled before the ship stopped")) },
  { when: (x) => Boolean(x.d.settled), then: (ctx, f, x) => ctx.door.actComplete(ctx.task, x.a.id, x.d.settled.ok === false ? "failed" : "succeeded", undefined, "completed from what it settled before the ship stopped") },
  { when: (x) => Boolean(x.d.planned?.run) && complete(runRoomOf(x.storeRoot, x.d.planned.run)), then: (ctx, f, x) => settledRun(ctx, f, { ...x.d, act: x.a.id }, { code: null, json: null }) },
  { when: (x) => Boolean(x.d.planned?.run) && Boolean(runRoomOf(x.storeRoot, x.d.planned.run).manifest), then: async (ctx, f, x) => settledRun(ctx, f, { ...x.d, act: x.a.id }, await ctx.world.bench(["resume", x.d.planned.run], {})) },
  { when: () => true, then: (ctx, f, x) => ctx.door.actFail(ctx.task, x.a.id, "interrupted before it settled: done again as a new action") },
];

export const carriedOn = (ctx, f, x) => LEFT.find((r) => r.when({ ...x, storeRoot: ctx.storeRoot })).then(ctx, f, x);
