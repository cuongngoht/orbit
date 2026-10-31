// THE SPEC of ORBIT-ORC-002: a task completes only when every COMPLETION row holds, a failure exactly as at its baseline
// is never a pass, and at least one required test or verify command must have PASSED -- written from that contract
// (AGENTS.md "Declared is not required", ADR 0019, the headers of the verification and obligations modules), never
// from their code. Kept beside the probe and handed to no runner; the controller imports a FROZEN copy of it, and it
// never imports the subject.
//
// Every check is a task's world as data -- its view, its journal positions, the declared checks, the component graph --
// in the shape the loop hands the rules, and an expectation over the ids the subject reports: the completion rows that
// do not hold, or `required:<check>:<state>`, `excluded:<check>`, `missing:<what>` and `word:<WORD>` from the plan.
// Seeded worlds give each declared check a random history -- passes, failures as before, regressions, runs still going,
// runs that could not start, runs before the last change and runs on a tree nobody recorded.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to a table written by hand from the contract
export const CASE = "ORBIT-ORC-002";

export const GROUPS = {
  "complete": "a task whose journal shows every completion row holding has nothing unmet",
  "each-row": "each completion row alone can refuse completion, and is then the only one unmet",
  "regression": "a required check that failed otherwise than at its baseline is a regression: never settled, and its row is unmet",
  "as-before": "a required check that failed exactly as at its baseline is settled as failed-as-before, kept visible, and never a pass",
  "verified": "completion needs a required test or verify command that PASSED since the last change: a build, or a failure as before, is not one",
  "since-last-change": "a check run before the code last changed counts for nothing after it: it is owed again",
  "recorded-tree": "a check counts only when it ran on the tree record-changes recorded",
  "running": "a check still running is neither settled nor passed, and an open action keeps a task from completing",
  "not-affected": "a declared check of a component the change does not reach is excluded, and how it ran never matters",
  "missing": "a changed path no component holds, or a changed component nothing declared verifies, is missing and blocks completion",
  "widened": "with no component graph every declared check is required, and the plan says WIDENED",
  "seeded-states": "random check histories: each required check in exactly the state its latest run since the last change gives it",
  "seeded-completion": "random check histories: exactly the completion rows the contract leaves unmet",
};

const ROWS = ["REVIEWING", "NOT_HELD", "NO_OPEN_ACTION", "CHANGED", "BUILD", "TESTS", "VERIFIED", "COVERED", "REVIEWED", "ATTEMPT", "VERIFICATION", "INVESTIGATIONS", "LIVE"];

const NAMED = ["passed", "failed-as-before", "regressed", "running", "owed"];

// ---- the reference model: the contract, as data ---------------------------------------------------------------------

const BUILDING = ["build", "verify"];
const VERIFYING = ["verify", "test"];

// A run counts for a check when it started after the code last changed, on the recorded tree when one was recorded.
const counts = (s, r) => r.at > s.changeAt && (r.result === "running" || !s.recorded || r.tree === s.recorded);

const STATE = { passed: "passed", "as-before": "failed-as-before", regressed: "regressed", running: "running", unstarted: "unstarted" };

const latestOf = (s, id) => s.runs.filter((r) => r.check.id === id && counts(s, r)).sort((a, b) => a.at - b.at).at(-1) ?? null;

export const stateRef = (s, id) => ((r) => (r ? STATE[r.result] : "owed"))(latestOf(s, id));

const settledRef = (state) => ["passed", "failed-as-before"].includes(state);

export const requiredRef = (s) => s.checks.filter((c) => !s.graph || ["c", "d"].includes(c.component));

const ofPurpose = (s, purposes) => requiredRef(s).filter((c) => purposes.includes(c.purpose));

const ROW_REF = {
  NO_OPEN_ACTION: (s) => !s.runs.some((r) => r.result === "running"),
  BUILD: (s) => ofPurpose(s, BUILDING).every((c) => settledRef(stateRef(s, c.id))),
  TESTS: (s) => ofPurpose(s, ["test"]).every((c) => settledRef(stateRef(s, c.id))),
  VERIFIED: (s) => ofPurpose(s, VERIFYING).some((c) => stateRef(s, c.id) === "passed"),
  REVIEWED: (s) => s.review === "succeeded",
};

