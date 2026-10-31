// THE SPEC of ORBIT-ORC-005: a goal is planned from its STRUCTURED intent, held as it was SENT -- an unknown or
// engine-owned field is refused, never dropped -- its units come from the work kinds alone, one per kind in the
// engine's own order, each waiting for the one before it, and a unit a missing prerequisite blocks is UNRESOLVED and
// never started (AGENTS.md "A goal is planned from its structured intent"; skills/orbit/SKILL.md; the headers of the
// intent and plan-units modules and the goal vocabulary). Written from that contract, never from the code; kept beside
// the probe and handed to no runner, and it never imports the subject.
//
// Every check is an analysis as a host sends it and an expectation over the ids the subject reports: for its findings,
// `UNKNOWN:<field>`, `STAMPED:<field>`, `REQUIRED:<field>`, `INVALID:<field>`, `SECRET` and `SHAPE` (an intent's own
// fields as `intent.<field>`); for its plan, `unit:<kind>:<state>`, `after:<kind>:<kind before>`, `cap:<kind>:<word>`
// and, once the units named done are completed, `frontier:<kind>` for what may start next.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to a table written by hand from the contract
export const CASE = "ORBIT-ORC-005";

export const GROUPS = {
  "accepted": "a reading every field of which is what it should be has no finding",
  "unknown-analysis-field": "a field an analysis does not carry is refused by name, and one the engine stamps is the engine's to say",
  "unknown-intent-field": "a field an intent does not carry is refused by name, never dropped -- an engine-owned one too",
  "required": "an analysis with no intent, or an intent with no category or no work kinds, is refused for what it lacks",
  "invalid": "a category, work kinds, capabilities, sentences or missing prerequisites that are not what they should be are each refused",
  "all-at-once": "every problem of a reading is reported at once",
  "shape": "an analysis that is not a JSON object is refused as such",
  "units-from-kinds": "one unit per work kind, in the engine's own order whatever order they were sent in, each waiting for the one before it",
  "capabilities": "a procedure carries the capabilities the reading names, and a capability another kind takes goes to that kind",
  "unresolved": "a unit of a kind a missing prerequisite blocks -- wherever the kind stands among those it blocks -- is unresolved",
  "never-started": "an unresolved unit is never what may start next, and nothing waiting for it starts either",
  "seeded-findings": "random readings with random mistakes: exactly the findings the contract derives",
  "seeded-units": "random readings: exactly the units, their order, their states, their capabilities and what may start next",
};

// The vocabulary of a reading, as the goal's tables declare it.
const ANALYSIS_FIELDS = ["objective", "intent", "requirements", "acceptance", "unknowns", "conflicts"];
const STAMPED = ["id", "digest", "state", "revision", "schema", "at"];
const INTENT_FIELDS = ["category", "workKinds", "capabilities", "verification", "dependencies", "missing"];
const CATEGORIES = ["change", "quality", "investigation", "procedure", "question"];
export const KINDS = ["analyze", "change", "investigate", "procedure", "verify"];
const LIMITS = { workKinds: 5, capabilities: 8, verification: 8, dependencies: 8, missing: 8 };
const CAPABILITY = /^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9-]*)+$/;
const TEXT_LIMIT = 240;

// A kind that takes the capabilities a reading names (and is unresolved without one), and the capabilities another
// kind takes by name.
const NAMING_KIND = "procedure";
const KIND_OF_CAPABILITY = { "architecture.reverse": "analyze" };

// ---- the reference model: the contract, as data ---------------------------------------------------------------------

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

const isText = (v) => typeof v === "string" && v.trim().length > 0 && v.length <= TEXT_LIMIT;

const isCapability = (v) => typeof v === "string" && CAPABILITY.test(v);

const listOk = (v, key, ok) => v === undefined || (Array.isArray(v) && v.length <= LIMITS[key] && v.every(ok));

const kindsOk = (v) => v === undefined || (Array.isArray(v) && v.length > 0 && listOk(v, "workKinds", (k) => KINDS.includes(k)) && new Set(v).size === v.length);

