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
import { diagnosed, INTERRUPTED_RUNS } from "./diagnose.mjs";
import { rowsOf as catalogRowsOf } from "./policy.mjs";
import { docRead } from "./room.mjs";

// What each kind of ship runs (its manifest's `mode`): the whole catalog, its definition of done and a workspace to
// integrate repairs in -- or, for a PRECHECK (0.5.0, B6), only the catalog's model-carried rows, each once, stopping at
// no failure and ending once they all ran: never SHIPPABLE, never evidence.
export const SHIP_MODES = {
  autonomous: { rows: () => true, workspace: true, gates: true, precheck: false },
  "verify-only": { rows: () => true, workspace: true, gates: true, precheck: false },
  precheck: { rows: (r) => r.autonomous, workspace: false, gates: false, precheck: true },
};

export const modeOf = (ctx) => SHIP_MODES[ctx.manifest?.mode] ?? SHIP_MODES.autonomous;

// The rows a ship runs, in the order a cycle runs them: the catalog's (policy.mjs), as its mode keeps them.
export const shipRows = (ctx, listed) => catalogRowsOf(ctx.policy, listed).filter(modeOf(ctx).rows);

const HELD_LIFECYCLES = ["PAUSED", "CANCELLED"];

const docsOf = (ctx, view) => (view.actions ?? []).map((a) => ({ a, d: docRead(ctx.room, `steps/${a.id}.json`) ?? {} }));

const settledOf = (acts, type) => acts.filter((x) => x.a.type === type && x.d.settled);

const inAttempt = (xs, attempt) => xs.filter((x) => x.d.attempt === attempt);

const lastDoc = (xs) => xs.at(-1)?.d ?? null;

const openOf = (view) => ((a) => (a && !a.outcome ? a : null))((view.attempts ?? []).at(-1));

// What the ship may still spend: the limits it began with, raised only by a person's `--resume` (release.limits).
const limitsOf = (ctx, acts) => ({ ...ctx.manifest.limits, ...(lastDoc(settledOf(acts, "release.limits"))?.settled?.limits ?? {}) });

const costOf = (x) => (typeof x.d.settled?.cost?.usd === "number" ? x.d.settled.cost.usd : 0);

// What the ship spent: the costs its runs reported (or estimated), its minutes, and how many runs' cost nobody can know --
// a run a restart interrupted (dispatch.mjs COSTS), said beside the sum and never added into it.
const spentOf = (ctx, acts) => ({ usd: Math.round(acts.reduce((n, x) => n + costOf(x), 0) * 100) / 100, minutes: Math.floor((ctx.now() - Date.parse(ctx.manifest.at)) / 60000), unknown: acts.filter((x) => x.d.settled?.cost?.basis === "UNKNOWN").length });

// The release commit as it stands: the newest one an integration made, else the commit the ship began from.
const currentOf = (ctx, acts) => ((d) => (d ? { commit: d.settled.commit, tree: d.settled.tree } : { commit: ctx.manifest.start.commit, tree: null }))(lastDoc(settledOf(acts, "release.integrate")));

// ---- the rows of the open cycle --------------------------------------------------------------------------------------

// A run of a row a restart interrupted (ROW_VERDICT INTERRUPTED): never the model's miss, so it is counted apart from the
// runs that came to something -- it spends only its own bound (INTERRUPTED_RUNS), never --retries or the flaky retry.
const interruptedRun = (d) => d.settled.verdict.code === "INTERRUPTED";

const earlier = (docs, which) => docs.slice(0, -1).filter(which).length;

const leftOf = (limits, docs) => ((judged) => ({ flakyLeft: limits.flakyRetries - judged, autonomousLeft: limits.autonomousRetries - judged, interruptedLeft: INTERRUPTED_RUNS - earlier(docs, interruptedRun) }))(earlier(docs, (d) => !interruptedRun(d)));

// Whether a person resumed the blocked ship after this run (`release.resume`, journaled by the resume itself): in the
// journal's own order, never by a clock.
const resumedAfter = (f, act) => f.acts.findIndex((x) => x.a.id === act) < f.acts.findLastIndex((x) => x.a.type === "release.resume" && x.d.settled);

const caseData = (ctx, id) => ctx.cases.get(id) ?? null;

// A RECORDED row (ADR 0051) never stops or blocks a ship: what its diagnosis would do -- stop, block, wait for a person --
// it is RECORDED, not held, instead. A run again (a restart's interruption, a retry --retries allows) it still gets.
const recordedDiag = (row, diag) => (row.recorded && diag.then !== "RETRY" ? { ...diag, then: "RECORDED", needs: null, stop: null } : diag);

// A row's latest verdict in this cycle, with what DIAGNOSE makes of it given the retries it has used.
function rowState(ctx, f, row, docs) {
  const v = docs.at(-1).settled.verdict;
  const diag = v.state === "HELD" ? null : recordedDiag(row, diagnosed({ row, v, case: caseData(ctx, row.case), repair: ctx.options.repair, ...leftOf(f.limits, docs), resumed: resumedAfter(f, docs.at(-1).act) }));
  return { row, v, diag, runs: docs.length };
}

