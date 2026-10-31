// THE SPEC of ORBIT-SRC-001: what the oracle must answer, written from its contract and never from its code. Kept
// beside the probe and handed to no runner; the controller imports a FROZEN copy of it, and it never imports the
// subject. Every check is an input and an expectation over the ids the subject reports: `has` (must be among them),
// `lacks` (must not be), `exactly` (the whole set). Both directions are checked -- what must be refused and what must
// be accepted -- so an oracle that refuses everything fails as surely as one that refuses nothing.
//
// Thresholds come from a seeded generator (the seed is the run's, recorded in its manifest) and from fixed boundary
// pairs: negative, zero, decimal, and as large as a double keeps exact. Every value is a finite number, the only kind
// a declared workflow may compare a bound with.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to a table written by hand from the contract
export const CASE = "ORBIT-SRC-001";

export const GROUPS = {
  "lower-bound-dropped": "a lower bound (gte, gt) whose value drops is a weakening, reported as RULE_LOOSENED",
  "lower-bound-raised": "a lower bound (gte, gt) whose value rises is no weakening: nothing is reported",
  "upper-bound-raised": "an upper bound (lte, lt) whose value rises is a weakening, reported as RULE_LOOSENED",
  "upper-bound-dropped": "an upper bound (lte, lt) whose value drops is no weakening: nothing is reported",
  "bound-unchanged": "a bound whose value stays is no weakening: nothing is reported",
  "required-step-dropped": "a required step that is gone, or no longer required, is reported as REQUIRED_DROPPED",
  "optional-step-kept": "an optional step that stays, or becomes required, is no weakening: nothing is reported",
  "owner-evidence-weakened": "a step proven by an owner's record that settles for a report is reported as EVIDENCE_WEAKENED",
  "evidence-strengthened": "a step that starts needing an owner's record is no weakening: nothing is reported",
  "approval-dropped": "a step that waited for a person and no longer does is reported as APPROVAL_DROPPED",
  "approval-added": "a step that starts waiting for a person is no weakening: nothing is reported",
  "rule-removed": "a success rule that is gone is reported as RULE_REMOVED",
  "output-retyped": "a ruled output whose type changed is reported as OUTPUT_RETYPED",
  "output-moved": "a change to only where an output is read is no weakening: nothing is reported",
  "role-criterion-removed": "a role's completion criterion that is gone is reported as CRITERION_REMOVED",
  "role-restriction-removed": "a role's restriction that is gone is reported as RESTRICTION_REMOVED",
  "role-contract-changed": "a role's output contract that changed is reported as CONTRACT_CHANGED",
  "role-kept": "a role that only gains criteria and restrictions is no weakening: nothing is reported",
  "kinds-differ": "two definitions of different kinds cannot be compared: ORACLE_UNREADABLE",
  "mixed-workflow": "a workflow whose steps change in several ways at once reports exactly the weakenings among them",
  "safety-playbook": "safetyOf refuses a playbook candidate with CAND_ORACLE_WEAKENED exactly when its oracle is weakened",
  "safety-role": "safetyOf refuses a role candidate with CAND_ORACLE_WEAKENED exactly when its oracle is weakened",
};

const LOWER = ["gte", "gt"];
const UPPER = ["lte", "lt"];

// ---- the reference model: the contract, as data -------------------------------------------------------------------

const weakenedBound = (op, a, b) => (LOWER.includes(op) ? b < a : UPPER.includes(op) ? b > a : false);

const ruleIds = (p, c) => (p.success ?? []).map((r) => ((cr) => (!cr ? "RULE_REMOVED" : weakenedBound(r.op, r.value, cr.value) ? "RULE_LOOSENED" : null))((c.success ?? []).find((x) => x.output === r.output && x.op === r.op)));

const ruledTypes = (s) => Object.fromEntries((s.success ?? []).map((r) => [r.output, s.outputs?.[r.output]?.type ?? null]));

const retypedIds = (p, c) => Object.entries(ruledTypes(p)).filter(([name, type]) => c.outputs?.[name] !== undefined && c.outputs[name].type !== type).map(() => "OUTPUT_RETYPED");

const DIMENSIONS = [
  (p, c) => (p.required !== false && c.required === false ? ["REQUIRED_DROPPED"] : []),
  (p, c) => (p.evidence === "owner-record" && c.evidence !== "owner-record" ? ["EVIDENCE_WEAKENED"] : []),
  (p, c) => (p.approval === "owner" && c.approval !== "owner" ? ["APPROVAL_DROPPED"] : []),
  (p, c) => ruleIds(p, c).filter(Boolean),
  retypedIds,
];

