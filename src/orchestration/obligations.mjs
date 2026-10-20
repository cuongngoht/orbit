// THE VERIFICATION PLAN: which of the checks a checkout DECLARES this task's change is held to, derived on
// every read -- never chosen by the host, never stored beside the journal. Declared is not required:
//
//   scope       the change's own files once it has some, the plan's scope before that, nothing before a plan
//   impact      which components that scope reaches, and why (impact.mjs, over runtime's component graph)
//   required    the declared checks of every component reached: the only ones a completion is held to
//   excluded    every other declared check: NOT AFFECTED, NOT RUN -- never passed
//   missing     what the change reaches that nothing declared verifies: a path no component holds, or a
//               changed component with no test or verify command of its own nor of anything that depends on
//               it. Missing is never ignored: it blocks completion until a person or a declaration settles it
//
// A required check's STATE is read against its BASELINE -- its last run before the code first changed,
// i.e. on the pinned base revision: passed since the last change, failed exactly as it did at its
// baseline (AS_BEFORE: a failure that was already there, kept visible and never a pass), failed otherwise
// (a regression, which is also what a failure with no baseline is: an unknown comparison never satisfies
// anything), still running, or owed. With no graph to read, every component with a check is held to it
// (WIDENED): that is the 1.8.3 rule, and unknown is never narrower than known.
import { short } from "../hash.mjs";
import { DIRECT, dependentsOf, impactOf } from "./impact.mjs";
import { checkRuns, lastChange, pinned, receiptsOf } from "./journal.mjs";
import { AS_BEFORE, BUILDING_PURPOSES, DOMAIN, IMPACT_WORD, STAGE, TESTING_PURPOSES, VERIFYING } from "./vocab.mjs";

// ---- the scope ------------------------------------------------------------------------------------------

const SCOPES = [
  { source: "changes", when: (lw) => lw.view.changes.paths.length > 0, paths: (lw) => lw.view.changes.paths.map((p) => p.path) },
  { source: "plan", when: (lw) => Array.isArray(lw.planned?.()), paths: (lw) => lw.planned() },
  { source: "none", when: () => true, paths: () => [] },
];

const graphOf = (lw) => lw.graph?.() ?? null;

const NO_GRAPH = "nothing says how this checkout's components relate, so every component with a check is held to it";

// No graph: every component that holds a check is reached, said as such.
const widened = (lw, paths) => ({ components: paths.length ? [...new Set(lw.checks.map((c) => c.component))].map((key) => ({ key, reason: "NO_GRAPH", because: NO_GRAPH })) : [], unowned: [] });

// A component that holds a check and that the graph does not know: what it depends on is unknown, so once
// anything changed it is held to its checks -- never left out because nothing said it was reached.
const ungraphed = (lw, paths, known) => (paths.length ? [...new Set(lw.checks.map((c) => c.component))].filter((k) => !known.has(k)).map((key) => ({ key, reason: "UNKNOWN", because: "the component graph does not know it, so what it depends on is unknown" })) : []);

const withUngraphed = (lw, paths, impact) => ({ ...impact, components: [...impact.components, ...ungraphed(lw, paths, new Set([...(graphOf(lw).components ?? []).map((c) => c.key), ...impact.components.map((c) => c.key)]))] });

const impactNow = (lw, paths) => (graphOf(lw) ? withUngraphed(lw, paths, impactOf(paths, graphOf(lw))) : widened(lw, paths));

// ---- a check's state, against its baseline ------------------------------------------------------------

const runsOf = (lw, id) => checkRuns(lw).filter((r) => r.command === id);

const baselineRun = (lw, id) => runsOf(lw, id).filter((r) => r.state !== "running" && pinned(lw, r)).at(-1) ?? null;

const BASELINE = [
  { when: (r) => r === null, word: "none" },
  { when: (r) => r.state === "succeeded", word: "passed" },
  { when: () => true, word: "failed" },
];

export const baselineOf = (lw, id) => BASELINE.find((b) => b.when(baselineRun(lw, id))).word;

