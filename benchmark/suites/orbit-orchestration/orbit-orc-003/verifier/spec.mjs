// THE SPEC of ORBIT-ORC-003: NO_PROGRESS is three completed attempts IN A ROW that ended on one failure signature, and a
// signature does not move for what changes between two runs of the same failure -- written from that contract (the
// headers of the task model, the progress rows and the failure module; ADR 0019 on the exact identity), never from the
// code. Kept beside the probe and handed to no runner; the controller imports a FROZEN copy of it, and it never imports
// the subject.
//
// Every check is an input and an expectation over the ids the subject reports: `repeats:<n>` and `SAME_FAILURE` for an
// attempt history folded by the task model and read by the progress rows; `SAME` or `DIFFERENT` (and `HEX12`, `CUT`)
// for two runs compared by their signature or their exact identity; `class:<C>` and `confidence:<c>` for the facts of
// one failure. Seeded runs are rendered from one failure twice, with independent timestamps, durations, roots, paths,
// ids and line order -- or from two failures that differ in what the contract says moves a signature.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to a table written by hand from the contract
export const CASE = "ORBIT-ORC-003";

export const GROUPS = {
  "repeats": "repeats counts the completed attempts in a row, back from the last, that ended on the last one's failure signature",
  "no-progress": "NO_PROGRESS (SAME_FAILURE) is three or more completed attempts in a row on one signature, never repeats scattered among others",
  "run-broken": "an attempt that ended with no failure signature breaks the run, and an attempt still open is not counted",
  "signature-volatile": "two runs of the same failure sign the same across timestamps, absolute paths, the workspace's path, ids, durations and line order",
  "signature-different": "a different failing test, the same test failing differently, another check, another purpose or a timeout signs differently",
  "exact-volatile": "the exact identity leaves out only escape codes, the workspace's path, timings, durations and timestamps, in any line order",
  "exact-different": "the exact identity differs for any other value, name, count or absolute path, and a run kept only in part has none",
  "class-from-facts": "a failure is classified from facts: not started, or failing the same way at the baseline, is the environment; CODE and TEST are high only on a passing baseline",
  "seeded-progress": "random attempt histories: repeats and NO_PROGRESS exactly as the contract counts them",
  "seeded-signature": "random runs of one failure and of different failures: the same signature exactly when the failure is the same",
  "seeded-exact": "random runs: the same exact identity exactly when only what the contract leaves out moved",
};

const NO_PROGRESS_AT = 3;

// ---- the reference model: the contract, as data ---------------------------------------------------------------------

const endedSignatures = (attempts) => attempts.filter((a) => a.ended).map((a) => a.signature ?? null);

// How many completed attempts in a row, counting back from the last, ended on its failure signature: walking back from
// the last, the first signature that differs ends the run; a last attempt with no signature is no run at all.
export function repeatsRef(attempts) {
  const back = endedSignatures(attempts).reverse();
  const ends = back.findIndex((s) => s !== back[0]);
  return back[0] === null || back[0] === undefined ? 0 : ends === -1 ? back.length : ends;
}

const progressExpect = (attempts) => ((n) => (n >= NO_PROGRESS_AT ? { exactly: [`repeats:${n}`, "SAME_FAILURE"] } : { exactly: [`repeats:${n}`] }))(repeatsRef(attempts));

// ---- attempt histories ----------------------------------------------------------------------------------------------

const A = "a1b2c3d4e5f6";
const B = "0f9e8d7c6b5a";
const C = "c0ffee123456";

const done = (signature) => ({ ended: true, signature });
const open = () => ({ ended: false, signature: null });

const history = (group, sigs) => ({ group, input: { call: "progress", attempts: sigs.map((s) => (s === "open" ? open() : done(s))) } });

const HISTORIES = [
  history("repeats", []),
  history("repeats", [A]),
  history("repeats", [A, A]),
  history("repeats", [A, A, A, B]),
  history("repeats", [B, B, A, A]),
  history("no-progress", [A, A, A]),
  history("no-progress", [B, A, A, A]),
  history("no-progress", [A, A, A, A, A]),
  history("no-progress", [A, B, A, A]),
  history("no-progress", [A, A, B, A]),
  history("no-progress", [A, B, A, B, A]),
  history("no-progress", [C, A, C, A, C, A, A]),
  history("run-broken", [A, A, A, null]),
  history("run-broken", [A, null, A, A]),
  history("run-broken", [null, null, null]),
  history("run-broken", [A, A, A, "open"]),
  history("run-broken", [A, A, "open"]),
  history("run-broken", [A, null, A, null, A, "open"]),
].map((c) => ({ ...c, expect: progressExpect(c.input.attempts) }));