// The rows a seeded world leaves unmet; every other row is built to hold.
export const unmetRef = (s) => Object.entries(ROW_REF).filter(([, holds]) => !holds(s)).map(([id]) => id);

// ---- what the inputs are made of --------------------------------------------------------------------------------------

const TSK = "tsk-0123456789ab";
const START = "2026-10-07T10:00:00.000Z";
const CHANGE_AT = 10;

const chk = (id, component, purpose) => ({ id, purpose, component, declaredAs: `${purpose}:${id}` });

const comp = (key, dir, dependsOn = []) => ({ key, dir, kind: "library", live: null, dependsOn, inherits: [], unresolved: [] });

// c holds the change; d depends on c; e is infrastructure nothing depends on.
const BUILD = chk("rt-build", "c", "build");
const LINT = chk("rt-lint", "c", "verify");
const UNIT = chk("rt-unit", "c", "test");
const E2E = chk("rt-e2e", "d", "test");
const INFRA = chk("rt-infra", "e", "verify");
const CHECKS = [BUILD, LINT, UNIT, E2E, INFRA];

const GRAPH = { components: [comp("c", "src"), comp("d", "lib", ["c"]), comp("e", "infra")] };

const act = (id, type, state, extra = {}) => ({ id, type, state, mutates: false, startedAt: START, ...extra });

// What a run of each result leaves: the action's state and its receipt's word (a run still going has no receipt yet).
const OUTCOMES = { passed: ["succeeded", "succeeded"], "as-before": ["failed", "failed-as-before"], regressed: ["failed", "failed"], running: ["running", null], unstarted: ["error", "unstarted"] };

const run = (check, result, at, tree = null) => ({ check, result, at, tree });

const actionOf = (r, i) => act(`act-${i + 1}`, r.check.purpose, OUTCOMES[r.result][0], { tool: r.check.id, receipts: OUTCOMES[r.result][1] ? [`check:chk-${i + 1}`] : [] });

const receiptsOf = (r, i) => (OUTCOMES[r.result][1] ? [{ domain: "check", ref: `chk-${i + 1}`, outcome: OUTCOMES[r.result][1], sourceTree: r.tree }] : []);

const lastAt = (s) => Math.max(s.changeAt, ...s.runs.map((r) => r.at)) + 1;

const reviewOf = (s) => (s.review ? [act("act-review", "review", s.review)] : []);

const reviewLine = (s) => (s.review ? [{ kind: "action-started", id: "act-review", n: lastAt(s) }] : []);

const eventsOf = (s) => [...(s.unchanged ? [] : [{ kind: "file-changed", n: s.changeAt }]), ...s.runs.map((r, i) => ({ kind: "action-started", id: `act-${i + 1}`, n: r.at })), ...reviewLine(s)].sort((a, b) => a.n - b.n);

const viewOf = (s) => ({ stage: "REVIEWING", lifecycle: "VERIFYING", terminal: false, blocked: null, actions: [...s.runs.map(actionOf), ...reviewOf(s)], approvals: [], attempts: [{ outcome: "succeeded", endedAt: START }], verification: [{ subject: "rt-build", state: "satisfied" }], receipts: s.runs.flatMap(receiptsOf), changes: { files: s.changes.length, added: 1, removed: 0, paths: s.changes.map((path) => ({ path })) }, attempt: { open: false, current: null }, repeats: 0 });

// A world as the loop hands it to the rules -- as data: the probe turns `graph` and `tree` into the functions it asks.
export const worldOf = (s) => ({ id: TSK, now: START, view: viewOf(s), events: eventsOf(s), checks: s.checks, ...(s.graph ? { graph: s.graph } : {}), ...(s.recorded ? { tree: { live: null, recorded: s.recorded } } : {}) });

const DONE = () => [run(BUILD, "passed", 11), run(LINT, "passed", 12), run(UNIT, "passed", 13), run(E2E, "passed", 14)];

// What a story is made of: the runs, the review, the graph, the declared checks, what changed and where.
const story = (over = {}) => ((s) => ({ ...s, runs: [...s.runs].sort((a, b) => a.at - b.at) }))({ runs: DONE(), review: "succeeded", graph: GRAPH, checks: CHECKS, changes: ["src/a.cs"], changeAt: CHANGE_AT, recorded: null, unchanged: false, ...over });

