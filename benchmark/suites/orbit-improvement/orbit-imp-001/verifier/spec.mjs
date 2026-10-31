// THE SPEC of ORBIT-IMP-001: what ONE evaluation of a candidate comes to beside the version it would replace, written
// from its contract (ADR 0045, "Judging one evaluation"; the header of src/improvement/evaluation.mjs) and never from
// its code. Kept beside the probe and handed to no runner; the controller imports a FROZEN copy of it, and it never
// imports the subject. An evaluation runs the BASELINE and the CANDIDATE on the same frozen inputs, run n of one beside
// run n of the other, and its table decides in order: a blocked run compares nothing; unequal inputs decide nothing; a
// step the candidate newly failed on an input where the baseline met it is WORSE whatever else the candidate improved;
// a baseline that met every run did not reproduce the failure; then more runs met is BETTER, fewer WORSE, and
// otherwise EQUIVALENT. What a run cost never decides anything.
//
// Every check is an evaluation and an expectation over the ids the probe reports -- the verdict, and `regression:<step>`
// for each step the subject names as newly failed. Both directions are checked, so a table that calls every candidate
// better fails as surely as one that calls every candidate worse. Seeded evaluations add random runs, each consistent
// the way an owner's record is: a run met exactly when none of its required steps failed.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to the hand-written expectations of the fixed checks
export const CASE = "ORBIT-IMP-001";

export const GROUPS = {
  blocked: "a run the environment or a person stopped compares nothing: BLOCKED, whatever the other runs show",
  "unequal-inputs": "two versions that did not run the same inputs decide nothing: INCONCLUSIVE",
  "regression-improved-elsewhere": "a step the candidate newly failed on an input where the baseline met it makes the candidate WORSE even when it met more runs, and the step is named",
  "regression-as-many": "a step the candidate newly failed makes it WORSE when it met as many runs as the baseline, and the step is named",
  "regression-named": "only a step the candidate newly failed on that input is named: a step both versions failed there is not",
  "not-reproduced": "a baseline that met every run did not reproduce the failure: INCONCLUSIVE, however fast the candidate was",
  better: "a candidate that met more runs than the baseline, with no step newly failing, is BETTER",
  "fewer-met": "a candidate that met fewer runs than the baseline is WORSE",
  equivalent: "a candidate that met as many runs as the baseline, with no step newly failing, is EQUIVALENT",
  "seeded-regression": "seeded: a candidate that fixes several failing inputs and newly fails a step on one the baseline met is WORSE, and the step is named",
  seeded: "seeded runs on both sides, input by input: the verdict and the newly failed steps the contract's table gives",
};

const VERDICTS = ["BETTER", "EQUIVALENT", "WORSE", "INCONCLUSIVE", "BLOCKED"];

// ---- the reference model: the contract's table, as data -------------------------------------------------------------

const sideOf = (runs, side) => runs.filter((r) => r.side === side).sort((a, b) => a.n - b.n);

const metOf = (rows) => rows.filter((r) => r.met).length;

// A step the candidate failed on an input where the baseline did not fail it: newly failed, on that same input.
const newlyFailed = (b, x) => (x ? x.failing.filter((s) => !b.failing.includes(s)) : []);

const regressionsOf = (base, cand) => [...new Set(base.flatMap((b) => newlyFailed(b, cand.find((x) => x.n === b.n))))].sort();

const factsOf = (runs) => ((base, cand) => ({ runs, base, cand, regressions: regressionsOf(base, cand) }))(sideOf(runs, "baseline"), sideOf(runs, "candidate"));

// In its order: the first row that holds decides.
const TABLE = [
  { verdict: "BLOCKED", when: (f) => f.runs.some((r) => r.blocked) },
  { verdict: "INCONCLUSIVE", when: (f) => f.base.length === 0 || f.cand.length !== f.base.length },
  { verdict: "WORSE", when: (f) => f.regressions.length > 0 },
  { verdict: "INCONCLUSIVE", when: (f) => metOf(f.base) === f.base.length },
  { verdict: "BETTER", when: (f) => metOf(f.cand) > metOf(f.base) },
  { verdict: "WORSE", when: (f) => metOf(f.cand) < metOf(f.base) },
  { verdict: "EQUIVALENT", when: () => true },
];