// ---- runs of a failure ------------------------------------------------------------------------------------------------

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

const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

const two = (n) => String(n).padStart(2, "0");

const ROOTS = ["/Users/dev/.orbit/projects/repo-1/workspaces/tsk-0123456789ab/tree", "/home/runner/work/orbit/tree", "/tmp/orbit-ws/tsk-ba9876543210/tree", "/srv/agents/seven/workspaces/tree"];

const ELSEWHERE = ["/home/alice/work", "/srv/build/agent", "/var/lib/ci/cache", "/opt/runner/temp"];

const NAMES = ["rejects_amount_over_paid", "accepts_amount_within_paid", "refunds_only_once", "keeps_the_currency", "rounds_half_to_even", "names_the_approver", "blocks_a_closed_period", "logs_the_reason"];

const SUITES = ["RefundTests", "LedgerSpec", "ApprovalSuite", "PeriodChecks"];

const WORDS = [["true", "false"], ["null", "undefined"], ["'open'", "'closed'"], ["empty", "missing"]];

const FILES = ["refund", "ledger", "approval", "period"];

const hexOf = (r, n) => Array.from({ length: n }, () => pick(r, [..."0123456789abcdef"])).join("");

const stampOf = (r) => `2026-${two(int(r, 1, 12))}-${two(int(r, 1, 28))}T${two(int(r, 0, 23))}:${two(int(r, 0, 59))}:${two(int(r, 0, 59))}Z`;

// What changes between two runs of the same failure.
const volatile = (r) => ({ stamp: stampOf(r), ms: int(r, 1, 9999), root: pick(r, ROOTS), hex: hexOf(r, int(r, 8, 16)), abs: pick(r, ELSEWHERE), order: r() });

const failureOf = (r) => ({ suite: pick(r, SUITES), name: pick(r, NAMES), words: pick(r, WORDS), file: pick(r, FILES), line: int(r, 2, 300), passed: int(r, 0, 40), more: [] });

// One run of a failure, as a test runner prints it; the order its lines arrive in is part of what moves.
const linesOf = (f, v) => [`${v.stamp} FAIL ${f.suite}.${f.name} (${v.ms} ms)`, `  Expected: ${f.words[0]}  Received: ${f.words[1]}`, `    at Object.<anonymous> (${v.root}/src/${f.file}.test.js:${f.line}:5)`, `Error: request ${v.hex} failed for ${v.abs}/fixtures/${f.file}.json`, `Error: could not read ${v.root}/src/${f.file}.config.json`, ...f.more.map((m) => `${v.stamp} FAIL ${f.suite}.${m}`), `Tests: ${1 + f.more.length} failed, ${f.passed} passed`];

const shuffled = (lines, order) => ((r) => lines.map((l) => [l, r()]).sort((a, b) => a[1] - b[1]).map(([l]) => l))(mulberry32(Math.floor(order * 4294967296)));

const runOf = (f, v, over = {}) => ({ purpose: "test", command: "rt-command-0000a7e5", lines: shuffled(linesOf(f, v), v.order), status: 1, ...over });

const pairOf = (a, b, va, vb) => ({ call: "signature", a, b, rootA: va.root, rootB: vb.root });

// What makes a second failure a DIFFERENT one: what failed, how it failed, which check, what for, or that it ran out of time.
const DIFFERENCES = [
  { id: "another-test", make: (r, f) => [{ ...f, name: pick(r, NAMES.filter((n) => n !== f.name)) }, {}] },
  { id: "failed-differently", make: (r, f) => [{ ...f, words: pick(r, WORDS.filter((w) => w !== f.words)) }, {}] },
  { id: "one-more-test", make: (r, f) => [{ ...f, more: [pick(r, NAMES.filter((n) => n !== f.name))] }, {}] },
  { id: "another-check", make: (r, f) => [f, { command: "rt-command-0000b8f6" }] },
  { id: "another-purpose", make: (r, f) => [f, { purpose: "build" }] },
  { id: "timed-out", make: (r, f) => [f, { timedOut: true }] },
];