const docsByRow = (xs) => xs.reduce((m, x) => m.set(x.d.row, [...(m.get(x.d.row) ?? []), x.d]), new Map());

const rowsOf = (ctx, f, xs) => ((by) => new Map(ctx.rows.filter((r) => by.has(r.id)).map((r) => [r.id, rowState(ctx, f, r, by.get(r.id))])))(docsByRow(xs));

// The next row to run: one never run in this cycle, or one its diagnosis runs again -- a model-carried row only when
// nothing else of the cycle failed, unless a person asked for every row (--no-fail-fast).
const pendingRow = (ctx, f) => ctx.rows.find((r) => (!f.rows.has(r.id) || f.rows.get(r.id).diag?.then === "RETRY") && (!r.autonomous || !f.anyFailed || !ctx.options.failFast)) ?? null;

// A row failed for good: not held, and not about to run again. A row its diagnosis runs again (a retry a person allowed)
// is still open -- counted as failed, it would keep a model-carried row from its own retry.
// A recorded row never fails a cycle (fail fast keeps no model-carried row from running for it).
const failedForGood = (r) => !r.row.recorded && r.v.state !== "HELD" && r.diag?.then !== "RETRY";

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

const lastState = (g) => g.last?.settled.verdict.state ?? null;

// A repair a restart interrupted spends no attempt (`counted` leaves it out) and is never a repeat; it runs again, at
// most INTERRUPTED_RUNS times a cycle, then blocks the ship on the environment. What blocked a repair (the environment,
// or that bound) is asked again once a person resumed the ship after it (`lifted`) -- never what a person holds.
const REPAIR_STATES = [
  { state: "INTEGRATED", when: (g) => g.integrated },
  { state: "VERIFIED", when: (g) => lastState(g) === "VERIFIED" },
  { state: "BLOCKED", when: (g) => lastState(g) === "HELD_BY_PERSON" || (lastState(g) === "BLOCKED" && !g.lifted) },
  { state: "BLOCKED", when: (g) => lastState(g) === "INTERRUPTED" && g.cut > INTERRUPTED_RUNS && !g.lifted, says: (g) => `a restart interrupted ${g.cut} repairs of it in this cycle before one could end -- none is evidence and none spent an attempt; the environment cannot hold a repair to its end: resume the ship where one can` },
  { state: "NO_PROGRESS", when: (g) => g.regressed || repeated(g.counted) },
  { state: "SPENT", when: (g) => g.counted.length >= g.limit },
  { state: "TO_REPAIR", when: () => true },
];

const cutRepair = (d) => d.settled.verdict.state === "INTERRUPTED";

const repairFacts = (acts, f, r, docs) => ({ counted: docs.filter((d) => !cutRepair(d)), cut: docs.filter(cutRepair).length, last: docs.at(-1) ? { settled: docs.at(-1).settled, act: docs.at(-1).act } : null, lifted: Boolean(docs.at(-1)) && resumedAfter(f, docs.at(-1).act), integrated: integrated(acts, f.open.id, r.row.case), regressed: regressedAsBefore(acts, f, r), limit: f.limits.repairAttempts });

function repairOf(acts, f, r) {
  const docs = repairDocs(acts, f.open.id, r.row.case);
  const g = repairFacts(acts, f, r, docs);
  const row = REPAIR_STATES.find((s) => s.when(g));
  return { case: r.row.case, row: r.row, state: row.state, says: row.says?.(g) ?? null, last: docs.at(-1) ?? null, attempts: g.counted.length, interrupted: g.cut };
}

// ---- the facts ----------------------------------------------------------------------------------------------------------

// The cycle's build: the newest that BUILT its images. One that could not (a registry's 429, a daemon that died) is never
// taken for a build -- NOT_BUILT asks for the images again once a person resumed the ship it blocked.
const builtOf = (acts, open) => lastDoc(inAttempt(settledOf(acts, "release.build"), open.id).filter((x) => x.d.settled.ok === true));

// The cycle's host check as it stands: a refusal stands until a person resumes the ship it blocked -- then the host is
// asked again, once per resume ("fix it and --resume"), never in a loop of the ship's own.
const hostCheckOf = (f, acts) => ((x) => (!x || (x.d.settled.ok !== true && resumedAfter(f, x.a.id)) ? null : x.d.settled))(inAttempt(settledOf(acts, "release.host"), f.open.id).at(-1));