const replaced = (runs, check, result) => runs.map((r) => (r.check === check ? { ...r, result } : r));

const withResult = (check, result, over = {}) => story({ runs: replaced(DONE(), check, result), ...over });

// ---- the checks -------------------------------------------------------------------------------------------------------

const completion = (group, s, ids, edit = (w) => w) => ({ group, input: { call: "completion", world: edit(worldOf(s)) }, expect: { exactly: ids } });

const planned = (group, s, expect) => ({ group, input: { call: "plan", world: worldOf(s) }, expect });

const viewEdit = (over) => (w) => ({ ...w, view: { ...w.view, ...over } });

// An investigation the task linked looked at a sandbox the workspace has since left.
const staleEvidence = (w) => ({ ...w, view: { ...w.view, receipts: [...w.view.receipts, { domain: "sandbox", ref: "env-1", outcome: "READY", environment: "env-1", sourceTree: "a".repeat(40) }, { domain: "investigation", ref: "inv-1" }] }, investigations: { "inv-1": { ended: true, defects: 0, runtime: { environment: "env-1", task: TSK, sourceTree: "a".repeat(40) } } }, tree: { live: "b".repeat(40), recorded: null } });

const defectFound = (w) => ({ ...w, view: { ...w.view, receipts: [...w.view.receipts, { domain: "investigation", ref: "inv-1" }] }, investigations: { "inv-1": { ended: true, defects: 1 } } });

const openAction = (w) => ({ ...w, view: { ...w.view, actions: [...w.view.actions, act("act-ctx", "gather-context", "running")] }, events: [...w.events, { kind: "action-started", id: "act-ctx", n: 40 }] });

const EACH_ROW = [
  completion("complete", story(), []),
  completion("complete", story({ graph: null, runs: [...DONE(), run(INFRA, "passed", 15)] }), []),
  completion("each-row", story(), ["REVIEWING"], viewEdit({ stage: "TESTING" })),
  completion("each-row", story(), ["NOT_HELD"], viewEdit({ lifecycle: "PAUSED" })),
  completion("each-row", story(), ["NOT_HELD"], viewEdit({ lifecycle: "WAITING_APPROVAL" })),
  completion("each-row", story(), ["NO_OPEN_ACTION"], openAction),
  completion("each-row", story({ unchanged: true }), ["CHANGED"]),
  completion("each-row", withResult(BUILD, "regressed"), ["BUILD"]),
  completion("each-row", withResult(E2E, "regressed"), ["TESTS"]),
  completion("each-row", story({ runs: replaced(replaced(replaced(DONE(), LINT, "as-before"), UNIT, "as-before"), E2E, "as-before") }), ["VERIFIED"]),
  completion("each-row", story({ changes: ["src/a.cs", "docs/notes.md"] }), ["COVERED"]),
  completion("each-row", story({ review: "failed" }), ["REVIEWED"]),
  completion("each-row", story(), ["ATTEMPT"], viewEdit({ attempts: [{ outcome: "failed", endedAt: START }] })),
  completion("each-row", story(), ["VERIFICATION"], viewEdit({ verification: [{ subject: "rt-build", state: "satisfied" }, { subject: "x", state: "violated" }] })),
  completion("each-row", story(), ["INVESTIGATIONS"], defectFound),
  completion("each-row", story(), ["LIVE"], staleEvidence),
];

const state = (id, s) => `required:${id}:${s}`;

