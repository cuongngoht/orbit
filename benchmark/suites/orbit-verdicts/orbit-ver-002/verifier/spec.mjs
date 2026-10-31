// THE SPEC of ORBIT-VER-002: what a run that did not pass is evidence OF, written from the engine's "a cause is not a
// verdict" rule and never from the code. Kept beside the probe and handed to no runner; the controller imports a FROZEN
// copy of it, and it never imports the subject. The classifier is an ordered table over facts a caller can DEMONSTRATE,
// first match wins and the last row always matches; `phase` (bind · act · wait), recorded by whoever threw, is what
// tells a locator from a product reaching a state from the data -- so a failure that recorded no phase is never read as
// a browser command that failed. Confidence is two-valued and only `high` hands the next move to a specialist.
//
// Every check expects exactly the cause, the confidence and, only when there is one, the specialist: a classifier that
// hands everything to the map healer fails, and so does one that settles nothing. Seeded facts are drawn the way the
// engine's own triage leaves them, with the run's seed.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to a table written by hand from the contract
export const CASE = "ORBIT-VER-002";

export const GROUPS = {
  "dsl-invalid": "the validator's own findings are DSL_INVALID, high, for orbit-dsl-doctor, and outrank every other fact",
  "auth": "a signed-out session or a wrong identity is AUTH, high, with no specialist, ahead of anything a step shows",
  "environment": "BLOCKED with a stopped step is ENVIRONMENT, high, whatever phase the step recorded",
  "data-bind": "a placeholder that reached a step unfilled (phase bind) is DATA, high",
  "data-before-first-step": "BLOCKED before any step stopped is DATA, low, with no specialist",
  "server-refused": "a failed browser command (phase act) on a step that ruled on nothing, beside a call outside 2xx, is PRODUCT_FAILURE, low -- read before the locator is doubted",
  "map-drift-verified": "a failed browser command on a resolvable locator of a known edge, no call outside 2xx, its record named as drifted, is MAP_DRIFT, high, for orbit-map-healer",
  "map-drift-unverified": "the same without the record named as drifted is MAP_DRIFT, low, with no specialist",
  "not-drivable": "a failed browser command on an edge the map does not know, or a locator never resolved, is never MAP_DRIFT",
  "ruled-fail": "FAIL on a step that ruled on the product is PRODUCT_FAILURE, high, whatever its phase",
  "timing": "a spent wait (phase wait) on a case this machine passed at the same build is TIMING, low",
  "wait-unsettled": "any other spent wait is UNKNOWN, low: never drift, never a product failure",
  "case-logic": "INCONCLUSIVE over the whole case is CASE_LOGIC, high; over a slice it settles nothing",
  "phase-absent": "a failure that recorded no phase is never read as a failed browser command: UNKNOWN, low, unless a row that asks no phase holds",
  "seeded-facts": "seeded facts: exactly the first row of the table that holds, its confidence, and its specialist only when high",
};

const DSL_DOCTOR = "orbit-dsl-doctor";

const MAP_HEALER = "orbit-map-healer";

// ---- the reference model: the ordered table, as the contract words it --------------------------------------------------

const phaseOf = (f) => f.failure?.phase ?? null;

const acted = (f) => phaseOf(f) === "act";

const stopped = (f) => Boolean(f.failure);

const drivable = (f) => f.edgeKnown === true && f.selectorResolved === true;

const refusedByServer = (f) => (f.nonTwoXx?.length ?? 0) > 0;

const actedUnruled = (f) => acted(f) && f.ruled === false;

const TABLE = [
  ["DSL_INVALID", "high", DSL_DOCTOR, (f) => (f.invalid?.length ?? 0) > 0],
  ["AUTH", "high", null, (f) => f.signedOut === true || (f.identityProblem?.length ?? 0) > 0],
  ["ENVIRONMENT", "high", null, (f) => f.status === "BLOCKED" && stopped(f)],
  ["DATA", "high", null, (f) => phaseOf(f) === "bind"],
  ["DATA", "low", null, (f) => f.status === "BLOCKED" && !stopped(f)],
  ["PRODUCT_FAILURE", "low", null, (f) => actedUnruled(f) && refusedByServer(f)],
  ["MAP_DRIFT", "high", MAP_HEALER, (f) => actedUnruled(f) && drivable(f) && !refusedByServer(f) && f.driftedRecord === true],
  ["MAP_DRIFT", "low", null, (f) => actedUnruled(f) && drivable(f) && !refusedByServer(f)],
  ["PRODUCT_FAILURE", "high", null, (f) => f.status === "FAIL" && f.ruled === true],
  ["TIMING", "low", null, (f) => phaseOf(f) === "wait" && f.passedHereAtSameBuild === true],
  ["CASE_LOGIC", "high", null, (f) => f.status === "INCONCLUSIVE" && f.whole === true],
  ["UNKNOWN", "low", null, () => true],
];