function cycleFacts(ctx, acts, f) {
  const cycle = f.open ? builtOf(acts, f.open) : null;
  const rows = cycle ? rowsOf(ctx, f, inAttempt(settledOf(acts, "release.row"), f.open.id)) : new Map();
  const g = { ...f, cycle: cycle?.settled ?? null, host: cycle ? hostCheckOf(f, acts) : null, gates: cycle ? lastDoc(inAttempt(settledOf(acts, "release.gates"), f.open.id))?.settled ?? null : null, rows, anyFailed: [...rows.values()].some(failedForGood) };
  return { ...g, pending: pendingRow(ctx, g), repairs: diags(g, "REPAIR").map((r) => repairOf(acts, g, r)), firstDigest: [...rows.values()].map((r) => r.v.digest).find(Boolean) ?? null };
}

export function factsOf(ctx, view) {
  const acts = docsOf(ctx, view);
  const limits = limitsOf(ctx, acts);
  const f = { view, acts, limits, spent: spentOf(ctx, acts), held: HELD_LIFECYCLES.includes(view.lifecycle), ended: view.terminal === true, running: acts.filter((x) => x.a.state === "running"), workspace: lastDoc(settledOf(acts, "release.workspace"))?.settled ?? null, current: currentOf(ctx, acts), attempts: (view.attempts ?? []).length, open: openOf(view) };
  return cycleFacts(ctx, acts, f);
}

// The newest cycle's rows and repairs, open or closed -- what `--status` says of a ship. The facts NEXT reads hold an
// OPEN cycle alone, so a ship whose cycle closed (it shipped, it stopped, its repairs were integrated) would say none.
export const lastCycleOf = (ctx, f) => ((last) => (last ? cycleFacts(ctx, f.acts, { ...f, open: last }) : { rows: new Map(), repairs: [] }))((f.view.attempts ?? []).at(-1) ?? null);

// ---- NEXT --------------------------------------------------------------------------------------------------------------

// A model-carried run is handed at least a dollar, so less than one left is a budget spent -- never a run over it.
const overLimit = (f) => f.spent.minutes >= f.limits.minutes || f.limits.usd - f.spent.usd < 1;

const allIntegrated = (f) => f.repairs.length > 0 && f.repairs.every((r) => r.state === "INTEGRATED");

const repairIn = (f, state) => f.repairs.find((r) => r.state === state) ?? null;

// What SHIPPABLE needs of each row of the catalog in this cycle: a required row HELD; a recorded one (ADR 0051) only run to
// an end, held or not.
const rowDone = (r, x) => (r.recorded ? Boolean(x) && (x.v.state === "HELD" || x.diag?.then === "RECORDED") : x?.v.state === "HELD");

const allHeld = (ctx, f) => ctx.rows.length > 0 && ctx.rows.every((r) => rowDone(r, f.rows.get(r.id)));

// PREFLIGHT before RECONCILE: a run read back on resume is judged like any other -- against the catalog and each case's
// declaration the preflight reads, and the content digest the cycle's earlier rows froze -- never against an empty one.
export const NEXT = [
  { id: "ENDED", when: (f) => f.ended, step: "END" },
  { id: "HELD_BY_PERSON", when: (f) => f.held, step: "HELD" },
  { id: "PREFLIGHT", when: (f, ctx) => !ctx.preflighted, step: "PREFLIGHT" },
  { id: "RECONCILE", when: (f) => f.running.length > 0, step: "RECONCILE" },
  { id: "WORKSPACE", when: (f, ctx) => !f.workspace && modeOf(ctx).workspace, step: "WORKSPACE" },
  { id: "OVER_LIMIT", when: overLimit, step: "BUDGET" },
  { id: "CYCLE_DONE", when: (f) => Boolean(f.open) && allIntegrated(f), step: "CLOSE" },
  { id: "CYCLES_SPENT", when: (f) => !f.open && f.attempts >= f.limits.cycles, step: "BUDGET" },
  { id: "NO_CYCLE", when: (f) => !f.open, step: "CYCLE" },
  { id: "NOT_BUILT", when: (f) => !f.cycle, step: "BUILD" },
  { id: "ARCHIVE_REFUSED", when: (f) => f.cycle.artifact.refused.length > 0, step: "STOP" },
  { id: "NO_HOST", when: (f) => !f.host, step: "HOST" },
  { id: "HOST_REFUSED", when: (f) => !f.host.ok, step: "BLOCK" },
  { id: "NO_GATES", when: (f, ctx) => !f.gates && modeOf(ctx).gates, step: "GATES" },
  { id: "GATES_FAILED", when: (f) => Boolean(f.gates) && !f.gates.ok, step: "STOP" },
  { id: "ROW_BLOCKED", when: (f) => diags(f, "BLOCK").length > 0 || diags(f, "HELD").length > 0, step: "BLOCK" },
  { id: "FAIL_FAST", when: (f, ctx) => ctx.options.failFast && diags(f, "STOP").length > 0, step: "STOP" },
  { id: "ROW", when: (f) => Boolean(f.pending), step: "ROW" },
  { id: "PRECHECKED", when: (f, ctx) => modeOf(ctx).precheck, step: "PRECHECKED" },
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