const blocksOk = (b) => b === undefined || listOk(b, "workKinds", (k) => KINDS.includes(k));

const missingRowOk = (m) => isObject(m) && Object.keys(m).every((k) => ["statement", "blocks"].includes(k)) && isText(m.statement) && blocksOk(m.blocks);

// Only the plainest shape of a secret is ever sent here: a password set in a sentence.
const looksSecret = (t) => /password=/i.test(String(t));

const textsOf = (i) => [...(Array.isArray(i.verification) ? i.verification : []), ...(Array.isArray(i.dependencies) ? i.dependencies : []), ...(Array.isArray(i.missing) ? i.missing.map((m) => m?.statement) : [])];

const INTENT_RULES = [
  (i) => Object.keys(i).filter((k) => !INTENT_FIELDS.includes(k)).map((k) => `UNKNOWN:intent.${k}`),
  (i) => ["category", "workKinds"].filter((k) => i[k] === undefined).map((k) => `REQUIRED:intent.${k}`),
  (i) => (i.category === undefined || CATEGORIES.includes(i.category) ? [] : ["INVALID:intent.category"]),
  (i) => (kindsOk(i.workKinds) ? [] : ["INVALID:intent.workKinds"]),
  (i) => (listOk(i.capabilities, "capabilities", isCapability) ? [] : ["INVALID:intent.capabilities"]),
  (i) => ["verification", "dependencies"].filter((k) => !listOk(i[k], k, isText)).map((k) => `INVALID:intent.${k}`),
  (i) => (listOk(i.missing, "missing", missingRowOk) ? [] : ["INVALID:intent.missing"]),
  (i) => (textsOf(i).some(looksSecret) ? ["SECRET"] : []),
];

const analysisIds = (raw) => [...Object.keys(raw).filter((k) => !ANALYSIS_FIELDS.includes(k) && !STAMPED.includes(k)).map((k) => `UNKNOWN:${k}`), ...STAMPED.filter((k) => Object.hasOwn(raw, k)).map((k) => `STAMPED:${k}`)];

// Every finding a reading earns, as the ids the probe answers with.
export const findingsRef = (raw) => (isObject(raw) ? [...analysisIds(raw), ...(isObject(raw.intent) ? INTENT_RULES.flatMap((rule) => rule(raw.intent)) : ["REQUIRED:intent"])] : ["SHAPE"]);

const capsOf = (intent, kind) => [...new Set(intent.capabilities ?? [])].filter((c) => (KIND_OF_CAPABILITY[c] ?? (kind === NAMING_KIND ? NAMING_KIND : null)) === kind);

const blocked = (intent, kind) => (intent.missing ?? []).some((m) => (m.blocks ?? []).includes(kind));

const unresolvedRef = (intent, kind) => blocked(intent, kind) || (kind === NAMING_KIND && capsOf(intent, kind).length === 0);

// The units a reading plans, in the engine's order, each with its state, what it waits for and what it carries.
export const unitsRef = (intent) => ((kinds) => kinds.map((kind, i) => ({ kind, state: unresolvedRef(intent, kind) ? "unresolved" : i ? "planned" : "ready", after: i ? kinds[i - 1] : null, caps: capsOf(intent, kind) })))(KINDS.filter((k) => intent.workKinds.includes(k)));

// What may start next once the first `done` units completed: the next unit, unless it is unresolved.
const frontierRef = (units, done) => ((next) => (next && next.state !== "unresolved" ? [next.kind] : []))(units[done]);

const unitIds = (u) => [`unit:${u.kind}:${u.state}`, ...(u.after ? [`after:${u.kind}:${u.after}`] : []), ...u.caps.map((c) => `cap:${u.kind}:${c}`)];

export const planRef = (intent, done) => ((units) => [...units.flatMap(unitIds), ...frontierRef(units, done).map((k) => `frontier:${k}`)])(unitsRef(intent));

// ---- what the inputs are made of --------------------------------------------------------------------------------------

const DIGEST = "c".repeat(64);

const READING = { category: "procedure", workKinds: ["procedure", "verify"], capabilities: ["release.quality.verification"], verification: ["every declared quality check ran and each one is reported"], dependencies: [], missing: [] };

