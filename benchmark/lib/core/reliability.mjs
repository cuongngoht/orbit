// THE RELIABILITY REPORT (0.5.0: backlog B2, B9 and B23): what the kept runs of a revision show of how OFTEN each row
// holds -- pass@1, pass@k, median cost and minutes, per row and per model -- how often a host's tool calls failed and
// what getting past a failure cost, per suite and per model, and what each arm adds and costs beside the others. One
// document, folded from the kept rooms exactly as `metrics` folds them and written nowhere by itself: a release ship
// writes what this answers next to its evidence.json, and the release notes quote it.
//
// 0.5.0 (B3, ADR 0054) adds `memory`: each sessions case's memory arms side by side -- pass@1, decisions used, designs
// refused, cost and minutes of the second session -- and the effect of memory, the `on` arm's minus the `off` arm's.
//
//   reliabilityOf(runs, o = { scope, store, at, k }) -> { schema, kind, at, scope, store, runs, rates, tools, arms, memory,
//                                                        notes }
//   sayReliability(r) -> text      RELIABILITY_KIND      memoryLines(rows) -> lines
import { runFacts } from "./metrics.mjs";
import { groupBy, memoryOf, overheadOf, ratesOf } from "./rates.mjs";
import { toolsFoldOf } from "./tools.mjs";

export const RELIABILITY_KIND = "orbit.benchmark.reliability/v1";

const NOTES = [
  "A rate counts only runs that came to an ending a rate may count: blocked, invalid, inconclusive, held, unfinished and interrupted runs are left out, and counted by why.",
  "pass@k is the unbiased estimate from n >= k runs of a row; a row with fewer runs than k says nothing about k.",
  "Costs, turns and tokens are what a host REPORTED; a recovery's cost is the reported cost apportioned by reported tokens. Nothing is estimated from a budget.",
  "Host bases are kept apart: a scripted host's numbers prove the controller and the engine, never a model.",
  "A model is counted at the effort its host was asked to run at (model@effort; a model alone ran at its own default): two efforts of one model are two rows, never one rate.",
  "An arm's overhead is its median minus the none arm's, on the same case, variant, host basis, model and effort.",
  "A run whose report kept no tool facts (one from before 0.5.0) is counted as unread, never as zero: node benchmark/run.mjs report <bnr-…> writes them.",
  "A memory arm's numbers are its second session's (a sessions run): the first, the same for both arms, is never the arm's. Memory's effect is the on arm's median minus the off arm's, and says nothing until both have runs that stand; the off arm switches off ORBIT_LEARN and ORBIT_HOST_MEMORY, and what no switch governs stays in both.",
];

