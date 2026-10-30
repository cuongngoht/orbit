// The ORACLE a candidate is judged by, frozen before it runs: what the version it succeeds REQUIRES -- for a declared
// playbook, every required step, the evidence each must bring, the approval each waits for and every success rule its
// outputs are held to; for a Satellite role, its completion criteria, restrictions and output contract -- and the one
// comparison that says whether a candidate WEAKENED it. A candidate may change how a step reads an answer; it may never
// lower what counts as a pass, drop a check, or stop asking a person.
//
//   oracleOf(kind, content) -> { kind, ... }      digestOfOracle(oracle) -> sha
//   weakenings(parent, candidate) -> [{ id, says }]
import { canonicalJson, sha } from "../hash.mjs";

const byId = (a, b) => String(a.id).localeCompare(String(b.id));

const ruleOf = (r) => ({ output: r?.output ?? null, op: r?.op ?? null, value: r?.value ?? null });

// The type of every output a success rule reads: a candidate may change WHERE it reads an answer (a path), never what
// kind of value a rule is held against.
const ruledOutputs = (s) => Object.fromEntries((s.success ?? []).map((r) => [r?.output, s.outputs?.[r?.output]?.type ?? null]).filter(([k]) => k));

const stepOf = (s) => ({ id: s.id, required: s.required !== false, evidence: s.evidence ?? "report", approval: s.approval ?? "none", success: (s.success ?? []).map(ruleOf), outputs: ruledOutputs(s) });

const list = (v) => (Array.isArray(v) ? v.map(String) : []);

export const ORACLES = {
  workflow: (wf) => ({ kind: "workflow", steps: (wf?.steps ?? []).map(stepOf).sort(byId) }),
  role: (content) => ({ kind: "role", completionCriteria: list(content?.completionCriteria), restrictions: list(content?.restrictions), outputContract: canonicalJson(content?.outputContract ?? null) }),
};

export const oracleOf = (kind, content) => ORACLES[kind](content);

export const digestOfOracle = (oracle) => sha(canonicalJson(oracle));

// A rule is LOOSER when what passes under it is a superset of what passed before.
const LOOSER = { gte: (a, b) => b < a, gt: (a, b) => b < a, lte: (a, b) => b > a, lt: (a, b) => b > a, eq: (a, b) => b !== a, ne: (a, b) => b !== a, present: () => false, nonempty: () => false };

const looser = (r, c) => (LOOSER[r.op] ?? (() => true))(r.value, c.value);

const ruleFindings = (p, c) => p.success.flatMap((r) => ((cr) => (!cr ? [{ id: "RULE_REMOVED", says: `${p.id}: the rule ${r.output} ${r.op} ${r.value ?? ""} is gone` }] : looser(r, cr) ? [{ id: "RULE_LOOSENED", says: `${p.id}: ${r.output} ${r.op} ${r.value} became ${cr.op} ${cr.value}` }] : []))(c.success.find((x) => x.output === r.output && x.op === r.op)));

// What each parent step loses in the candidate, as rows: a required step dropped or made optional, owner-record
// evidence turned into a report, a person's approval no longer asked, a success rule removed or loosened.
const STEP_WEAKENINGS = [
  { id: "REQUIRED_DROPPED", fails: (p, c) => p.required && (!c || !c.required), says: (p) => `${p.id} is required by the version it succeeds and is optional or gone in the candidate` },
  { id: "EVIDENCE_WEAKENED", fails: (p, c) => Boolean(c) && p.evidence === "owner-record" && c.evidence !== "owner-record", says: (p) => `${p.id} must be proven by an owner's record, and the candidate settles for a report` },
  { id: "APPROVAL_DROPPED", fails: (p, c) => Boolean(c) && p.approval === "owner" && c.approval !== "owner", says: (p) => `${p.id} waits for a person, and the candidate stops asking` },
];

const retyped = (p, c) => Object.entries(p.outputs ?? {}).filter(([name, type]) => (c.outputs ?? {})[name] !== undefined && c.outputs[name] !== type).map(([name]) => ({ id: "OUTPUT_RETYPED", says: `${p.id}: the output ${name} a rule is held against changed its type` }));

const stepFindings = (p, c) => [...STEP_WEAKENINGS.filter((w) => w.fails(p, c)).map((w) => ({ id: w.id, says: w.says(p) })), ...(c ? [...ruleFindings(p, c), ...retyped(p, c)] : [])];

const missingFrom = (id, what, parent, candidate) => parent.filter((x) => !candidate.includes(x)).map((x) => ({ id, says: `${what} "${x.slice(0, 80)}" is gone` }));

const WEAKENINGS = {
  workflow: (p, c) => p.steps.flatMap((s) => stepFindings(s, c.steps.find((x) => x.id === s.id) ?? null)),
  role: (p, c) => [...missingFrom("CRITERION_REMOVED", "the completion criterion", p.completionCriteria, c.completionCriteria), ...missingFrom("RESTRICTION_REMOVED", "the restriction", p.restrictions, c.restrictions), ...(p.outputContract !== c.outputContract ? [{ id: "CONTRACT_CHANGED", says: "the output contract a report is held to changed" }] : [])],
};

export const weakenings = (parent, candidate) => (parent?.kind && parent.kind === candidate?.kind ? WEAKENINGS[parent.kind](parent, candidate) : [{ id: "ORACLE_UNREADABLE", says: "the acceptance rules of one of the two versions could not be read" }]);