const STORIES = [
  planned("regression", withResult(UNIT, "regressed"), { has: [state("rt-unit", "regressed")], lacks: [state("rt-unit", "failed-as-before"), state("rt-unit", "passed")] }),
  completion("regression", withResult(UNIT, "regressed"), ["TESTS"]),
  completion("regression", withResult(LINT, "regressed"), ["BUILD"]),
  completion("regression", story({ runs: [run(BUILD, "passed", 11), run(LINT, "passed", 12), run(UNIT, "regressed", 13), run(E2E, "regressed", 14)] }), ["TESTS"]),
  planned("as-before", withResult(E2E, "as-before"), { has: [state("rt-e2e", "failed-as-before"), state("rt-unit", "passed")], lacks: [state("rt-e2e", "passed"), state("rt-e2e", "regressed")] }),
  completion("as-before", withResult(E2E, "as-before"), []),
  completion("as-before", story({ runs: replaced(replaced(DONE(), UNIT, "as-before"), E2E, "as-before") }), []),
  completion("verified", story({ runs: [run(BUILD, "passed", 11), run(LINT, "as-before", 12), run(UNIT, "as-before", 13), run(E2E, "as-before", 14)] }), ["VERIFIED"]),
  completion("verified", story({ runs: [run(BUILD, "as-before", 11), run(LINT, "as-before", 12), run(UNIT, "as-before", 13), run(E2E, "passed", 14)] }), []),
  completion("verified", story({ runs: [run(BUILD, "passed", 11), run(LINT, "passed", 12), run(UNIT, "as-before", 13), run(E2E, "as-before", 14)] }), []),
  completion("verified", story({ checks: [BUILD, UNIT], runs: [run(BUILD, "passed", 11), run(UNIT, "as-before", 12)] }), ["VERIFIED"]),
  planned("since-last-change", story({ runs: [...DONE().filter((r) => r.check !== E2E), run(E2E, "passed", 5)] }), { has: [state("rt-e2e", "owed")], lacks: [state("rt-e2e", "passed")] }),
  completion("since-last-change", story({ runs: [...DONE().filter((r) => r.check !== E2E), run(E2E, "passed", 5)] }), ["TESTS"]),
  completion("since-last-change", story({ runs: DONE().map((r) => ({ ...r, at: r.at - 10 })) }), ["BUILD", "TESTS", "VERIFIED"]),
  planned("recorded-tree", story({ recorded: "tree-1", runs: DONE().map((r) => ({ ...r, tree: r.check === UNIT ? "tree-0" : "tree-1" })) }), { has: [state("rt-unit", "owed"), state("rt-e2e", "passed")], lacks: [state("rt-unit", "passed")] }),
  completion("recorded-tree", story({ recorded: "tree-1", runs: DONE().map((r) => ({ ...r, tree: r.check === UNIT ? "tree-0" : "tree-1" })) }), ["TESTS"]),
  completion("recorded-tree", story({ recorded: "tree-1", runs: DONE().map((r) => ({ ...r, tree: "tree-1" })) }), []),
  planned("running", withResult(E2E, "running"), { has: [state("rt-e2e", "running")], lacks: [state("rt-e2e", "passed")] }),
  completion("running", withResult(E2E, "running"), ["NO_OPEN_ACTION", "TESTS"]),
  planned("not-affected", story({ runs: [...DONE(), run(INFRA, "regressed", 15)] }), { has: ["excluded:rt-infra", "word:SCOPED"], lacks: [state("rt-infra", "regressed")] }),
  completion("not-affected", story({ runs: [...DONE(), run(INFRA, "regressed", 15)] }), []),
  completion("not-affected", story({ changes: ["lib/b.cs"], runs: [run(E2E, "passed", 11)] }), []),
  planned("missing", story({ changes: ["src/a.cs", "docs/notes.md"] }), { has: ["missing:docs/notes.md", "word:MISSING"], lacks: ["missing:src/a.cs"] }),
  planned("missing", story({ checks: [BUILD, INFRA], graph: { components: [comp("c", "src"), comp("e", "infra")] }, runs: [run(BUILD, "passed", 11)] }), { has: ["missing:c", "word:MISSING"] }),
  completion("missing", story({ checks: [BUILD, INFRA], graph: { components: [comp("c", "src"), comp("e", "infra")] }, runs: [run(BUILD, "passed", 11)] }), ["VERIFIED", "COVERED"]),
  planned("missing", story({ checks: [BUILD, E2E], runs: [run(BUILD, "passed", 11), run(E2E, "passed", 12)] }), { lacks: ["missing:c", "missing:d", "word:MISSING"] }),
  planned("widened", story({ graph: null, runs: [...DONE(), run(INFRA, "passed", 15)] }), { has: ["word:WIDENED", state("rt-infra", "passed"), state("rt-build", "passed")], lacks: ["excluded:rt-infra"] }),
  completion("widened", story({ graph: null, runs: [...DONE(), run(INFRA, "regressed", 15)] }), ["BUILD"]),
];

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

