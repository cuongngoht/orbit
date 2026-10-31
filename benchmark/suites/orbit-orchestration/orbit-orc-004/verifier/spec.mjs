// THE SPEC of ORBIT-ORC-004: a decision the host sends may not ASSERT anything the engine derives -- an outcome, a
// verdict, a stage, a signature, a confidence or an approval -- and one sent anyway is refused BY NAME, never ignored
// (AGENTS.md "An orchestrator decides the next step"; the header of the decision module and the decision vocabulary).
// Written from that contract, never from the code; kept beside the probe and handed to no runner, and it never imports
// the subject.
//
// Every check is a decision and an expectation over the ids the subject reports for it: nothing when the decision is
// well formed; else `REFUSED`, the refusing rule's id (`SHAPE`, `FORBIDDEN`, `FIELDS`, `ACTION`) and `named:<field>` for
// every field of the decision its refusal names. A forbidden field is forbidden whatever it holds, so seeded decisions
// carry them with values true and false, full and empty, zero and null.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to a table written by hand from the contract
export const CASE = "ORBIT-ORC-004";

export const GROUPS = {
  "forbidden": "a decision asserting an outcome, a verdict, a status, a stage, a signature, a class, a confidence or an approval is refused as FORBIDDEN, naming the field",
  "forbidden-falsy": "a forbidden field is refused whatever it holds -- false, null, zero or an empty string -- and never ignored",
  "forbidden-many": "several forbidden fields are refused together, each one named",
  "well-formed": "a well-formed decision for any action kind passes the form, with or without its optional fields",
  "unknown-field": "a field a decision does not carry is refused as FIELDS, naming it, and is never mistaken for a forbidden one",
  "unknown-action": "an action that is not an object whose kind is one of the action kinds is refused as ACTION",
  "shape": "anything but a JSON object with the decision's schemaVersion is refused as SHAPE",
  "never-ignored": "a forbidden field beside another problem still gets the decision refused, and is named",
  "seeded-decision": "random decisions: passed exactly when well formed, refused for the one problem they carry, and every forbidden field named",
};

// The decision protocol as the vocabulary declares it: what a decision carries, and what it may never carry.
export const FIELDS = ["schemaVersion", "expectedRevision", "action", "observed", "hypothesis", "reason", "evidence", "approval"];

export const FORBIDDEN = ["outcome", "verdict", "status", "passed", "succeeded", "success", "done", "completed", "stage", "signature", "failureSignature", "class", "confidence", "approved", "granted", "human", "door"];

// One action of every kind there is, with the fields a step of it takes.
export const KINDS = {
  "check-requirement": {},
  "gather-context": { for: "the refund rules and where they are enforced" },
  "check-environment": {},
  "start-runtime": { component: "c:api" },
  "prepare-sandbox": {},
  "start-sandbox": { component: "c:web" },
  "prepare-workspace": {},
  plan: { intent: "the smallest change the requirement asks for", scope: ["src/refund"] },
  implement: {},
  "record-changes": {},
  check: { command: "rt-command-0000a7e5" },
  diagnose: { then: "fix" },
  "link-investigation": { investigation: "inv-0123456789ab" },
  invoke: { capability: "db.read", input: { id: 7 } },
  review: {},
  commit: { message: "Refunds over thirty days need a manager" },
  push: { remote: "origin", branch: "orbit/tsk-0123456789ab" },
};

const SCHEMA = 1;

// ---- the reference model: the contract, as data ---------------------------------------------------------------------

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

const forbiddenOf = (d) => FORBIDDEN.filter((k) => Object.hasOwn(d, k));

const unknownOf = (d) => Object.keys(d).filter((k) => !FIELDS.includes(k) && !FORBIDDEN.includes(k));

const actionKnown = (d) => isObject(d.action) && typeof d.action.kind === "string" && Object.hasOwn(KINDS, d.action.kind);

// What is wrong with a decision, each problem with the rule that refuses it and the fields that refusal names.
const PROBLEMS = [
  { rule: "SHAPE", has: (d) => !isObject(d) || d.schemaVersion !== SCHEMA, names: () => [] },
  { rule: "FORBIDDEN", has: (d) => forbiddenOf(d).length > 0, names: forbiddenOf },
  { rule: "FIELDS", has: (d) => unknownOf(d).length > 0, names: unknownOf },
  { rule: "ACTION", has: (d) => !actionKnown(d), names: () => [] },
];

export const problemsOf = (d) => (isObject(d) ? PROBLEMS.filter((p) => p.has(d)) : PROBLEMS.slice(0, 1));

const named = (ids) => ids.map((k) => `named:${k}`);

// One problem: refused by its rule, naming its fields. Several: refused, and a forbidden field is named whatever else is
// wrong, so long as the decision has a decision's shape. None: it passes the form.
export function expectOf(d) {
  const problems = problemsOf(d);
  if (problems.length === 0) return { exactly: [] };
  if (problems.length === 1) return { has: ["REFUSED", problems[0].rule, ...named(problems[0].names(d))] };
  return { has: ["REFUSED", ...(problems.some((p) => p.rule === "SHAPE") ? [] : named(forbiddenOf(d)))] };
}

// ---- what the inputs are made of --------------------------------------------------------------------------------------

const decision = (kind = "plan", over = {}) => ({ schemaVersion: SCHEMA, expectedRevision: 12, action: { kind, ...KINDS[kind] }, observed: "the refund rule is enforced in one validator", hypothesis: "a manager approval check belongs there", ...over });