// The first row that holds: its cause, its confidence, and its specialist only when it is certain.
export const idsOf = (f) => ((row) => [row[0], row[1], ...(row[1] === "high" && row[2] ? [row[2]] : [])])(TABLE.find((row) => row[3](f)));

// ---- what the facts are made of, as the engine's triage leaves them ----------------------------------------------------

const stop = (over = {}) => ({ kind: "error", phase: "act", message: "the click did not land", step: 4, do: "click", on: "users/Save", selector: "getByRole('button',{name:'Save'})", ...over });

// A failure from a log written before the engine recorded a phase: the key is not there at all.
const unphased = () => Object.fromEntries(Object.entries(stop()).filter(([k]) => k !== "phase"));

const facts = (over = {}) => ({ status: "FAIL", whole: true, failure: stop(), ruled: false, edgeKnown: true, selectorResolved: true, invalid: [], nonTwoXx: [], passedHereAtSameBuild: false, signedOut: null, identityProblem: null, driftedRecord: null, ...over });

const NO_STEP = { failure: null, ruled: null, edgeKnown: null, selectorResolved: null };

const FINDING = "case create-user step 4 (sql): \"query\" belongs on a sql step";

const SERVER = "POST /api/users -> 500";

// ---- the checks written by hand: facts -> cause, confidence, specialist ------------------------------------------------

const HAND = [
  ["dsl-invalid", facts({ status: "REFUSED", ...NO_STEP, invalid: [FINDING] }), ["DSL_INVALID", "high", DSL_DOCTOR]],
  ["dsl-invalid", facts({ invalid: ["case x: unknown verb"], driftedRecord: true, passedHereAtSameBuild: true }), ["DSL_INVALID", "high", DSL_DOCTOR]],
  ["dsl-invalid", facts({ status: "BLOCKED", invalid: [FINDING], signedOut: true }), ["DSL_INVALID", "high", DSL_DOCTOR]],
  ["auth", facts({ status: "REFUSED", ...NO_STEP, signedOut: true }), ["AUTH", "high"]],
  ["auth", facts({ status: "REFUSED", ...NO_STEP, identityProblem: ["missing role(s): App.Admin"] }), ["AUTH", "high"]],
  ["auth", facts({ signedOut: true, driftedRecord: true }), ["AUTH", "high"]],
  ["environment", facts({ status: "BLOCKED", failure: stop({ kind: "blocked", do: "sql", message: "the database could not be reached" }) }), ["ENVIRONMENT", "high"]],
  ["environment", facts({ status: "BLOCKED", failure: stop({ kind: "blocked", phase: null }) }), ["ENVIRONMENT", "high"]],
  ["environment", facts({ status: "BLOCKED", failure: stop({ phase: "bind" }) }), ["ENVIRONMENT", "high"]],
  ["data-bind", facts({ failure: stop({ phase: "bind", message: "${ID} reached the step unfilled" }) }), ["DATA", "high"]],
  ["data-bind", facts({ ruled: true, failure: stop({ phase: "bind", do: "expect" }) }), ["DATA", "high"]],
  ["data-before-first-step", facts({ status: "BLOCKED", ...NO_STEP }), ["DATA", "low"]],
  ["data-before-first-step", facts({ status: "BLOCKED", ...NO_STEP, whole: null, driftedRecord: true }), ["DATA", "low"]],
  ["server-refused", facts({ nonTwoXx: [SERVER] }), ["PRODUCT_FAILURE", "low"]],
  ["server-refused", facts({ nonTwoXx: ["PUT /api/users/7 -> 409"], driftedRecord: true }), ["PRODUCT_FAILURE", "low"]],
  ["server-refused", facts({ nonTwoXx: [SERVER], edgeKnown: false }), ["PRODUCT_FAILURE", "low"]],
  ["map-drift-verified", facts({ driftedRecord: true }), ["MAP_DRIFT", "high", MAP_HEALER]],
  ["map-drift-verified", facts({ status: "REFUSED", driftedRecord: true }), ["MAP_DRIFT", "high", MAP_HEALER]],
  ["map-drift-unverified", facts(), ["MAP_DRIFT", "low"]],
  ["map-drift-unverified", facts({ driftedRecord: false }), ["MAP_DRIFT", "low"]],
  ["map-drift-unverified", facts({ passedHereAtSameBuild: true }), ["MAP_DRIFT", "low"]],
  ["not-drivable", facts({ edgeKnown: false }), ["UNKNOWN", "low"]],
  ["not-drivable", facts({ selectorResolved: false, driftedRecord: true }), ["UNKNOWN", "low"]],
  ["not-drivable", facts({ edgeKnown: null, selectorResolved: null }), ["UNKNOWN", "low"]],
  ["ruled-fail", facts({ ruled: true, failure: stop({ phase: "wait", do: "expect" }) }), ["PRODUCT_FAILURE", "high"]],
  ["ruled-fail", facts({ ruled: true, driftedRecord: true }), ["PRODUCT_FAILURE", "high"]],
  ["ruled-fail", facts({ ruled: true, failure: stop({ phase: null, do: "expect" }) }), ["PRODUCT_FAILURE", "high"]],
  ["timing", facts({ failure: stop({ phase: "wait" }), passedHereAtSameBuild: true }), ["TIMING", "low"]],
  ["timing", facts({ ruled: true, failure: stop({ phase: "wait" }), passedHereAtSameBuild: true }), ["PRODUCT_FAILURE", "high"]],
  ["wait-unsettled", facts({ failure: stop({ phase: "wait" }) }), ["UNKNOWN", "low"]],
  ["wait-unsettled", facts({ failure: stop({ phase: "wait" }), driftedRecord: true }), ["UNKNOWN", "low"]],
  ["wait-unsettled", facts({ failure: stop({ phase: "wait" }), nonTwoXx: [SERVER] }), ["UNKNOWN", "low"]],
  ["case-logic", facts({ status: "INCONCLUSIVE", ...NO_STEP }), ["CASE_LOGIC", "high"]],
  ["case-logic", facts({ status: "INCONCLUSIVE", ...NO_STEP, whole: false }), ["UNKNOWN", "low"]],
  ["case-logic", facts({ status: "INCONCLUSIVE", ...NO_STEP, whole: null }), ["UNKNOWN", "low"]],
  ["phase-absent", facts({ failure: stop({ phase: null }) }), ["UNKNOWN", "low"]],
  ["phase-absent", facts({ failure: stop({ phase: null }), driftedRecord: true }), ["UNKNOWN", "low"]],
  ["phase-absent", facts({ failure: stop({ phase: null }), nonTwoXx: [SERVER] }), ["UNKNOWN", "low"]],
  ["phase-absent", facts({ failure: unphased(), driftedRecord: true }), ["UNKNOWN", "low"]],
  ["phase-absent", facts({ failure: unphased() }), ["UNKNOWN", "low"]],
  ["phase-absent", facts({ status: "REFUSED", failure: unphased(), nonTwoXx: [SERVER], driftedRecord: true }), ["UNKNOWN", "low"]],
  ["phase-absent", facts({ status: "BLOCKED", failure: unphased() }), ["ENVIRONMENT", "high"]],
];