const analysis = (intent = READING, over = {}) => ({ objective: "Create a pre-release quality verification workflow.", intent, requirements: [{ statement: "The workflow runs every declared quality check", sourceRef: `spec@${DIGEST}#L1` }], acceptance: [{ statement: "Every check has a recorded result", sourceRef: `spec@${DIGEST}#L2` }], unknowns: [], conflicts: [], ...over });

const reading = (over) => ({ ...READING, ...over });

const finding = (group, raw) => ({ group, input: { call: "findings", analysis: raw }, expect: { exactly: findingsRef(raw) } });

const FINDINGS = [
  finding("accepted", analysis()),
  finding("accepted", analysis({ category: "change", workKinds: ["change"] })),
  finding("accepted", analysis(reading({ category: "quality", workKinds: ["verify", "analyze", "change"], capabilities: ["architecture.reverse", "db.read"], dependencies: ["the staging database is reachable"], missing: [{ statement: "which environment the release is checked in", blocks: ["verify"] }] }))),
  finding("accepted", { objective: "Fix the double payment.", intent: { category: "change", workKinds: ["change", "verify"] } }),
  ...["confidence", "verdict", "plan", "units", "notes"].map((k) => finding("unknown-analysis-field", analysis(READING, { [k]: "x" }))),
  ...STAMPED.map((k) => finding("unknown-analysis-field", analysis(READING, { [k]: "x" }))),
  ...["verdict", "confidence", "priority", "owner", "notes", "plan", "units", "title"].map((k) => finding("unknown-intent-field", analysis(reading({ [k]: "x" })))),
  ...["id", "state", "digest", "revision", "at"].map((k) => finding("unknown-intent-field", analysis(reading({ [k]: "x" })))),
  finding("unknown-intent-field", analysis(reading({ verdict: false, confidence: 0 }))),
  finding("required", analysis(null)),
  finding("required", (({ intent, ...rest }) => rest)(analysis())),
  finding("required", analysis("change")),
  finding("required", analysis((({ category, ...rest }) => rest)(READING))),
  finding("required", analysis((({ workKinds, ...rest }) => rest)(READING))),
  ...[[], ["verify", "verify"], ["deploy"], "change", ["change", "verify", "analyze", "investigate", "procedure", "change"]].map((workKinds) => finding("invalid", analysis(reading({ workKinds })))),
  ...["anything", "Change", ""].map((category) => finding("invalid", analysis(reading({ category })))),
  ...[["Release Checks"], ["release"], ["release.Quality"], "release.quality", Array.from({ length: 9 }, (_, i) => `cap.n${i}`)].map((capabilities) => finding("invalid", analysis(reading({ capabilities })))),
  ...[[""], ["   "], ["x".repeat(241)], "a sentence", [42]].map((verification) => finding("invalid", analysis(reading({ verification })))),
  ...[[""], "a sentence"].map((dependencies) => finding("invalid", analysis(reading({ dependencies })))),
  ...[[{ statement: "x", blocks: ["nothing"] }], [{ statement: "", blocks: ["verify"] }], [{ statement: "x", blocks: ["verify"], because: "y" }], ["just a sentence"], [{ statement: "x", blocks: "verify" }]].map((missing) => finding("invalid", analysis(reading({ missing })))),
  finding("invalid", analysis(reading({ dependencies: ["password=hunter2hunter2"] }))),
  finding("all-at-once", analysis(reading({ category: "anything", verdict: "pass", capabilities: ["Release Checks"] }), { confidence: "high", digest: "x" })),
  finding("all-at-once", analysis({ workKinds: [], owner: "me", missing: [{ statement: "x", blocks: ["nothing"] }] })),
  ...["x", null, [], 7].map((raw) => finding("shape", raw)),
];

// `done`: how many of the plan's first units completed -- handed to the probe as their kinds.
const units = (group, intent, done = 0) => ({ group, input: { call: "units", analysis: analysis(intent), digest: DIGEST, done: unitsRef(intent).slice(0, done).map((u) => u.kind) }, expect: { exactly: planRef(intent, done) } });

