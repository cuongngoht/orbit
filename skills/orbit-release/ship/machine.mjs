// THE SHIP'S STATE MACHINE -- PREFLIGHT → BUILD → BENCHMARK → DIAGNOSE → REPAIR → REBUILD → FULL_RETEST → SHIPPABLE --
// as an ordered table (`NEXT`, first match wins, the last always matching) over facts folded EVERY time from the ship
// task's own journal and the documents its actions left in the ship's room (`factsOf`). Nothing about where a ship
// stands is kept beside them, which is what makes `--resume` safe: an action that never settled is read back, a run
// that ended is never sent again, and a release commit that moved makes every earlier row stale by construction.
//
//   factsOf(ctx, view) -> facts        nextOf(facts) -> { id, step }        NEXT
//   A CYCLE is one attempt of the ship task: one release commit, built, checked by the gates and held to every row of
//   the catalog. Its rows run in the policy's order -- verifications, controls, then the model-carried rows, which wait
//   (fail fast) until nothing else failed. A cycle whose only failures are repairable repairs them, one case after
//   another on the newest release commit, then closes; the next cycle is a full retest of that commit.
import { diagnosed } from "./diagnose.mjs";
import { docRead } from "./room.mjs";

const HELD_LIFECYCLES = ["PAUSED", "CANCELLED"];

const docsOf = (ctx, view) => (view.actions ?? []).map((a) => ({ a, d: docRead(ctx.room, `steps/${a.id}.json`) ?? {} }));

const settledOf = (acts, type) => acts.filter((x) => x.a.type === type && x.d.settled);

const inAttempt = (xs, attempt) => xs.filter((x) => x.d.attempt === attempt);

const lastDoc = (xs) => xs.at(-1)?.d ?? null;

const openOf = (view) => ((a) => (a && !a.outcome ? a : null))((view.attempts ?? []).at(-1));

// What the ship may still spend: the limits it began with, raised only by a person's `--resume` (release.limits).
const limitsOf = (ctx, acts) => ({ ...ctx.manifest.limits, ...(lastDoc(settledOf(acts, "release.limits"))?.settled?.limits ?? {}) });

const costOf = (x) => (typeof x.d.settled?.cost?.usd === "number" ? x.d.settled.cost.usd : 0);

const spentOf = (ctx, acts) => ({ usd: Math.round(acts.reduce((n, x) => n + costOf(x), 0) * 100) / 100, minutes: Math.floor((ctx.now() - Date.parse(ctx.manifest.at)) / 60000) });

// The release commit as it stands: the newest one an integration made, else the commit the ship began from.
const currentOf = (ctx, acts) => ((d) => (d ? { commit: d.settled.commit, tree: d.settled.tree } : { commit: ctx.manifest.start.commit, tree: null }))(lastDoc(settledOf(acts, "release.integrate")));

// ---- the rows of the open cycle --------------------------------------------------------------------------------------

const usedRetries = (docs, v) => Math.max(0, docs.length - 1);

const caseData = (ctx, id) => ctx.cases.get(id) ?? null;

// A row's latest verdict in this cycle, with what DIAGNOSE makes of it given the retries it has used.
function rowState(ctx, f, row, docs) {
  const v = docs.at(-1).settled.verdict;
  const used = usedRetries(docs, v);
  const diag = v.state === "HELD" ? null : diagnosed({ row, v, case: caseData(ctx, row.case), repair: ctx.options.repair, flakyLeft: f.limits.flakyRetries - used, autonomousLeft: f.limits.autonomousRetries - used });
  return { row, v, diag, runs: docs.length };
}

const docsByRow = (xs) => xs.reduce((m, x) => m.set(x.d.row, [...(m.get(x.d.row) ?? []), x.d]), new Map());

const rowsOf = (ctx, f, xs) => ((by) => new Map(ctx.rows.filter((r) => by.has(r.id)).map((r) => [r.id, rowState(ctx, f, r, by.get(r.id))])))(docsByRow(xs));