// A run speaks for the recorded change only when it ran on the tree record-changes recorded: a pass on a
// tree nobody recorded -- edited after, or edited and put back -- is a pass of other code.
const onRecorded = (lw, r) => ((recorded) => r.state === "running" || !recorded || r.tree === recorded)(lw.tree?.().recorded ?? null);

const latestSince = (lw, id) => runsOf(lw, id).filter((r) => r.at > lastChange(lw) && onRecorded(lw, r)).at(-1) ?? null;

export const CHECK_STATES = [
  { state: "owed", when: (r) => r === null, settled: false },
  { state: "running", when: (r) => r.state === "running", settled: false },
  { state: "passed", when: (r) => r.state === "succeeded", settled: true },
  { state: "failed-as-before", when: (r) => r.word === AS_BEFORE, settled: true },
  { state: "unstarted", when: (r) => r.state === "error", settled: false },
  { state: "regressed", when: () => true, settled: false },
];

const stateRow = (lw, id) => CHECK_STATES.find((s) => s.when(latestSince(lw, id)));

// ---- what nothing verifies -------------------------------------------------------------------------------

const subjectOf = (what) => `missing-${short(what, 10)}`;

const unownedMissing = (paths) => paths.map((p) => ({ subject: subjectOf(p), what: p, because: `no component this checkout declares holds ${p}, so nothing declared verifies it` }));

const verifyingOf = (required, keys) => required.filter((c) => VERIFYING.includes(c.purpose) && keys.includes(c.component));

const coverers = (lw, key) => [key, ...(graphOf(lw) ? dependentsOf(graphOf(lw).components ?? [], key) : [])];

const uncovered = (lw, impact, required) => impact.components.filter((c) => DIRECT.includes(c.reason) && !verifyingOf(required, coverers(lw, c.key)).length).map((c) => ({ subject: subjectOf(c.key), what: c.key, because: `nothing declared verifies ${c.key}: no test or verify command of its own, nor of a component that depends on it` }));

// ---- the plan ------------------------------------------------------------------------------------------

const checkView = (lw, c) => ((s) => ({ id: c.id, purpose: c.purpose, component: c.component, declaredAs: c.declaredAs, state: s.state, settled: s.settled, baseline: baselineOf(lw, c.id) }))(stateRow(lw, c.id));

const excludedView = (lw, c) => ({ id: c.id, purpose: c.purpose, component: c.component, declaredAs: c.declaredAs, state: "NOT_AFFECTED", because: "not affected by this change -- not run", baseline: baselineOf(lw, c.id) });

const wordOf = (lw, missing) => (!graphOf(lw) ? IMPACT_WORD.WIDENED : missing.length ? IMPACT_WORD.MISSING : IMPACT_WORD.SCOPED);

// What the change reaches that can be LOOKED AT running, and how: a word from the component graph (runtime's
// `live` column), never a tool. A recommendation; required only once live evidence was taken (LIVE row).
const liveOf = (lw, impact) => impact.components.map((c) => ({ key: c.key, how: (graphOf(lw)?.components ?? []).find((g) => g.key === c.key)?.live ?? null })).filter((c) => c.how);

function made(lw) {
  const scope = SCOPES.find((s) => s.when(lw));
  const impact = impactNow(lw, scope.paths(lw));
  const reached = new Set(impact.components.map((c) => c.key));
  return assembled(lw, scope, impact, lw.checks.filter((c) => reached.has(c.component)));
}

function assembled(lw, scope, impact, required) {
  const missing = [...unownedMissing(impact.unowned), ...uncovered(lw, impact, required)];
  const excluded = scope.source === "none" ? [] : lw.checks.filter((c) => !required.includes(c));
  return { source: scope.source, word: wordOf(lw, missing), impact, required: required.map((c) => checkView(lw, c)), excluded: excluded.map((c) => excludedView(lw, c)), missing, live: liveOf(lw, impact) };
}

const MEMO = new WeakMap();

// The plan, once per look at the task.
export function planOf(lw) {
  if (!MEMO.has(lw)) MEMO.set(lw, made(lw));
  return MEMO.get(lw);
}

// ---- what the stage machine and completion ask -----------------------------------------------------------

const of = (lw, purposes) => planOf(lw).required.filter((c) => purposes.includes(c.purpose));