const SAME_SIG = { has: ["SAME", "HEX12"], lacks: ["DIFFERENT"] };
const DIFFERENT_SIG = { has: ["DIFFERENT", "HEX12"], lacks: ["SAME"] };

function samePair(r, group) {
  const f = failureOf(r);
  const [va, vb] = [volatile(r), volatile(r)];
  return { group, input: pairOf(runOf(f, va), runOf(f, vb), va, vb), expect: SAME_SIG };
}

function differentPair(r, group, difference = pick(r, DIFFERENCES)) {
  const f = failureOf(r);
  const [g, over] = difference.make(r, f);
  const [va, vb] = [volatile(r), volatile(r)];
  return { group, input: pairOf(runOf(f, va), runOf(g, vb, over), va, vb), expect: DIFFERENT_SIG };
}

// ---- the exact identity of a run ------------------------------------------------------------------------------------------

const LIBS = ["/usr/lib/node/internal", "/usr/local/lib/node/internal", "/opt/node/lib/internal"];

const exactVolatile = (r) => ({ stamp: `${stampOf(r).slice(0, -1)}.${int(r, 100, 999)}Z`, timing: `${int(r, 1, 999)}.${int(r, 1, 9)}ms`, ms: int(r, 1, 99999), root: pick(r, ROOTS), ansi: r() < 0.5, order: r() });

const exactFailure = (r) => ({ name: pick(r, NAMES), actual: int(r, 0, 500), expected: int(r, 501, 999), file: pick(r, FILES), line: int(r, 2, 300), lib: pick(r, LIBS), tests: int(r, 2, 400) });

const colored = (v, text) => (v.ansi ? `\u001b[31m${text}\u001b[39m` : text);

const exactLines = (f, v) => [`${v.stamp} ${colored(v, "not ok")} 1 - ${f.name} (${v.timing})`, "  ---", `  duration_ms: ${v.ms}`, `  actual: ${f.actual}`, `  expected: ${f.expected}`, `  at ${v.root}/test/${f.file}.test.mjs:${f.line}:7`, `  at ${f.lib}/${f.file}.js:${f.line + 1}:3`, `# tests ${f.tests}`, "# fail 1"];

const exactRun = (f, v, over = {}) => ({ purpose: "test", command: "rt-command-0000a7e5", lines: shuffled(exactLines(f, v), v.order), status: 1, ...over });

const exactPair = (a, b, va, vb) => ({ call: "exact", a, b, rootA: va.root, rootB: vb.root });

// What makes a second run's output a different one, nearly verbatim: a value, a name, a count, a path outside the
// workspace -- or a run whose output was kept only in part.
const EXACT_DIFFERENCES = [
  { id: "another-value", make: (r, f) => [{ ...f, actual: f.actual + int(r, 1, 9) }, {}] },
  { id: "another-name", make: (r, f) => [{ ...f, name: pick(r, NAMES.filter((n) => n !== f.name)) }, {}] },
  { id: "another-count", make: (r, f) => [{ ...f, tests: f.tests + 1 }, {}] },
  { id: "another-path", make: (r, f) => [{ ...f, lib: pick(r, LIBS.filter((l) => l !== f.lib)) }, {}] },
];

const SAME_EXACT = { has: ["SAME"], lacks: ["DIFFERENT", "CUT"] };
const DIFFERENT_EXACT = { has: ["DIFFERENT"], lacks: ["SAME"] };

function exactSame(r, group) {
  const f = exactFailure(r);
  const [va, vb] = [exactVolatile(r), exactVolatile(r)];
  return { group, input: exactPair(exactRun(f, va), exactRun(f, vb), va, vb), expect: SAME_EXACT };
}

function exactDifferent(r, group, difference = pick(r, EXACT_DIFFERENCES)) {
  const f = exactFailure(r);
  const [g] = difference.make(r, f);
  const [va, vb] = [exactVolatile(r), exactVolatile(r)];
  return { group, input: exactPair(exactRun(f, va), exactRun(g, vb), va, vb), expect: DIFFERENT_EXACT };
}

function exactCut(r, group) {
  const f = exactFailure(r);
  const v = exactVolatile(r);
  return { group, input: exactPair(exactRun(f, v, { cut: true }), exactRun(f, v), v, v), expect: { has: ["DIFFERENT", "CUT"], lacks: ["SAME"] } };
}

// ---- the facts of one failure ---------------------------------------------------------------------------------------------