// The next row to run: one never run in this cycle, or one its diagnosis runs again -- a model-carried row only when
// nothing else of the cycle failed, unless a person asked for every row (--no-fail-fast).
const pendingRow = (ctx, f) => ctx.rows.find((r) => (!f.rows.has(r.id) || f.rows.get(r.id).diag?.then === "RETRY") && (!r.autonomous || !f.anyFailed || !ctx.options.failFast)) ?? null;

const diags = (f, then) => [...f.rows.values()].filter((r) => r.diag?.then === then);

// ---- repairs ------------------------------------------------------------------------------------------------------------

const repairDocs = (acts, attempt, c) => inAttempt(settledOf(acts, "release.repair"), attempt).filter((x) => x.d.case === c).map((x) => x.d);

const integrated = (acts, attempt, c) => inAttempt(settledOf(acts, "release.integrate"), attempt).some((x) => x.d.case === c);

// Two attempts at one case that failed with one signature, or that left one and the same patch, are no progress -- as
// one signature twice is to the engine, and one candidate twice is to the benchmark (REPEATED_CANDIDATE).
const twice = (xs) => xs.some((s, i) => xs.indexOf(s) !== i);

const repeated = (docs) => twice(docs.map((d) => d.settled.verdict.signature).filter(Boolean)) || twice(docs.map((d) => d.settled.verdict.patchDigest).filter(Boolean));

// A case repaired in an earlier cycle that fails again exactly as it failed before its repair: the repair moved nothing.
const regressedAsBefore = (acts, f, r) => settledOf(acts, "release.row").some((x) => x.d.row === r.row.id && x.d.attempt !== f.open.id && x.d.settled.verdict.signature && x.d.settled.verdict.signature === r.v.signature) && settledOf(acts, "release.integrate").some((x) => x.d.case === r.row.case);

const REPAIR_STATES = [
  { state: "INTEGRATED", when: (g) => g.integrated },
  { state: "VERIFIED", when: (g) => g.last?.settled.verdict.state === "VERIFIED" },
  { state: "BLOCKED", when: (g) => ["BLOCKED", "HELD_BY_PERSON"].includes(g.last?.settled.verdict.state) },
  { state: "NO_PROGRESS", when: (g) => g.regressed || repeated(g.docs) },
  { state: "SPENT", when: (g) => g.docs.length >= g.limit },
  { state: "TO_REPAIR", when: () => true },
];

function repairOf(acts, f, r) {
  const docs = repairDocs(acts, f.open.id, r.row.case);
  const g = { docs, last: docs.at(-1) ? { settled: docs.at(-1).settled, act: docs.at(-1).act } : null, integrated: integrated(acts, f.open.id, r.row.case), regressed: regressedAsBefore(acts, f, r), limit: f.limits.repairAttempts };
  return { case: r.row.case, row: r.row, state: REPAIR_STATES.find((s) => s.when(g)).state, last: docs.at(-1) ?? null, attempts: docs.length };
}

// ---- the facts ----------------------------------------------------------------------------------------------------------

function cycleFacts(ctx, acts, f) {
  const cycle = f.open ? lastDoc(inAttempt(settledOf(acts, "release.build"), f.open.id)) : null;
  const rows = cycle ? rowsOf(ctx, f, inAttempt(settledOf(acts, "release.row"), f.open.id)) : new Map();
  const g = { ...f, cycle: cycle?.settled ?? null, host: cycle ? lastDoc(inAttempt(settledOf(acts, "release.host"), f.open.id))?.settled ?? null : null, gates: cycle ? lastDoc(inAttempt(settledOf(acts, "release.gates"), f.open.id))?.settled ?? null : null, rows, anyFailed: [...rows.values()].some((r) => r.v.state !== "HELD") };
  return { ...g, pending: pendingRow(ctx, g), repairs: diags(g, "REPAIR").map((r) => repairOf(acts, g, r)), firstDigest: [...rows.values()].map((r) => r.v.digest).find(Boolean) ?? null };
}

export function factsOf(ctx, view) {
  const acts = docsOf(ctx, view);
  const limits = limitsOf(ctx, acts);
  const f = { view, acts, limits, spent: spentOf(ctx, acts), held: HELD_LIFECYCLES.includes(view.lifecycle), ended: view.terminal === true, running: acts.filter((x) => x.a.state === "running"), workspace: lastDoc(settledOf(acts, "release.workspace"))?.settled ?? null, current: currentOf(ctx, acts), attempts: (view.attempts ?? []).length, open: openOf(view) };
  return cycleFacts(ctx, acts, f);
}