export const requiredIds = (lw) => new Set(planOf(lw).required.map((c) => c.id));

// Every required build and verify command settled since the last change (none required: nothing owed).
export const buildDone = (lw) => of(lw, BUILDING_PURPOSES).every((c) => c.settled);

// Every required test settled since the last change.
export const testsDone = (lw) => of(lw, TESTING_PURPOSES).every((c) => c.settled);

// At least one required test or verify command PASSED since the last change: something showed the change works.
export const verifiedSome = (lw) => planOf(lw).required.some((c) => VERIFYING.includes(c.purpose) && c.state === "passed");

export const owedIds = (lw) => planOf(lw).required.filter((c) => !c.settled).map((c) => c.id);

// After a change: its builds and static checks first, then its tests, else -- nothing required -- the review.
export const firstCheckStage = (lw) => (of(lw, BUILDING_PURPOSES).length ? STAGE.BUILDING : afterBuild(lw));

export const afterBuild = (lw) => (of(lw, TESTING_PURPOSES).length ? STAGE.TESTING : STAGE.REVIEWING);

export const regressions = (lw) => planOf(lw).required.filter((c) => c.state === "regressed");

export const asBefore = (lw) => planOf(lw).required.filter((c) => c.state === AS_BEFORE);

// ---- what a viewer reads: the plan as verification rows, and one impact receipt ---------------------------

const obligation = (c, says) => `${c.component} · ${c.purpose} ${c.declaredAs} ${says}`.slice(0, 240);

const requiredRow = (c) => ({ subject: c.id, obligation: obligation(c, "passes"), state: "not-verified" });

const excludedRow = (c) => ({ subject: c.id, obligation: obligation(c, "— not affected, not run"), state: "not-applicable" });

const missingRow = (m) => ({ subject: m.subject, obligation: `nothing declared verifies ${m.what}`.slice(0, 240), state: "blocked" });

const goneRow = (v) => ({ subject: v.subject, obligation: `${v.obligation} — no longer part of the change`.slice(0, 240), state: "not-applicable" });

const differs = (lw, row) => ((v) => !v || v.state !== row.state || v.obligation !== row.obligation)(lw.view.verification.find((v) => v.subject === row.subject));

const gone = (lw, plan) => lw.view.verification.filter((v) => String(v.subject ?? "").startsWith("missing-") && v.state === "blocked" && !plan.missing.some((m) => m.subject === v.subject)).map(goneRow);

// The rows a newly recorded plan or change publishes: what is owed again, what is not affected, what
// nothing verifies -- only those that say something the journal does not already.
export const allRowsOf = (lw, plan) => [...plan.required.map(requiredRow), ...plan.excluded.map(excludedRow), ...plan.missing.map(missingRow), ...gone(lw, plan)];

export const rowsOf = (lw, plan) => allRowsOf(lw, plan).filter((row) => differs(lw, row));

const reasonWords = (impact) => impact.components.slice(0, 4).map((c) => `${c.key} ${c.reason.toLowerCase()}`).join(", ") + (impact.components.length > 4 ? ", …" : "");

const liveWords = (plan) => (plan.live.length ? `; live: ${plan.live.slice(0, 2).map((x) => `${x.key} ${x.how}`).join(", ")}` : "");

export const impactSay = (plan) => `${plan.source}: ${plan.impact.components.length} component(s) reached${plan.impact.components.length ? ` (${reasonWords(plan.impact)})` : ""}; ${plan.required.length} check(s) required, ${plan.excluded.length} not affected, ${plan.missing.length} with nothing to verify it${liveWords(plan)}`.slice(0, 240);

export const impactReceipt = (ref, plan) => ({ domain: DOMAIN.IMPACT, ref, outcome: plan.word, summary: impactSay(plan) });

// A plan as the host reads it in the context: the plan itself, and what still stands between it and completion.
export const planView = (lw) => ((p) => ({ ...p, baselineFailures: [...p.required, ...p.excluded].filter((c) => c.baseline === "failed").map((c) => c.id), regressions: regressions(lw).map((c) => c.id), linkedLive: receiptsOf(lw, DOMAIN.INVESTIGATION).length > 0 }))(planOf(lw));
