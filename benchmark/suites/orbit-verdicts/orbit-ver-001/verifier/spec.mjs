// THE SPEC of ORBIT-VER-001: the status a finished run DESERVES, written from the engine's "PASS is earned" rule and
// never from the code. Kept beside the probe and handed to no runner; the controller imports a FROZEN copy of it, and it
// never imports the subject. A run reaches PASS by having nothing stop it, which proves less than it sounds: PASS must
// also have EXECUTED at least one of the case's verdicts (else INCONCLUSIVE) and run the WHOLE case (else PARTIAL), and
// a word a step already earned -- FAIL, SKIP, BLOCKED, REFUSED -- is never judged again. Every check expects exactly one
// status, so a judge that passes everything, one that passes nothing and one that widens PASS by a single step all fail.
//
// Slices are checked at the edges that matter -- the whole case, one step short of it, past its last step, starting one
// step late -- over cases of one step and of many, and seeded runs draw statuses, verdict counts and slices with the
// run's seed.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to a table written by hand from the contract
export const CASE = "ORBIT-VER-001";

export const GROUPS = {
  "earned-pass": "a PASS that executed at least one verdict over the whole case -- from step 1 to the last step, or past it -- stays PASS",
  "no-verdict": "a PASS that executed no verdict is INCONCLUSIVE, whole or sliced: proving nothing outranks running part",
  "no-count": "a PASS that carries no verdict count at all executed none: INCONCLUSIVE",
  "sliced": "a PASS with verdicts over a slice that starts after step 1 is PARTIAL",
  "one-step-short": "a PASS with verdicts over a slice from step 1 that stops before the last step -- even by one -- is PARTIAL, never the case",
  "never-rejudged": "a run that ended FAIL, SKIP, BLOCKED or REFUSED keeps that word, sliced or whole, with or without verdicts",
  "whole": "whole() is true exactly when the slice starts at step 1 and reaches the case's last step",
  "seeded-status": "seeded runs: exactly the status each deserves",
  "seeded-whole": "seeded slices: whole exactly when they start at step 1 and reach the last step",
};

// ---- the reference model, as the contract words it ----------------------------------------------------------------------

const wholeOf = (run) => run.from === 1 && run.to >= run.c.steps.length;

// A word a step earned stands; a PASS needs a verdict executed, then the whole case.
export const statusOf = (run) => (run.status !== "PASS" ? run.status : !(run.verdicts > 0) ? "INCONCLUSIVE" : wholeOf(run) ? "PASS" : "PARTIAL");

const sliceWord = (run) => (wholeOf(run) ? "WHOLE" : "PART");

// ---- what the inputs are made of ---------------------------------------------------------------------------------------

const steps = (n) => Array.from({ length: n }, (_, k) => ({ do: k === 0 ? "goto" : "click" }));

// A run as the loop leaves it: the status it reached, the verdicts it executed (none counted: left out), the slice.
const run = (status, verdicts, from, to, n) => ({ status, ...(verdicts === undefined ? {} : { verdicts }), from, to, c: { steps: steps(n) } });

const status = (...a) => ({ call: "status", run: run(...a) });

const slice = (from, to, n) => ({ call: "whole", run: run("PASS", 1, from, to, n) });

// ---- the checks written by hand ------------------------------------------------------------------------------------------

