// RATES (0.5.0): how OFTEN a row holds, never whether it held once (backlog B2), and what each ARM adds and costs
// (B23) -- folded from the facts metrics.mjs reads off kept rooms, never from what a host said, and `unknown` wherever
// nothing stands under a number.
//
//   A ROW is one case and variant, on one arm, carried by one host basis and one model at one effort (0.5.0: the effort
//   the host was asked to run at, `null` when none was -- its own default). Its runs are those that came to an ending a
//   rate may count -- not blocked, invalid, inconclusive, held or unfinished, and not cut by a restart (a round closed as
//   interrupted is nobody's miss, ADR 0049) -- each left out counted by why.
//   pass@1    passes / runs
//   pass@k    the chance at least one of k runs passes, estimated without bias from n >= k runs with c passes:
//             1 - C(n-c, k) / C(n, k) -- fewer runs than k say nothing about k (unknown)
//   cost      the median of what a host REPORTED a run cost, and the mean over passed runs (cost per verified);
//             minutes, the median from a run's freeze to its ending
//   OVERHEAD  per case, variant, basis, model and effort: an Orbit arm's median REPORTED cost, turns and tokens minus the
//             `none` arm's -- unknown where either side reported none
//   MEMORY    (0.5.0, B3, ADR 0054) per case, variant, basis, model and effort: each MEMORY ARM of a sessions case side by
//             side -- pass@1 and the medians of its second session's work: decisions used, designs refused, reported
//             cost, minutes -- and the EFFECT of memory, the `on` arm's minus the `off` arm's
//   A row is also apart by its memory arm: a sessions case's `on` and `off` runs are two rows, never one rate.
//
//   ratesOf(fs, { k }) -> { k, rows, models }      revisionsOf(fs, { k }) -> [{ commit, at, runs, rows }]
//   overheadOf(fs) -> rows      memoryOf(fs) -> rows      passAtK(n, c, k) · median(xs) · groupBy(xs, keyOf) · hostOfRun(f)
//   PASSED · DEFAULT_K · EFFECTS
const UNKNOWN = "unknown";

// The outcomes a run PASSED on, by kind of case: a verdict that held, or a repair the verifier passed.
export const PASSED = ["PASS", "REPAIRED_VERIFIED"];

// k when nobody names one: a release's model-carried row runs once and at most twice again (`--retries=2`).
export const DEFAULT_K = 3;

const round4 = (x) => Math.round(x * 10000) / 10000;

const valued = (x) => (typeof x === "number" && Number.isFinite(x) ? round4(x) : UNKNOWN);

const numbers = (xs) => xs.filter((x) => typeof x === "number" && Number.isFinite(x));