// What an evaluation owes: its verdict, and every step the candidate newly failed.
export const owed = (runs) => ((f) => [TABLE.find((r) => r.when(f)).verdict, ...f.regressions.map((s) => `regression:${s}`)])(factsOf(runs));

// ---- what the inputs are made of ------------------------------------------------------------------------------------

const TASK = "tsk-0000000000e1";

const run = (side, n, failing = [], over = {}) => ({ side, n, run: `${TASK}/srun-${side[0]}${n}`, word: failing.length ? "FAILED" : "REPORTED", met: failing.length === 0, failing, blocked: false, retries: 0, calls: 3, ms: 120, attribution: "RUNTIME_BOUND", evidence: failing.length ? "NONE" : "CONTRACT_MET", ...over });

// A run the environment or a person stopped: it met nothing, and no step of it failed.
const STOPPED = { word: "BLOCKED", met: false, blocked: true, evidence: "NONE" };

// A run that met nothing and named no failing step: a workflow with no required step answered.
const MET_NOTHING = { word: "FAILED", met: false, evidence: "NONE" };

const sides = (base, cand) => [...base.map((failing, i) => run("baseline", i + 1, failing)), ...cand.map((failing, i) => run("candidate", i + 1, failing))];

const evaluation = (runs) => ({ call: "verdict", evaluation: { evaluation: "ev-1", task: TASK, baseline: "release-notes:1.0.0:aaaaaaaa", candidate: "release-notes:1.0.1:bbbbbbbb", runs } });

const exact = (group, runs, ids) => ({ group, runs, ids });

const loose = (group, runs, verdict) => ({ group, runs, verdict });

// ---- the fixed checks, each expectation written by hand from the contract -------------------------------------------

const FIXED = [
  loose("blocked", [run("baseline", 1, [], STOPPED), run("candidate", 1)], "BLOCKED"),
  loose("blocked", [...sides([["notes"], ["notes"]], [[]]), run("candidate", 2, [], STOPPED)], "BLOCKED"),
  loose("blocked", [...sides([[], ["notes"]], [["evidence"]]), run("candidate", 2, [], STOPPED)], "BLOCKED"),
  loose("unequal-inputs", sides([["notes"], ["notes"], ["notes"]], [[], []]), "INCONCLUSIVE"),
  loose("unequal-inputs", sides([["notes"], ["notes"]], [[], [], []]), "INCONCLUSIVE"),
  loose("unequal-inputs", sides([], [[], []]), "INCONCLUSIVE"),
  loose("unequal-inputs", sides([[], ["notes"], ["notes"]], [["evidence"], []]), "INCONCLUSIVE"),
  exact("unequal-inputs", [], ["INCONCLUSIVE"]),
  exact("regression-improved-elsewhere", sides([["notes"], ["notes"], []], [[], [], ["evidence"]]), ["WORSE", "regression:evidence"]),
  exact("regression-improved-elsewhere", sides([["notes"], ["notes"], ["notes"], []], [[], [], [], ["evidence", "summary"]]), ["WORSE", "regression:evidence", "regression:summary"]),
  exact("regression-improved-elsewhere", sides([["notes"], ["summary"], [], []], [[], [], [], ["links"]]), ["WORSE", "regression:links"]),
  exact("regression-improved-elsewhere", sides([["notes"], ["notes"], ["notes"], [], []], [[], [], [], ["evidence"], ["links"]]), ["WORSE", "regression:evidence", "regression:links"]),
  exact("regression-as-many", sides([["notes"], []], [[], ["evidence"]]), ["WORSE", "regression:evidence"]),
  exact("regression-as-many", sides([["notes"]], [["evidence"]]), ["WORSE", "regression:evidence"]),
  exact("regression-named", sides([["notes"]], [["evidence", "notes"]]), ["WORSE", "regression:evidence"]),
  exact("regression-named", sides([["notes", "summary"], []], [["notes"], ["summary"]]), ["WORSE", "regression:summary"]),
  exact("not-reproduced", sides([[], []], [[], []]), ["INCONCLUSIVE"]),
  exact("not-reproduced", [...sides([[], [], []], []), ...[1, 2, 3].map((n) => run("candidate", n, [], { calls: 1, ms: 30 }))], ["INCONCLUSIVE"]),
  exact("better", sides([["notes"]], [[]]), ["BETTER"]),
  exact("better", sides([["notes"], ["notes"], []], [[], ["notes"], []]), ["BETTER"]),
  exact("better", sides([["notes", "summary"], ["evidence"]], [["summary"], []]), ["BETTER"]),
  loose("fewer-met", sides([["notes"], [], []], [["notes"], ["notes"], []]), "WORSE"),
  exact("fewer-met", [...sides([["notes"], []], [["notes"]]), run("candidate", 2, [], MET_NOTHING)], ["WORSE"]),
  exact("equivalent", sides([["notes"]], [["notes"]]), ["EQUIVALENT"]),
  exact("equivalent", sides([["notes"], [], ["summary"]], [["notes"], [], ["summary"]]), ["EQUIVALENT"]),
  exact("equivalent", sides([["notes", "summary"], []], [["summary"], []]), ["EQUIVALENT"]),
];