// ---- NEXT --------------------------------------------------------------------------------------------------------------

// A model-carried run is handed at least a dollar, so less than one left is a budget spent -- never a run over it.
const overLimit = (f) => f.spent.minutes >= f.limits.minutes || f.limits.usd - f.spent.usd < 1;

const allIntegrated = (f) => f.repairs.length > 0 && f.repairs.every((r) => r.state === "INTEGRATED");

const repairIn = (f, state) => f.repairs.find((r) => r.state === state) ?? null;

// The ship's own place in its order: a row that is HELD everywhere, every row of the catalog run in this cycle.
const allHeld = (ctx, f) => ctx.rows.length > 0 && ctx.rows.every((r) => f.rows.get(r.id)?.v.state === "HELD");

export const NEXT = [
  { id: "ENDED", when: (f) => f.ended, step: "END" },
  { id: "HELD_BY_PERSON", when: (f) => f.held, step: "HELD" },
  { id: "RECONCILE", when: (f) => f.running.length > 0, step: "RECONCILE" },
  { id: "PREFLIGHT", when: (f, ctx) => !ctx.preflighted, step: "PREFLIGHT" },
  { id: "WORKSPACE", when: (f) => !f.workspace, step: "WORKSPACE" },
  { id: "OVER_LIMIT", when: overLimit, step: "BUDGET" },
  { id: "CYCLE_DONE", when: (f) => Boolean(f.open) && allIntegrated(f), step: "CLOSE" },
  { id: "CYCLES_SPENT", when: (f) => !f.open && f.attempts >= f.limits.cycles, step: "BUDGET" },
  { id: "NO_CYCLE", when: (f) => !f.open, step: "CYCLE" },
  { id: "NOT_BUILT", when: (f) => !f.cycle, step: "BUILD" },
  { id: "ARCHIVE_REFUSED", when: (f) => f.cycle.artifact.refused.length > 0, step: "STOP" },
  { id: "NO_HOST", when: (f) => !f.host, step: "HOST" },
  { id: "HOST_REFUSED", when: (f) => !f.host.ok, step: "BLOCK" },
  { id: "NO_GATES", when: (f) => !f.gates, step: "GATES" },
  { id: "GATES_FAILED", when: (f) => !f.gates.ok, step: "STOP" },
  { id: "ROW_BLOCKED", when: (f) => diags(f, "BLOCK").length > 0 || diags(f, "HELD").length > 0, step: "BLOCK" },
  { id: "FAIL_FAST", when: (f, ctx) => ctx.options.failFast && diags(f, "STOP").length > 0, step: "STOP" },
  { id: "ROW", when: (f) => Boolean(f.pending), step: "ROW" },
  { id: "ROW_STOPPED", when: (f) => diags(f, "STOP").length > 0, step: "STOP" },
  { id: "REPAIR_BLOCKED", when: (f) => Boolean(repairIn(f, "BLOCKED")), step: "BLOCK" },
  { id: "NO_PROGRESS", when: (f) => Boolean(repairIn(f, "NO_PROGRESS")), step: "NO_PROGRESS" },
  { id: "REPAIRS_SPENT", when: (f) => Boolean(repairIn(f, "SPENT")), step: "STOP" },
  { id: "INTEGRATE", when: (f) => Boolean(repairIn(f, "VERIFIED")), step: "INTEGRATE" },
  { id: "REPAIR", when: (f) => Boolean(repairIn(f, "TO_REPAIR")), step: "REPAIR" },
  { id: "SHIPPABLE", when: (f, ctx) => allHeld(ctx, f), step: "SHIP" },
  { id: "UNKNOWN", when: () => true, step: "STOP" },
];

export const nextOf = (f, ctx) => ((r) => ({ id: r.id, step: r.step }))(NEXT.find((r) => r.when(f, ctx)));

export { repairIn, diags };