const UNITS = [
  units("units-from-kinds", READING),
  units("units-from-kinds", reading({ category: "change", workKinds: ["verify", "change", "analyze"], capabilities: [] })),
  units("units-from-kinds", reading({ category: "change", workKinds: ["verify", "change", "analyze"], capabilities: [] }), 1),
  units("units-from-kinds", reading({ category: "investigation", workKinds: ["verify", "procedure", "investigate", "change", "analyze"] }), 3),
  units("units-from-kinds", reading({ category: "question", workKinds: ["analyze"], capabilities: [] }), 1),
  units("capabilities", reading({ capabilities: ["release.quality.verification", "architecture.reverse"], workKinds: ["analyze", "procedure", "verify"] })),
  units("capabilities", reading({ capabilities: ["architecture.reverse"], workKinds: ["analyze", "procedure"] })),
  units("capabilities", reading({ capabilities: [], workKinds: ["procedure", "verify"] })),
  units("unresolved", reading({ missing: [{ statement: "which environment the release is checked in", blocks: ["verify"] }] })),
  units("unresolved", reading({ category: "change", workKinds: ["change", "investigate", "verify"], capabilities: [], missing: [{ statement: "which tenant is affected", blocks: ["change", "investigate"] }] })),
  units("unresolved", reading({ category: "change", workKinds: ["change", "verify"], capabilities: [], missing: [{ statement: "the acceptance environment", blocks: ["analyze", "verify"] }] })),
  units("unresolved", reading({ category: "change", workKinds: ["change", "verify"], capabilities: [], missing: [{ statement: "the rollout date", blocks: ["investigate", "procedure", "verify"] }] }), 1),
  units("unresolved", reading({ category: "change", workKinds: ["change", "verify"], capabilities: [], missing: [{ statement: "nothing it stops", blocks: [] }, { statement: "a kind not planned", blocks: ["investigate"] }] }), 1),
  units("never-started", reading({ missing: [{ statement: "which environment the release is checked in", blocks: ["verify"] }] }), 1),
  units("never-started", reading({ category: "change", workKinds: ["change", "verify"], capabilities: [], missing: [{ statement: "who signs it off", blocks: ["procedure", "change"] }] })),
  units("never-started", reading({ category: "change", workKinds: ["analyze", "change", "verify"], capabilities: [], missing: [{ statement: "the second system", blocks: ["verify", "change"] }] }), 1),
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

const some = (r, list, p) => list.filter(() => r() < p);

const shuffled = (r, list) => list.map((x) => [x, r()]).sort((a, b) => a[1] - b[1]).map(([x]) => x);

const CAPS = ["release.quality.verification", "architecture.reverse", "db.read", "billing.invoice-export", "queue.inspect"];

const SENTENCES = ["every declared check ran and each one is reported", "the refund is visible to the manager", "the staging database is reachable", "which environment the release is checked in", "who signs the release off"];

const missingRow = (r) => ({ statement: pick(r, SENTENCES), blocks: shuffled(r, some(r, KINDS, 0.35)) });

function seededReading(r) {
  const kinds = some(r, KINDS, 0.5);
  return { category: pick(r, CATEGORIES), workKinds: shuffled(r, kinds.length ? kinds : [pick(r, KINDS)]), capabilities: some(r, CAPS, 0.3), verification: some(r, SENTENCES, 0.2), dependencies: some(r, SENTENCES, 0.15), missing: Array.from({ length: Math.floor(r() * 3) }, () => missingRow(r)) };
}

// The mistakes a host can send, each in about one reading in five.
const MISTAKES = [
  (r, a) => (r() < 0.25 ? { ...a, intent: { ...a.intent, [pick(r, ["verdict", "confidence", "state", "priority", "id"])]: pick(r, ["x", false, 0, null]) } } : a),
  (r, a) => (r() < 0.12 ? { ...a, [pick(r, ["confidence", "units", ...STAMPED])]: "x" } : a),
  (r, a) => (r() < 0.1 ? { ...a, intent: { ...a.intent, category: pick(r, ["anything", "Quality"]) } } : a),
  (r, a) => (r() < 0.1 ? { ...a, intent: { ...a.intent, workKinds: pick(r, [[], ["verify", "verify"], ["deploy"]]) } } : a),
  (r, a) => (r() < 0.08 ? { ...a, intent: { ...a.intent, capabilities: ["Not A Word"] } } : a),
];

const seededFinding = (r) => finding("seeded-findings", MISTAKES.reduce((a, f) => f(r, a), analysis(seededReading(r))));

const firstOpen = (plan) => ((i) => (i === -1 ? plan.length : i))(plan.findIndex((u) => u.state === "unresolved"));

const seededUnits = (r) => ((intent) => units("seeded-units", intent, Math.floor(r() * (firstOpen(unitsRef(intent)) + 1))))(seededReading(r));

// ---- all of them, numbered within their group ------------------------------------------------------------------------

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  const n = Math.max(8, samples);
  return numbered([...FINDINGS, ...UNITS, ...Array.from({ length: n }, () => seededFinding(r)), ...Array.from({ length: n }, () => seededUnits(r))]);
}