// What a KEPT step owes, by the contract. (A step that is gone is checked by its own groups, never by this model.)
export const keptStepIds = (p, c) => [...new Set(DIMENSIONS.flatMap((d) => d(p, c)))].sort();

// ---- what the inputs are made of ----------------------------------------------------------------------------------

const scored = (op, value, extra = {}) => ({ id: "score-gate", capability: "score.read", required: true, evidence: "report", approval: "none", outputs: { score: { type: "number", path: "score" } }, success: [{ output: "score", op, value }], ...extra });

const notes = () => ({ id: "notes", capability: "notes.read", required: true, evidence: "report", approval: "none", outputs: { hits: { type: "count", path: "hits" } }, success: [{ output: "hits", op: "gte", value: 1 }] });

const proven = (extra = {}) => ({ id: "evidence", capability: "evidence.read", required: true, evidence: "owner-record", approval: "none", outputs: { record: { type: "record", path: "record" } }, success: [{ output: "record", op: "present" }], ...extra });

const wf = (...steps) => ({ api: "orbit.skill-workflow/v1", steps });

const ROLE = { requestedPermissionProfile: "READ_ONLY", completionCriteria: ["Every finding names the file that shows it.", "The report says what is still unknown."], restrictions: ["Never edits a file.", "Never runs a command."], outputContract: { shape: "report", fields: ["findings", "unknowns"] } };

const role = (over = {}) => ({ ...ROLE, ...over });

const pair = (kind, parent, candidate) => ({ call: "weakenings", kind, parent, candidate });

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

const NUMBERS = [
  (r) => Math.round(r() * 2000 - 1000),
  (r) => Number((r() * 200 - 100).toFixed(1 + Math.floor(r() * 6))),
  (r) => Math.round((r() * 2 - 1) * 1e14),
  (r) => Number(((r() * 2 - 1) * 1e-3).toPrecision(6)),
  () => 0,
];

const DELTAS = [1e-9, 1e-6, 0.001, 0.5, 1, 7, 1000, 1e9];

// A pair as JSON carries it (-0 is 0 there), kept only when the higher is strictly higher.
const asCarried = (pairOf) => JSON.parse(JSON.stringify(pairOf));

const randomPair = (r) => ((low) => asCarried([low, low + pick(r, DELTAS)]))(pick(r, NUMBERS)(r));

// Boundaries: around zero, around one, a sum that is not what it looks like, the largest integers a double keeps exact.
export const FIXED_PAIRS = [[-1e-9, 0], [0, 1e-9], [0.999999, 1], [-1.000001, -1], [0.3, 0.1 + 0.2], [1e15 - 1, 1e15], [Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER], [-Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER + 1], [-0.5, 0.5], [0, 100], [-1e12 - 0.5, -1e12]];

export const pairsOf = (r, n) => [...FIXED_PAIRS, ...Array.from({ length: n * 4 }, () => randomPair(r))].filter(([low, high]) => high > low).slice(0, FIXED_PAIRS.length + n);

// ---- the checks -----------------------------------------------------------------------------------------------------

const bound = (group, ops, from, to, expect) => (p, i) => ({ group, input: pair("workflow", wf(scored(ops[i % 2], p[from]), notes()), wf(scored(ops[i % 2], p[to]), notes())), expect });

const LOOSENED = { has: ["RULE_LOOSENED"] };
const NOTHING = { exactly: [] };

const BOUNDS = [bound("lower-bound-dropped", LOWER, 1, 0, LOOSENED), bound("lower-bound-raised", LOWER, 0, 1, NOTHING), bound("upper-bound-raised", UPPER, 0, 1, LOOSENED), bound("upper-bound-dropped", UPPER, 1, 0, NOTHING)];

const unchanged = (p, i) => ({ group: "bound-unchanged", input: pair("workflow", wf(scored([...LOWER, ...UPPER][i % 4], p[i % 2]), notes()), wf(scored([...LOWER, ...UPPER][i % 4], p[i % 2]), notes())), expect: NOTHING });