const FIXED = HAND.map(([group, f, ids]) => ({ group, input: { call: "classify", facts: f }, expect: { exactly: ids } }));

// ---- a seeded generator, the same facts for the same seed -----------------------------------------------------------------

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

const PHASES = ["act", "act", "act", "wait", "wait", "bind", "none", "absent"];

const STATUSES = ["FAIL", "FAIL", "FAIL", "REFUSED", "BLOCKED", "INCONCLUSIVE"];

// A step that stopped: with a phase, with a phase recorded as nothing, or from a log that predates the field.
const seededStop = (r) => ((p) => (p === "absent" ? unphased() : stop({ phase: p === "none" ? null : p })))(pick(r, PHASES));

const stepFacts = (r) => ({ failure: seededStop(r), ruled: pick(r, [true, false, false]), edgeKnown: pick(r, [true, true, false, null]), selectorResolved: pick(r, [true, true, false]) });

const seededFacts = (r) => ({ status: pick(r, STATUSES), whole: pick(r, [true, false, null]), ...(r() < 0.2 ? NO_STEP : stepFacts(r)), invalid: r() < 0.08 ? [FINDING] : [], nonTwoXx: r() < 0.2 ? [SERVER] : [], passedHereAtSameBuild: r() < 0.3, signedOut: r() < 0.05 ? true : null, identityProblem: r() < 0.05 ? ["missing role(s): App.Admin"] : null, driftedRecord: r() < 0.4 ? true : null });

const seeded = (r) => ((f) => ({ group: "seeded-facts", input: { call: "classify", facts: f }, expect: { exactly: idsOf(f) } }))(seededFacts(r));

// ---- all of them, numbered within their group ------------------------------------------------------------------------

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  return numbered([...FIXED, ...Array.from({ length: Math.max(24, samples) }, () => seeded(r))]);
}

// ---- the reference model, held to what the contract says in words ------------------------------------------------------

const sameIds = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

export const selfTest = () => [...HAND.filter(([, f, ids]) => !sameIds(idsOf(f), ids)).map(([group, f]) => `the reference model disagrees with the contract on ${group}: ${JSON.stringify(f).slice(0, 160)}`), ...(TABLE.at(-1)[3]({}) ? [] : ["the table's last row does not match everything"])];