const countBy = (xs) => xs.reduce((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {});

export const groupBy = (xs, keyOf) => [...xs.reduce((m, x) => m.set(keyOf(x), [...(m.get(keyOf(x)) ?? []), x]), new Map()).values()];

export function median(xs) {
  const s = numbers(xs).sort((a, b) => a - b);
  if (!s.length) return null;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

const mean = (xs) => ((n) => (n.length ? n.reduce((a, b) => a + b, 0) / n.length : null))(numbers(xs));

export const passAtK = (n, c, k) => (k < 1 || n < k ? null : 1 - Array.from({ length: k }, (_, i) => Math.max(0, (n - c - i) / (n - i))).reduce((p, x) => p * x, 1));

// ---- the runs a rate stands on -------------------------------------------------------------------------------------------

const standing = (fs) => fs.filter((f) => !f.excluded && !f.interrupted);

const leftOut = (fs) => countBy(fs.filter((f) => f.excluded || f.interrupted).map((f) => f.excluded ?? "interrupted"));

const passed = (f) => PASSED.includes(f.outcome);

const minutes = (ms) => (ms === null ? UNKNOWN : round4(ms / 60000));

// ---- rows and models -----------------------------------------------------------------------------------------------------

// The host a run's row is counted under (0.5.0): its model and the effort it was asked to run at -- two efforts of one
// model are two hosts, as two models are -- in one word a fold keys by and a line says: `<model>` when no effort was
// asked (the host's own default), `<model>@<effort>` otherwise.
export const hostOfRun = (f) => (f.effort ? `${f.modelSaid}@${f.effort}` : f.modelSaid);

const rowKey = (f) => [f.case, f.variant, f.arm, f.memory ?? "-", f.basis, hostOfRun(f)].join("\u0000");

const spendOf = (s) => ({ medianCostUsd: valued(median(s.map((f) => f.costUsd))), costReported: s.filter((f) => typeof f.costUsd === "number").length, costPerVerifiedUsd: valued(mean(s.filter(passed).map((f) => f.costUsd))), medianMinutes: minutes(median(s.map((f) => f.durationMs))) });

function rowOf(group, k) {
  const s = standing(group);
  const c = s.filter(passed).length;
  return { case: group[0].case, suite: group[0].suite, variant: group[0].variant, arm: group[0].arm, memory: group[0].memory ?? null, basis: group[0].basis, model: group[0].modelSaid, effort: group[0].effort ?? null, runs: s.length, passed: c, excluded: leftOut(group), pass1: valued(s.length ? c / s.length : null), passK: { k, value: valued(passAtK(s.length, c, k)) }, ...spendOf(s) };
}

// One model at one effort on one basis, over every row it carried: pooled pass@1, the mean of its rows' pass@k, its
// medians.
function modelOf(group, k) {
  const rows = groupBy(group, rowKey).map((g) => rowOf(g, k));
  const s = standing(group);
  return { basis: group[0].basis, model: group[0].modelSaid, effort: group[0].effort ?? null, rows: rows.length, runs: s.length, passed: s.filter(passed).length, excluded: leftOut(group), pass1: valued(s.length ? s.filter(passed).length / s.length : null), passK: { k, value: valued(mean(rows.map((r) => r.passK.value))), over: rows.filter((r) => r.passK.value !== UNKNOWN).length }, ...spendOf(s) };
}

const rowSaid = (r) => [r.case, r.variant, r.arm, r.memory ?? "", r.basis, r.model, r.effort ?? ""].join(" ");

const byRow = (a, b) => rowSaid(a).localeCompare(rowSaid(b));

const modelSaid = (m) => `${m.basis} ${m.model} ${m.effort ?? ""}`;

export function ratesOf(fs, o = {}) {
  const k = o.k ?? DEFAULT_K;
  return { k, rows: groupBy(fs, rowKey).map((g) => rowOf(g, k)).sort(byRow), models: groupBy(fs, (f) => `${f.basis}\u0000${hostOfRun(f)}`).map((g) => modelOf(g, k)).sort((a, b) => modelSaid(a).localeCompare(modelSaid(b))) };
}

// The same rows, one set per source revision, oldest first: what a change to the source did to how often a row holds.
export const revisionsOf = (fs, o = {}) => groupBy(fs, (f) => f.commit ?? "-").map((g) => ({ commit: g[0].commit?.slice(0, 12) ?? null, at: g.map((f) => f.at).sort().at(-1) ?? null, runs: g.length, rows: ratesOf(g, o).rows })).sort((a, b) => String(a.at).localeCompare(String(b.at)));

// ---- the overhead of an Orbit arm ----------------------------------------------------------------------------------------

export const ORBIT_ARMS = ["baseline", "release"];

const sideOf = (fs) => ({ runs: fs.length, costUsd: median(fs.map((f) => f.costUsd)), turns: median(fs.map((f) => f.turns)), tokens: median(fs.map((f) => f.tokens)) });

const minus = (a, b) => (a === null || b === null ? UNKNOWN : round4(a - b));

const said = (side) => ({ runs: side.runs, costUsd: valued(side.costUsd), turns: valued(side.turns), tokens: valued(side.tokens) });

const overheadRow = (g, arm) => ((a, n) => ({ case: g[0].case, variant: g[0].variant, basis: g[0].basis, model: g[0].modelSaid, effort: g[0].effort ?? null, arm, armSide: said(a), noneSide: said(n), overhead: { costUsd: minus(a.costUsd, n.costUsd), turns: minus(a.turns, n.turns), tokens: minus(a.tokens, n.tokens) } }))(sideOf(g.filter((f) => f.arm === arm)), sideOf(g.filter((f) => f.arm === "none")));

const comparable = (g, arm) => g.some((f) => f.arm === arm) && g.some((f) => f.arm === "none");

// orbit_overhead: per case, each Orbit arm beside the `none` arm on the same case, variant, basis, model and effort.
export const overheadOf = (fs) => groupBy(standing(fs), (f) => [f.case, f.variant, f.basis, hostOfRun(f)].join("\u0000")).flatMap((g) => ORBIT_ARMS.filter((arm) => comparable(g, arm)).map((arm) => overheadRow(g, arm)));

// ---- the memory arms of a sessions case (0.5.0, B3, ADR 0054) -------------------------------------------------------------

// What one memory arm's runs came to: how often they passed, and the medians of what their second session's work came
// to -- every number over the runs a rate stands on, what each left out counted by why.
const armSide = (fs, s) => ({ runs: s.length, passed: s.filter(passed).length, excluded: leftOut(fs), pass1: valued(s.length ? s.filter(passed).length / s.length : null), decisions: valued(median(s.map((f) => f.session?.decisions))), designsRefused: valued(median(s.map((f) => f.session?.designsRefused))), costUsd: valued(median(s.map((f) => f.session?.costUsd))), minutes: valued(median(s.map((f) => f.session?.minutes))) });

const memorySide = (fs) => armSide(fs, standing(fs));

// What memory changed: the `on` arm's numbers minus the `off` arm's -- unknown where either side has none.
export const EFFECTS = ["pass1", "decisions", "designsRefused", "costUsd", "minutes"];

const effectOf = (on, off) => Object.fromEntries(EFFECTS.map((k) => [k, typeof on[k] === "number" && typeof off[k] === "number" ? round4(on[k] - off[k]) : UNKNOWN]));

const memoryRow = (g) => ((arms) => ({ case: g[0].case, variant: g[0].variant, basis: g[0].basis, model: g[0].modelSaid, effort: g[0].effort ?? null, arms, effect: arms.on && arms.off ? effectOf(arms.on, arms.off) : null }))(Object.fromEntries(groupBy(g, (f) => f.memory).map((a) => [a[0].memory, memorySide(a)])));

const memorySaid = (r) => [r.case, r.variant, r.basis, r.model, r.effort ?? ""].join(" ");

// Every sessions case's memory arms, side by side on the same case, variant, basis, model and effort.
export const memoryOf = (fs) => groupBy(fs.filter((f) => f.memory), (f) => [f.case, f.variant, f.basis, hostOfRun(f)].join("\u0000")).map(memoryRow).sort((a, b) => memorySaid(a).localeCompare(memorySaid(b)));