const only = (verdict) => ({ has: [verdict], lacks: VERDICTS.filter((v) => v !== verdict) });

const asCheck = (row) => ({ group: row.group, input: evaluation(row.runs), expect: row.ids ? { exactly: row.ids } : only(row.verdict) });

// ---- a seeded generator, the same numbers for the same seed --------------------------------------------------------

export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    const t = Math.imul(s ^ (s >>> 15), s | 1);
    const u = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((u ^ (u >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, list) => list[Math.floor(r() * list.length)];

const STEPS = ["evidence", "notes", "summary", "links"];

const someSteps = (r) => [...new Set([pick(r, STEPS), ...STEPS.filter(() => r() < 0.25)])].sort();

const failingOf = (r, pMet) => (r() < pMet ? [] : someSteps(r));

// On one input the candidate meets, keeps some of the baseline's own failures there, or fails something at random.
const candidateOn = (r, b) => ((x) => (x < 0.4 ? [] : x < 0.8 ? b.filter(() => r() < 0.6) : someSteps(r)))(r());

const seededCheck = (group, runs) => ({ group, input: evaluation(runs), expect: { exactly: owed(runs) } });

function seededRandom(r) {
  const k = 1 + Math.floor(r() * 5);
  const base = Array.from({ length: k }, () => failingOf(r, 0.35));
  return seededCheck("seeded", sides(base, base.map((b) => candidateOn(r, b))));
}

// Several inputs the baseline failed, every one fixed by the candidate, and one input the baseline met newly failing.
function seededRegression(r) {
  const k = 3 + Math.floor(r() * 4);
  const j = 2 + Math.floor(r() * (k - 2));
  const base = Array.from({ length: k }, (_, i) => (i < j ? someSteps(r) : []));
  return seededCheck("seeded-regression", sides(base, base.map((_, i) => (i === k - 1 ? someSteps(r) : []))));
}

// ---- all of them, numbered within their group ------------------------------------------------------------------------

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  const regressions = Array.from({ length: Math.max(4, Math.floor(samples / 4)) }, () => seededRegression(r));
  return numbered([...FIXED.map(asCheck), ...regressions, ...Array.from({ length: Math.max(8, Math.floor(samples / 2)) }, () => seededRandom(r))]);
}

// ---- the reference model, held to what the contract says in words --------------------------------------------------

const sameIds = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

const agrees = (row) => (row.ids ? sameIds(owed(row.runs), row.ids) : owed(row.runs)[0] === row.verdict);

const seededWorse = () => cases(7, 48).filter((c) => c.group === "seeded-regression").every((c) => c.expect.exactly[0] === "WORSE" && c.expect.exactly.length > 1);

export const selfTest = () => [...FIXED.filter((row) => !agrees(row)).map((row) => `the reference model disagrees with the contract on a ${row.group} evaluation`), ...(seededWorse() ? [] : ["a seeded regression is not owed WORSE with the step it newly failed"])];