// What a run came to: mostly passes, often enough everything else.
const RESULTS = ["passed", "passed", "passed", "as-before", "as-before", "regressed", "running", "unstarted"];

// Where a run lands: after the last change (at 50), or before it; on the recorded tree, or on another. Every run has a
// position of its own.
const SEEDED_CHANGE = 50;

const placed = (r, check, k) => run(check, pick(r, RESULTS), r() < 0.2 ? 1 + k : SEEDED_CHANGE + 1 + k, r() < 0.15 ? "tree-0" : "tree-1");

const historyOf = (r, check, from) => Array.from({ length: Math.floor(r() * 3) }, (_, i) => placed(r, check, from + i));

const seededRuns = (r) => CHECKS.flatMap((c, n) => historyOf(r, c, n * 3));

const seededStory = (r) => story({ runs: seededRuns(r), review: pick(r, ["succeeded", "succeeded", "succeeded", "failed", null]), graph: r() < 0.75 ? GRAPH : null, recorded: r() < 0.5 ? "tree-1" : null, changeAt: SEEDED_CHANGE });

const stateExpect = (s) => ((rows) => ({ has: [...rows.filter(([, st]) => NAMED.includes(st)).map(([id, st]) => state(id, st)), s.graph ? "word:SCOPED" : "word:WIDENED", ...(s.graph ? ["excluded:rt-infra"] : [])], lacks: rows.flatMap(([id, st]) => NAMED.filter((x) => x !== st).map((x) => state(id, x))) }))(requiredRef(s).map((c) => [c.id, stateRef(s, c.id)]));

const seededPair = (r) => ((s) => [planned("seeded-states", s, stateExpect(s)), completion("seeded-completion", s, unmetRef(s))])(seededStory(r));

// ---- all of them, numbered within their group ------------------------------------------------------------------------

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  return numbered([...EACH_ROW, ...STORIES, ...Array.from({ length: Math.max(8, samples) }, () => seededPair(r)).flat()]);
}

// ---- the reference model, held to what the contract says in words --------------------------------------------------

const HAND = [
  ["everything passed since the change", story(), []],
  ["a test that failed differently from its baseline", withResult(UNIT, "regressed"), ["TESTS"]],
  ["a verify command that failed differently from its baseline", withResult(LINT, "regressed"), ["BUILD"]],
  ["a test that failed exactly as before, with another one passing", withResult(E2E, "as-before"), []],
  ["only a build passed, every test and verify failed as before", story({ runs: [run(BUILD, "passed", 11), run(LINT, "as-before", 12), run(UNIT, "as-before", 13), run(E2E, "as-before", 14)] }), ["VERIFIED"]],
  ["a test that passed only before the last change", story({ runs: [...DONE().filter((r) => r.check !== E2E), run(E2E, "passed", 5)] }), ["TESTS"]],
  ["a test still running", withResult(E2E, "running"), ["NO_OPEN_ACTION", "TESTS"]],
  ["a test that could not start", withResult(E2E, "unstarted"), ["TESTS"]],
  ["a review that failed", story({ review: "failed" }), ["REVIEWED"]],
  ["no review yet", story({ review: null }), ["REVIEWED"]],
  ["a pass on a tree nobody recorded", story({ recorded: "tree-1", runs: DONE().map((r) => ({ ...r, tree: r.check === UNIT ? "tree-0" : "tree-1" })) }), ["TESTS"]],
  ["an excluded check that regressed", story({ runs: [...DONE(), run(INFRA, "regressed", 15)] }), []],
  ["no graph, and the infrastructure check regressed", story({ graph: null, runs: [...DONE(), run(INFRA, "regressed", 15)] }), ["BUILD"]],
];

const sameIds = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

const handFindings = () => HAND.filter(([, s, want]) => !sameIds(unmetRef(s), want)).map(([say]) => `the reference model disagrees with the contract on: ${say}`);

const rowFindings = () => (sameIds(Object.keys(ROW_REF).filter((k) => !ROWS.includes(k)), []) ? [] : ["the reference model names a completion row the contract does not have"]);

export const selfTest = () => [...handFindings(), ...rowFindings()];