// ---- the reference model, held to what the contract says in words --------------------------------------------------

const HAND_FINDINGS = [
  ["a whole, well-formed reading", analysis(), []],
  ["an analysis that asserts its confidence", analysis(READING, { confidence: "high" }), ["UNKNOWN:confidence"]],
  ["an analysis that stamps its digest", analysis(READING, { digest: "x" }), ["STAMPED:digest"]],
  ["an intent that carries a verdict", analysis(reading({ verdict: "pass" })), ["UNKNOWN:intent.verdict"]],
  ["an intent that carries a state", analysis(reading({ state: "ready" })), ["UNKNOWN:intent.state"]],
  ["no intent", analysis(null), ["REQUIRED:intent"]],
  ["no work kinds at all", analysis(reading({ workKinds: [] })), ["INVALID:intent.workKinds"]],
  ["a prerequisite that blocks a kind there is not", analysis(reading({ missing: [{ statement: "x", blocks: ["nothing"] }] })), ["INVALID:intent.missing"]],
  ["a password in a dependency", analysis(reading({ dependencies: ["password=hunter2hunter2"] })), ["SECRET"]],
];

const HAND_UNITS = [
  ["a procedure and a check of it", READING, 0, ["unit:procedure:ready", "unit:verify:planned", "after:verify:procedure", "cap:procedure:release.quality.verification", "frontier:procedure"]],
  ["kinds sent out of order", { workKinds: ["verify", "analyze"], capabilities: [], missing: [] }, 1, ["unit:analyze:ready", "unit:verify:planned", "after:verify:analyze", "frontier:verify"]],
  ["a check nobody can run yet", { workKinds: ["procedure", "verify"], capabilities: ["release.quality.verification"], missing: [{ statement: "x", blocks: ["analyze", "verify"] }] }, 1, ["unit:procedure:ready", "unit:verify:unresolved", "after:verify:procedure", "cap:procedure:release.quality.verification"]],
  ["a procedure that names no capability", { workKinds: ["procedure"], capabilities: [], missing: [] }, 0, ["unit:procedure:unresolved"]],
  ["a reverse-engineering pass asked by its word", { workKinds: ["analyze", "procedure"], capabilities: ["architecture.reverse", "db.read"], missing: [] }, 0, ["unit:analyze:ready", "unit:procedure:planned", "after:procedure:analyze", "cap:analyze:architecture.reverse", "cap:procedure:db.read", "frontier:analyze"]],
];

const sameIds = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

const handFindings = () => HAND_FINDINGS.filter(([, raw, want]) => !sameIds(findingsRef(raw), want)).map(([say]) => `the reference model disagrees with the contract on: ${say}`);

const handUnits = () => HAND_UNITS.filter(([, intent, done, want]) => !sameIds(planRef(intent, done), want)).map(([say]) => `the reference model disagrees with the contract on: ${say}`);

export const selfTest = () => [...handFindings(), ...handUnits()];