const STRUCTURE = [
  { group: "required-step-dropped", input: pair("workflow", wf(scored("gte", 1), notes()), wf(notes())), expect: { has: ["REQUIRED_DROPPED"] } },
  { group: "required-step-dropped", input: pair("workflow", wf(scored("gte", 1), notes()), wf(scored("gte", 1, { required: false }), notes())), expect: { has: ["REQUIRED_DROPPED"] } },
  { group: "optional-step-kept", input: pair("workflow", wf(scored("gte", 1, { required: false }), notes()), wf(scored("gte", 1), notes())), expect: NOTHING },
  { group: "optional-step-kept", input: pair("workflow", wf(scored("gte", 1, { required: false }), notes()), wf(scored("gte", 1, { required: false }), notes())), expect: NOTHING },
  { group: "owner-evidence-weakened", input: pair("workflow", wf(proven(), notes()), wf(proven({ evidence: "report" }), notes())), expect: { has: ["EVIDENCE_WEAKENED"] } },
  { group: "evidence-strengthened", input: pair("workflow", wf(proven({ evidence: "report" }), notes()), wf(proven(), notes())), expect: NOTHING },
  { group: "approval-dropped", input: pair("workflow", wf(scored("gte", 1, { approval: "owner" }), notes()), wf(scored("gte", 1), notes())), expect: { has: ["APPROVAL_DROPPED"] } },
  { group: "approval-added", input: pair("workflow", wf(scored("gte", 1), notes()), wf(scored("gte", 1, { approval: "owner" }), notes())), expect: NOTHING },
  { group: "rule-removed", input: pair("workflow", wf(scored("gte", 1), notes()), wf(scored("gte", 1, { success: [] }), notes())), expect: { has: ["RULE_REMOVED"] } },
  { group: "output-retyped", input: pair("workflow", wf(scored("gte", 1), notes()), wf(scored("gte", 1, { outputs: { score: { type: "string", path: "score" } } }), notes())), expect: { has: ["OUTPUT_RETYPED"] } },
  { group: "output-moved", input: pair("workflow", wf(scored("gte", 1), notes()), wf(scored("gte", 1, { outputs: { score: { type: "number", path: "result.score" } } }), notes())), expect: NOTHING },
  { group: "role-criterion-removed", input: pair("role", role(), role({ completionCriteria: ROLE.completionCriteria.slice(1) })), expect: { has: ["CRITERION_REMOVED"] } },
  { group: "role-restriction-removed", input: pair("role", role(), role({ restrictions: ROLE.restrictions.slice(0, 1) })), expect: { has: ["RESTRICTION_REMOVED"] } },
  { group: "role-contract-changed", input: pair("role", role(), role({ outputContract: { shape: "report", fields: ["findings"] } })), expect: { has: ["CONTRACT_CHANGED"] } },
  { group: "role-kept", input: pair("role", role(), role({ completionCriteria: [...ROLE.completionCriteria, "Every unknown names where it was looked for."], restrictions: [...ROLE.restrictions, "Never asks for a credential."] })), expect: NOTHING },
  { group: "kinds-differ", input: { call: "weakenings", parentKind: "workflow", candidateKind: "role", parent: wf(scored("gte", 1)), candidate: role() }, expect: { has: ["ORACLE_UNREADABLE"] } },
];

// ---- several changes at once: the reference model says exactly which weakenings they make ---------------------------

const CHANGES = [
  (r, s) => ({ ...s, success: s.success.map((x) => ((v) => ({ ...x, value: v }))(pick(r, [x.value - 1, x.value, x.value + 1]))) }),
  (r, s) => ({ ...s, required: pick(r, [true, false]) }),
  (r, s) => ({ ...s, approval: pick(r, ["none", "owner"]) }),
  (r, s) => ({ ...s, evidence: pick(r, ["report", "owner-record"]) }),
  (r, s) => (r() < 0.25 ? { ...s, outputs: { ...s.outputs, score: { type: pick(r, ["string", "count"]), path: "score" } } } : { ...s, outputs: { ...s.outputs, score: { ...s.outputs.score, path: pick(r, ["score", "out.score"]) } } }),
];

const MIXED_STEPS = ["first", "second", "third"];

const mixedStep = (r, id) => scored(pick(r, [...LOWER, ...UPPER]), Math.round(r() * 200 - 100), { id, required: pick(r, [true, false]), approval: pick(r, ["none", "owner"]), evidence: pick(r, ["report", "owner-record"]), outputs: { score: { type: "number", path: "score" }, record: { type: "record", path: "record" } } });

const changedStep = (r, s) => CHANGES.filter(() => r() < 0.5).reduce((acc, change) => change(r, acc), s);

function mixed(r) {
  const parent = MIXED_STEPS.map((id) => mixedStep(r, id));
  const candidate = parent.map((s) => changedStep(r, s));
  return { group: "mixed-workflow", input: pair("workflow", wf(...parent), wf(...candidate)), expect: { exactly: [...new Set(parent.flatMap((s, i) => keptStepIds(s, candidate[i])))].sort() } };
}