const countBy = (xs) => xs.reduce((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {});

const armSaid = (row) => ({ runs: row.runs, passed: row.passed, excluded: row.excluded, pass1: row.pass1, passK: row.passK, costPerVerifiedUsd: row.costPerVerifiedUsd, medianCostUsd: row.medianCostUsd, medianMinutes: row.medianMinutes });

// B23: each case on each arm it ran on, side by side -- the same case, variant, host basis, model and effort.
const comparedArms = (rows) => groupBy(rows, (r) => [r.case, r.variant, r.basis, r.model, r.effort ?? "-"].join("\u0000")).filter((g) => g.length > 1).map((g) => ({ case: g[0].case, variant: g[0].variant, basis: g[0].basis, model: g[0].model, effort: g[0].effort ?? null, arms: Object.fromEntries(g.map((r) => [r.arm, armSaid(r)])) }));

export function reliabilityOf(runs, o = {}) {
  const fs = runs.map(runFacts);
  const rates = ratesOf(fs, o);
  return { schema: 1, kind: RELIABILITY_KIND, at: o.at ?? null, scope: o.scope ?? {}, store: o.store ?? null, runs: { total: fs.length, byBasis: countBy(fs.map((f) => f.basis)), byArm: countBy(fs.map((f) => f.arm)), byMemory: countBy(fs.filter((f) => f.memory).map((f) => f.memory)), byOutcome: countBy(fs.map((f) => f.outcome ?? "unfinished")) }, rates, tools: toolsFoldOf(fs), arms: { rows: comparedArms(rates.rows), overhead: overheadOf(fs) }, memory: { rows: memoryOf(fs) }, notes: NOTES };
}

// ---- in words ------------------------------------------------------------------------------------------------------------

const money = (v) => (v === "unknown" ? "unknown" : `${v} USD`);

// A model at the effort it was asked to run at, as every line says it.
const hostSaid = (x) => (x.effort ? `${x.model}@${x.effort}` : x.model);

const rowLine = (r) => `  ${r.case} ${r.variant}${r.arm !== "release" ? ` [${r.arm}]` : ""}${r.memory ? ` [memory ${r.memory}]` : ""} (${r.basis}, ${hostSaid(r)}): pass@1 ${r.pass1} over ${r.runs}, pass@${r.passK.k} ${r.passK.value}; median ${money(r.medianCostUsd)}, ${r.medianMinutes} min`;

const modelLine = (m) => `  ${hostSaid(m)} (${m.basis}): pass@1 ${m.pass1} over ${m.runs} run(s) of ${m.rows} row(s), pass@${m.passK.k} ${m.passK.value} (mean of ${m.passK.over} row(s)); median ${money(m.medianCostUsd)}, ${m.medianMinutes} min`;

const toolLine = (basis, suite, f) => `  ${basis} ${suite}: ${f.calls.failed}/${f.calls.calls} call(s) failed (${f.calls.rate}); ${f.failedPerPass.value} failed per PASS; ${f.recovery.episodes} recovery episode(s), ${f.recovery.turnsPerEpisode.value} turn(s) each${f.unread ? `; ${f.unread} run(s) unread` : ""}`;

const toolLines = (tools) => Object.entries(tools).flatMap(([basis, b]) => Object.entries(b.suites).map(([suite, f]) => toolLine(basis, suite, f)));

const armLine = (c) => `  ${c.case} ${c.variant} (${c.basis}, ${hostSaid(c)}): ${Object.entries(c.arms).map(([arm, a]) => `${arm} pass@1 ${a.pass1}/${a.runs}, ${money(a.costPerVerifiedUsd)} per verified`).join(" · ")}`;

const overheadLine = (o) => `  ${o.case} ${o.variant} ${o.arm} over none (${o.basis}, ${hostSaid(o)}): ${money(o.overhead.costUsd)}, ${o.overhead.turns} turn(s), ${o.overhead.tokens} token(s)`;

const section = (title, lines) => (lines.length ? [title, ...lines] : [`${title}: none`]);

const signed = (v) => (v === "unknown" ? "unknown" : `${v > 0 ? "+" : ""}${v}`);

const sideSaid = (arm, a) => `${arm}: pass@1 ${a.pass1} over ${a.runs}, ${a.decisions} decision(s), ${a.designsRefused} design(s) refused, ${money(a.costUsd)}, ${a.minutes} min`;

const effectSaid = (e) => (e ? `effect of memory (on − off): pass@1 ${signed(e.pass1)}, decisions ${signed(e.decisions)}, designs refused ${signed(e.designsRefused)}, cost ${signed(e.costUsd)}, minutes ${signed(e.minutes)}` : "effect of memory: unknown until both arms have runs that stand");

const memoryLine = (m) => [`  ${m.case} ${m.variant} (${m.basis}, ${hostSaid(m)}): ${Object.entries(m.arms).map(([arm, a]) => sideSaid(arm, a)).join(" · ")}`, `    ${effectSaid(m.effect)}`];

// The lines `metrics` and the report print of the memory arms: each case's arms side by side, and memory's effect.
export const memoryLines = (rows) => (rows.length ? section("MEMORY ARMS (the second session's medians)", rows.flatMap(memoryLine)) : []);

// The lines `metrics` prints of the same folds.
export const ratesLines = (rates) => [...section(`RELIABILITY BY ROW (pass@${rates.k})`, rates.rows.map(rowLine)), ...section("RELIABILITY BY MODEL", rates.models.map(modelLine))];

export const toolsLines = (tools) => section("TOOL CALLS BY SUITE", toolLines(tools));

export const overheadLines = (rows) => (rows.length ? section("ORBIT OVERHEAD (an Orbit arm minus none)", rows.map(overheadLine)) : []);

export const sayReliability = (r) => [`RELIABILITY  ${r.runs.total} run(s) · ${Object.entries(r.scope).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => `${k} ${v}`).join(", ") || "every run kept"}`, ...section("ROWS", r.rates.rows.map(rowLine)), ...section("MODELS", r.rates.models.map(modelLine)), ...section("TOOL CALLS", toolLines(r.tools)), ...section("ARMS", r.arms.rows.map(armLine)), ...section("OVERHEAD", r.arms.overhead.map(overheadLine)), ...section("MEMORY", (r.memory?.rows ?? []).flatMap(memoryLine)), ...r.notes.map((n) => `· ${n}`)].join("\n");