const facts = (over) => ({ purpose: "test", started: true, timedOut: false, changed: true, signature: A, baseline: null, ...over });

const klass = (over, expect) => ({ group: "class-from-facts", input: { call: "classify", facts: facts(over) }, expect });

const NOT_HIGH = "confidence:high";

const CLASSES = [
  klass({ started: false }, { has: ["class:ENVIRONMENT"] }),
  klass({ baseline: { state: "failed", signature: A } }, { has: ["class:ENVIRONMENT"], lacks: [NOT_HIGH] }),
  klass({ purpose: "build", baseline: { state: "succeeded", signature: null } }, { has: ["class:CODE", "confidence:high"] }),
  klass({ baseline: { state: "succeeded", signature: null } }, { has: ["class:TEST", "confidence:high"] }),
  klass({ timedOut: true }, { has: ["class:ENVIRONMENT"], lacks: [NOT_HIGH] }),
  klass({ timedOut: true, baseline: { state: "succeeded", signature: null } }, { has: ["class:TEST", "confidence:high"] }),
  klass({ purpose: "build" }, { has: ["class:CODE"], lacks: [NOT_HIGH] }),
  klass({}, { has: ["class:TEST"], lacks: [NOT_HIGH] }),
  klass({ baseline: { state: "failed", signature: B } }, { has: ["class:TEST"], lacks: [NOT_HIGH] }),
  klass({ changed: false, baseline: { state: "succeeded", signature: null } }, { lacks: ["class:CODE", "class:TEST", NOT_HIGH] }),
  klass({ purpose: "review", unexpected: 2 }, { has: ["class:SCOPE"] }),
  klass({ purpose: "review", missing: 1 }, { has: ["class:CAPABILITY"] }),
];

// ---- seeded attempt histories ------------------------------------------------------------------------------------------------

const SIGS = [A, A, B, C, null];

// A random history, often ending in a run of two to four on one signature: the boundary is where it matters.
const tailOf = (r) => (r() < 0.5 ? ((sig, k) => Array.from({ length: k }, () => done(sig)))(pick(r, [A, B, C]), int(r, 2, 4)) : []);

const seededHistory = (r) => ((attempts) => ({ group: "seeded-progress", input: { call: "progress", attempts }, expect: progressExpect(attempts) }))([...Array.from({ length: int(r, 0, 5) }, () => done(pick(r, SIGS))), ...tailOf(r), ...(r() < 0.25 ? [open()] : [])]);

// ---- all of them, numbered within their group ------------------------------------------------------------------------

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

const times = (n, make) => Array.from({ length: n }, make);

function fixedPairs(r) {
  const signatures = [...times(6, () => samePair(r, "signature-volatile")), ...DIFFERENCES.map((d) => differentPair(r, "signature-different", d))];
  const exacts = [...times(5, () => exactSame(r, "exact-volatile")), ...EXACT_DIFFERENCES.map((d) => exactDifferent(r, "exact-different", d)), exactCut(r, "exact-different")];
  return [...signatures, ...exacts];
}

export function cases(seed, samples) {
  const r = mulberry32(seed);
  const n = Math.max(8, samples);
  return numbered([...HISTORIES, ...CLASSES, ...fixedPairs(mulberry32(7)), ...times(n, () => seededHistory(r)), ...times(n, () => (r() < 0.5 ? samePair(r, "seeded-signature") : differentPair(r, "seeded-signature"))), ...times(Math.max(4, Math.floor(n / 2)), () => (r() < 0.5 ? exactSame(r, "seeded-exact") : exactDifferent(r, "seeded-exact")))]);
}

// ---- the reference model, held to what the contract says in words --------------------------------------------------

const HAND = [
  ["no attempt ended", [], 0],
  ["three in a row on one signature", [A, A, A], 3],
  ["one other signature before three in a row", [B, A, A, A], 3],
  ["three on one signature, not in a row", [A, B, A, A], 2],
  ["the last one differs", [A, A, A, B], 1],
  ["a success last", [A, A, A, null], 0],
  ["a success in between", [A, null, A, A], 2],
  ["two signatures taking turns", [A, B, A, B, A], 1],
];

export const selfTest = () => [...HAND.filter(([, sigs, n]) => repeatsRef(sigs.map(done)) !== n).map(([say]) => `the reference model disagrees with the contract on: ${say}`), ...(repeatsRef([done(A), done(A), open()]) === 2 ? [] : ["the reference model counts an attempt still open"])];