// ---- through the public safety API ------------------------------------------------------------------------------------

const PIN = "release-notes:1.0.0:aaaaaaaa";

const playbook = (workflow, successor = false) => ({ pin: successor ? "release-notes:1.0.1:bbbbbbbb" : PIN, digest: successor ? "d1" : "d0", intact: true, manifest: { provides: ["release.notes"], allowedTools: ["Read"], successorOf: successor ? PIN : null }, files: [{ name: "SKILL.md" }, { name: "manifest.json" }, { name: "workflow.json" }], workflow });

const ROLE_PIN = "release-reader:1.0.0:aaaaaaaa";

const roleVersion = (content, successor = false) => ({ pin: successor ? "release-reader:1.0.1:bbbbbbbb" : ROLE_PIN, contentDigest: successor ? "c1" : "c0", kind: "role", id: "release-reader", content, provenance: { successorOf: successor ? ROLE_PIN : null } });

const WEAKENED = { has: ["CAND_ORACLE_WEAKENED"] };

const safetyPlaybook = ([low, high], i) => ({ group: "safety-playbook", input: { call: "safety", kind: "skill", parent: playbook(wf(scored(LOWER[i % 2], i % 3 ? high : low), notes())), candidate: playbook(wf(scored(LOWER[i % 2], i % 3 ? low : high), notes()), true) }, expect: i % 3 ? WEAKENED : NOTHING });

const SAFETY_ROLE = [
  { group: "safety-role", input: { call: "safety", kind: "satellite", parent: roleVersion(role()), candidate: roleVersion(role({ completionCriteria: ROLE.completionCriteria.slice(1) }), true) }, expect: WEAKENED },
  { group: "safety-role", input: { call: "safety", kind: "satellite", parent: roleVersion(role()), candidate: roleVersion(role({ completionCriteria: [...ROLE.completionCriteria, "Every unknown names where it was looked for."] }), true) }, expect: NOTHING },
];

// ---- all of them, numbered within their group ------------------------------------------------------------------------

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  const pairs = pairsOf(r, Math.max(4, Math.floor(samples / 4)));
  const generated = [...BOUNDS.flatMap((b) => pairs.map(b)), ...pairs.map(unchanged), ...pairs.map(safetyPlaybook), ...Array.from({ length: Math.max(4, Math.floor(samples / 4)) }, () => mixed(r))];
  return numbered([...generated, ...STRUCTURE, ...SAFETY_ROLE]);
}

// ---- the reference model, held to what the contract says in words --------------------------------------------------

const HAND = [
  ["a lower bound dropped from 0.9 to 0.5", scored("gte", 0.9), scored("gte", 0.5), ["RULE_LOOSENED"]],
  ["a strict lower bound raised from 3 to 4", scored("gt", 3), scored("gt", 4), []],
  ["an upper bound raised from 5 to 6", scored("lte", 5), scored("lte", 6), ["RULE_LOOSENED"]],
  ["a strict upper bound dropped from -2 to -3", scored("lt", -2), scored("lt", -3), []],
  ["a bound that stayed at zero", scored("gte", 0), scored("gte", 0), []],
  ["a required step made optional", scored("gte", 1), scored("gte", 1, { required: false }), ["REQUIRED_DROPPED"]],
  ["an optional step made required", scored("gte", 1, { required: false }), scored("gte", 1), []],
  ["owner evidence turned into a report", proven(), proven({ evidence: "report" }), ["EVIDENCE_WEAKENED"]],
  ["a person's approval no longer asked", scored("gte", 1, { approval: "owner" }), scored("gte", 1), ["APPROVAL_DROPPED"]],
  ["a success rule removed", scored("gte", 1), scored("gte", 1, { success: [] }), ["RULE_REMOVED"]],
  ["a ruled output retyped", scored("gte", 1), scored("gte", 1, { outputs: { score: { type: "string", path: "score" } } }), ["OUTPUT_RETYPED"]],
  ["an output read from elsewhere", scored("gte", 1), scored("gte", 1, { outputs: { score: { type: "number", path: "x.score" } } }), []],
];

const sameIds = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

export const selfTest = () => [...HAND.filter(([, p, c, want]) => !sameIds(keptStepIds(p, c), want)).map(([say]) => `the reference model disagrees with the contract on: ${say}`), ...(FIXED_PAIRS.every(([low, high]) => high > low) ? [] : ["a fixed boundary pair is not strictly ordered"])];