const STATUSES = [
  ["earned-pass", status("PASS", 3, 1, 8, 8), "PASS"],
  ["earned-pass", status("PASS", 1, 1, 1, 1), "PASS"],
  ["earned-pass", status("PASS", 12, 1, 12, 12), "PASS"],
  ["earned-pass", status("PASS", 2, 1, 10, 8), "PASS"],
  ["earned-pass", status("PASS", 1, 1, 9, 8), "PASS"],
  ["no-verdict", status("PASS", 0, 1, 8, 8), "INCONCLUSIVE"],
  ["no-verdict", status("PASS", 0, 1, 3, 8), "INCONCLUSIVE"],
  ["no-verdict", status("PASS", 0, 6, 8, 8), "INCONCLUSIVE"],
  ["no-verdict", status("PASS", 0, 1, 1, 1), "INCONCLUSIVE"],
  ["no-verdict", status("PASS", 0, 1, 7, 8), "INCONCLUSIVE"],
  ["no-verdict", status("PASS", 0, 1, 12, 12), "INCONCLUSIVE"],
  ["no-count", status("PASS", undefined, 1, 8, 8), "INCONCLUSIVE"],
  ["no-count", status("PASS", undefined, 3, 5, 8), "INCONCLUSIVE"],
  ["sliced", status("PASS", 3, 6, 8, 8), "PARTIAL"],
  ["sliced", status("PASS", 2, 2, 8, 8), "PARTIAL"],
  ["sliced", status("PASS", 2, 3, 5, 8), "PARTIAL"],
  ["sliced", status("PASS", 1, 2, 2, 2), "PARTIAL"],
  ["sliced", status("PASS", 4, 2, 9, 8), "PARTIAL"],
  ["one-step-short", status("PASS", 3, 1, 7, 8), "PARTIAL"],
  ["one-step-short", status("PASS", 1, 1, 1, 2), "PARTIAL"],
  ["one-step-short", status("PASS", 5, 1, 11, 12), "PARTIAL"],
  ["one-step-short", status("PASS", 2, 1, 2, 3), "PARTIAL"],
  ["one-step-short", status("PASS", 1, 1, 4, 8), "PARTIAL"],
  ["never-rejudged", status("FAIL", 1, 1, 8, 8), "FAIL"],
  ["never-rejudged", status("FAIL", 0, 6, 8, 8), "FAIL"],
  ["never-rejudged", status("FAIL", 0, 1, 8, 8), "FAIL"],
  ["never-rejudged", status("SKIP", 0, 1, 8, 8), "SKIP"],
  ["never-rejudged", status("SKIP", 2, 1, 7, 8), "SKIP"],
  ["never-rejudged", status("BLOCKED", 0, 1, 8, 8), "BLOCKED"],
  ["never-rejudged", status("BLOCKED", 3, 2, 5, 8), "BLOCKED"],
  ["never-rejudged", status("REFUSED", 0, 1, 8, 8), "REFUSED"],
  ["never-rejudged", status("REFUSED", 1, 1, 7, 8), "REFUSED"],
];

const SLICES = [
  [slice(1, 8, 8), "WHOLE"],
  [slice(1, 9, 8), "WHOLE"],
  [slice(1, 1, 1), "WHOLE"],
  [slice(1, 12, 12), "WHOLE"],
  [slice(1, 7, 8), "PART"],
  [slice(1, 1, 2), "PART"],
  [slice(1, 11, 12), "PART"],
  [slice(2, 8, 8), "PART"],
  [slice(3, 5, 8), "PART"],
];

const FIXED = [...STATUSES.map(([group, input, word]) => ({ group, input, expect: { exactly: [word] } })), ...SLICES.map(([input, word]) => ({ group: "whole", input, expect: { exactly: [word] } }))];

// ---- a seeded generator, the same runs for the same seed --------------------------------------------------------------

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

const REACHED = ["PASS", "PASS", "PASS", "PASS", "PASS", "FAIL", "SKIP", "BLOCKED", "REFUSED"];

// A slice of an n-step case: mostly from step 1, ending at the last step, one short of it, one past it, or anywhere.
const sliceOf = (r, n) => ((from) => [from, Math.max(from, pick(r, [n, n, n - 1, n + 1, from + Math.floor(r() * (n - from + 1))]))])(r() < 0.65 ? 1 : 1 + Math.floor(r() * n));

const seededRun = (r) => ((n) => ((cut) => run(pick(r, REACHED), pick(r, [0, 0, undefined, 1, 2, 1 + Math.floor(r() * 9)]), cut[0], cut[1], n))(sliceOf(r, n)))(1 + Math.floor(r() * 12));

const seededStatus = (r) => ((input) => ({ group: "seeded-status", input, expect: { exactly: [statusOf(input.run)] } }))({ call: "status", run: seededRun(r) });

const seededWhole = (r) => ((input) => ({ group: "seeded-whole", input, expect: { exactly: [sliceWord(input.run)] } }))({ call: "whole", run: seededRun(r) });

// ---- all of them, numbered within their group ------------------------------------------------------------------------

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  return numbered([...FIXED, ...Array.from({ length: Math.max(16, samples) }, () => seededStatus(r)), ...Array.from({ length: Math.max(8, Math.floor(samples / 3)) }, () => seededWhole(r))]);
}

// ---- the reference model, held to what the contract says in words ------------------------------------------------------

export const selfTest = () => [...STATUSES.filter(([, input, word]) => statusOf(input.run) !== word).map(([group, input]) => `the reference model disagrees with the contract on ${group}: ${input.run.status} with ${input.run.verdicts ?? "no"} verdict(s), steps ${input.run.from}..${input.run.to} of ${input.run.c.steps.length}`), ...SLICES.filter(([input, word]) => sliceWord(input.run) !== word).map(([input]) => `the reference model disagrees with the contract on steps ${input.run.from}..${input.run.to} of ${input.run.c.steps.length}`)];