const TRUTHY = ["passed", true, 1, { ok: true }, ["x"], "high"];

const FALSY = [false, null, 0, ""];

const check = (group, d) => ({ group, input: { call: "form", decision: d }, expect: expectOf(d) });

const FIXED = [
  ...FORBIDDEN.map((k, i) => check("forbidden", decision("plan", { [k]: TRUTHY[i % TRUTHY.length] }))),
  ...FORBIDDEN.map((k, i) => check("forbidden-falsy", decision(Object.keys(KINDS)[i % 17], { [k]: FALSY[i % FALSY.length] }))),
  check("forbidden-many", decision("check", { outcome: "passed", stage: "REVIEWING", confidence: 0.9 })),
  check("forbidden-many", decision("review", { verdict: false, approved: null, human: "" })),
  check("forbidden-many", decision("implement", { signature: "a1b2c3d4e5f6", failureSignature: 0, granted: true, door: "control" })),
  ...Object.keys(KINDS).map((kind) => check("well-formed", decision(kind))),
  check("well-formed", decision("check", { reason: "the build passed and the tests are next", evidence: ["act-3", "chk-1"] })),
  check("well-formed", decision("push", { approval: "apr-1", evidence: [] })),
  check("well-formed", decision("diagnose", { expectedRevision: 0, reason: "the same test failed the same way" })),
  ...["chainOfThought", "thinking", "result", "kind", "outcomes", "nextStage"].map((k) => check("unknown-field", decision("plan", { [k]: "x" }))),
  ...["shell", "deploy", "merge", "approve", "constructor", "toString", "__proto__", "", "Plan"].map((kind) => check("unknown-action", decision("plan", { action: { kind, command: "rm -rf /" } }))),
  ...["plan", null, [], {}, { kind: 5 }].map((action) => check("unknown-action", decision("plan", { action }))),
  ...["plan", 42, null, [], true].map((d) => check("shape", d)),
  ...[2, "1", 0, null].map((v) => check("shape", decision("plan", { schemaVersion: v }))),
  check("shape", (({ schemaVersion, ...rest }) => rest)(decision("plan"))),
  check("never-ignored", decision("plan", { outcome: "passed", chainOfThought: "x" })),
  check("never-ignored", decision("plan", { passed: false, action: { kind: "shell" } })),
  check("never-ignored", decision("plan", { confidence: "", notes: "x", action: "plan" })),
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

const UNKNOWN = ["chainOfThought", "result", "notes", "plan", "kind", "score", "nextStep"];

const BAD_ACTIONS = [{ kind: "shell" }, { kind: "constructor" }, "check", null, { kind: "Review" }];

// What a seeded decision may get wrong: each one in about one decision in five, so most carry one problem or none.
const MISTAKES = [
  (r, d) => (r() < 0.35 ? { ...d, [pick(r, FORBIDDEN)]: pick(r, [...TRUTHY, ...FALSY]) } : d),
  (r, d) => (r() < 0.15 ? { ...d, [pick(r, FORBIDDEN)]: pick(r, FALSY) } : d),
  (r, d) => (r() < 0.15 ? { ...d, [pick(r, UNKNOWN)]: "x" } : d),
  (r, d) => (r() < 0.12 ? { ...d, action: pick(r, BAD_ACTIONS) } : d),
  (r, d) => (r() < 0.08 ? { ...d, schemaVersion: pick(r, [2, "1", null]) } : d),
];

const OPTIONAL = [(r, d) => (r() < 0.4 ? { ...d, reason: "what was seen, said once" } : d), (r, d) => (r() < 0.3 ? { ...d, evidence: ["act-1"] } : d)];

const seeded = (r) => check("seeded-decision", [...OPTIONAL, ...MISTAKES].reduce((d, f) => f(r, d), decision(pick(r, Object.keys(KINDS)))));

// ---- all of them, numbered within their group ------------------------------------------------------------------------

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  return numbered([...FIXED, ...Array.from({ length: Math.max(8, samples) }, () => seeded(r))]);
}

// ---- the reference model, held to what the contract says in words --------------------------------------------------

const HAND = [
  ["a well-formed plan", decision("plan"), []],
  ["an outcome asserted", decision("plan", { outcome: "passed" }), ["FORBIDDEN"]],
  ["a stage asserted as an empty string", decision("plan", { stage: "" }), ["FORBIDDEN"]],
  ["an approval asserted as false", decision("plan", { approved: false }), ["FORBIDDEN"]],
  ["a confidence of zero", decision("plan", { confidence: 0 }), ["FORBIDDEN"]],
  ["a signature that is null", decision("plan", { signature: null }), ["FORBIDDEN"]],
  ["a chain of thought", decision("plan", { chainOfThought: "x" }), ["FIELDS"]],
  ["an action nobody knows", decision("plan", { action: { kind: "shell" } }), ["ACTION"]],
  ["an action that is a word", decision("plan", { action: "plan" }), ["ACTION"]],
  ["another schema", decision("plan", { schemaVersion: 2 }), ["SHAPE"]],
  ["not an object", "plan", ["SHAPE"]],
];

export const selfTest = () => [...HAND.filter(([, d, rules]) => JSON.stringify(problemsOf(d).map((p) => p.rule)) !== JSON.stringify(rules)).map(([say]) => `the reference model disagrees with the contract on: ${say}`), ...(Object.keys(KINDS).length === 17 ? [] : ["the action kinds are not the seventeen there are"])];
