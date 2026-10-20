// TASK PROGRESS and TEST PROGRESS (1.8.6, ADR 0022): two counts that never stand for each other, each over a
// denominator its owner recorded -- never time, never tokens, never a guess. Task progress counts a coordinated
// workflow's plan steps DONE on their own contract (a strict step only once its owner's record verified it, a step
// that may stand on a report once reported), or an engineering task's required checks that PASSED; a task with
// neither has no denominator and says it is indeterminate. A plan revised on evidence may add steps, and then the
// share may fall: that is what it is. Test progress is what a test runner REPORTED of its cases, the total only when
// the runner said it; a case is never "running" (a runner reports cases once they ended).
//
//   taskProgressOf(ctx) -> { basis, done, total, percent, verified, reported, revision, unit } | { basis: null, indeterminate: true }
//   testProgressOf(ctx) -> { runner, passed, failed, skipped, reported, total, pending, said, running, aborted } | null
//                          said: the counts are the runner's own totals (it reported them), else the cases observed
//   progressRows(ctx) -> [row]          the two lines a pane draws above its status bar
import { progressOf, stepsOf } from "../plan.mjs";
import { bar } from "./bars.mjs";
import { isCoordinator } from "./model.mjs";
import { chosen } from "./sections/activity.mjs";
import { dim, joined, row, seg } from "./sections/parts.mjs";
import { grouped } from "./sections/verify.mjs";

export const BAR_CELLS = 16;

const HELD = ["passed", "asBefore", "regressed", "blocked", "owed", "missing"];

const planCount = (snap) => ((p) => (p ? { basis: "plan", done: p.done, total: p.total, verified: p.verified, reported: p.reported, revision: snap.plan?.n ?? null, unit: "steps" } : null))(progressOf(stepsOf(snap.plan, snap.view)));

const checksCount = (view) => ((g) => ({ basis: "checks", done: g.passed.length, total: HELD.reduce((n, k) => n + g[k].length, 0), verified: g.passed.length, reported: 0, asBefore: g.asBefore.length, revision: null, unit: "required checks" }))(grouped(view));

// Which denominator a task has, first row that holds; the last says there is none.
const BASES = [
  { when: (ctx) => isCoordinator(ctx.d.root?.view), count: (ctx) => planCount(ctx.d.root) },
  { when: (ctx) => Boolean(ctx.d.engineering?.view?.verification?.length), count: (ctx) => checksCount(ctx.d.engineering.view) },
  { when: () => true, count: () => null },
];

const percentOf = (c) => (c.total ? Math.round((c.done / c.total) * 100) : null);

export const taskProgressOf = (ctx) => ((c) => (c && c.total ? { ...c, percent: percentOf(c) } : { basis: null, indeterminate: true }))(BASES.find((b) => b.when(ctx)).count(ctx));

const latestTest = (snap) => (snap?.activities ?? []).filter((a) => a.kind === "test" && a.observation).at(-1)?.observation ?? null;

const totalOf = (o) => (Number.isInteger(o.totals?.tests) ? o.totals.tests : Number.isInteger(o.total) ? o.total : null);

// Once a runner said its totals, the counts are ITS word, as the status bar's are: a runner may print only its failures
// and a summary (VSTest at normal verbosity does), and the lines observed would then say "0 passed" of 30 beside a bar
// that says 29/30. Before it said them, the counts are the cases observed, and pending only against a total it said.
const saidTotals = (o) => Number.isInteger(o.totals?.tests);

const accounted = (t) => (t.passed ?? 0) + (t.failed ?? 0) + (t.skipped ?? 0);

const casesSaid = (o) => ({ passed: o.totals.passed ?? 0, failed: o.totals.failed ?? 0, skipped: o.totals.skipped ?? 0, reported: o.reported ?? 0, total: o.totals.tests, pending: Math.max(0, o.totals.tests - accounted(o.totals)), said: true });

const casesSeen = (o, total) => ({ passed: o.counts?.passed ?? 0, failed: o.counts?.failed ?? 0, skipped: o.counts?.skipped ?? 0, reported: o.reported ?? 0, total, pending: total === null ? null : Math.max(0, total - (o.reported ?? 0)), said: false });

const testsOf = (o) => ({ runner: o.adapter?.runner ?? o.adapter?.id ?? null, ...(saidTotals(o) ? casesSaid(o) : casesSeen(o, totalOf(o))), running: o.state === "running", aborted: Boolean(o.aborted) });

export const testProgressOf = (ctx) => ((o) => (o ? testsOf(o) : null))(latestTest(ctx.d.engineering ?? chosen(ctx)));

// ---- the two lines ----------------------------------------------------------------------------------------

const label = (text) => seg(text.padEnd(7), "label");

const taskWords = (p) => [`${p.done}/${p.total} ${p.unit}`, `${p.percent}%`, p.verified ? `${p.verified} verified` : null, p.reported ? `${p.reported} reported` : null, p.asBefore ? `${p.asBefore} failing as before` : null, p.revision > 1 ? `plan-${p.revision}` : null].filter(Boolean).join(" · ");

// A bar as two segments (0.0.1): the cells done in the success tone on the rest of its track.
const barSegs = (done, total) => ((b) => (b ? [seg(b.replace(/░/g, ""), "success"), seg(b.replace(/▓/g, ""), "track")] : []))(bar(done, total, BAR_CELLS));

// The label on the left and the bar with its words on the right edge (0.0.2, ADR 0028), as Orbit Live's footer draws them.
const RIGHT = Object.freeze({ rightShare: 0.85 });

const taskRow = (p) => (p.indeterminate ? row([label("TASK"), dim("indeterminate — no plan or required checks to count yet")], [], { label: "task" }) : row([label("TASK")], [...barSegs(p.done, p.total), seg(` ${taskWords(p)}`)], { label: "task", ...RIGHT }));

const OF = [
  { when: (t) => t.said, words: (t) => (t.pending ? `of ${t.total}, as the runner said · ${t.pending} it did not account for` : `of ${t.total}, as the runner said`) },
  { when: (t) => t.pending !== null, words: (t) => `${t.pending} pending of ${t.total}` },
  { when: () => true, words: (t) => `${t.reported} reported, total not said yet` },
];

const testWords = (t) => joined([seg(`${t.passed} passed`, "success"), t.failed ? seg(`${t.failed} failed`, "danger") : null, t.skipped ? dim(`${t.skipped} skipped`) : null, dim(OF.find((r) => r.when(t)).words(t)), t.aborted ? seg("aborted", "warning") : t.running ? seg("runner running", "info") : null]);

// The TESTS line draws a bar only over a total the runner SAID (bars.mjs: no total, no bar), never over the cases seen.
const testBar = (t) => (t.said ? [...barSegs(t.passed, t.total), seg(" ")] : []);

// Every case the runner said passed is one sentence in the success tone: "30 passed of 30, as the runner said".
const clean = (t) => t.said && !t.failed && !t.skipped && !t.pending && !t.aborted && !t.running;

const allPassed = (t) => [seg(`${t.passed} passed ${OF[0].words(t)}`, "success")];

const testRow = (t) => (t ? row([label("TESTS")], [...testBar(t), ...(clean(t) ? allPassed(t) : testWords(t))], { label: "tests", ...RIGHT }) : row([label("TESTS"), dim("no test runner has reported anything yet")], [], { label: "tests" }));

export const progressRows = (ctx) => [taskRow(taskProgressOf(ctx)), testRow(testProgressOf(ctx))];
