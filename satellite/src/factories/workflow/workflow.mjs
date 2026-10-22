// WORKFLOW TEMPLATES: a reusable, versioned shape of work -- parameterised units, their dependencies, the capabilities
// they need, their verification gates, what a failure does, and conditional branches -- in a schema of Satellite's
// own (orbit.satellite.workflow/v1; Orbit's declared playbook workflows cannot represent agent dispatch, and theirs is
// never reinterpreted here). A template carries NO execution state, approval, credential or verdict: a mission that
// reuses one instantiates fresh units from its parameters, and nothing of an earlier mission comes with it.
import { CAPABILITY } from "../../../../src/goal/fields.mjs";
import { EVIDENCE_LEVELS } from "../../evidence/vocab.mjs";
import { MODES } from "../../execution/modes.mjs";
import { UNIT_KINDS, UNIT_KIND_NAMES } from "../../execution/unit-kinds.mjs";
import { topo } from "../../planning/graph.mjs";
import { UNIT_KEY } from "../../planning/unit.mjs";
import { isObject, isSentence, list, secretShaped } from "../../store/text.mjs";

export const WORKFLOW_API = "orbit.satellite.workflow/v1";

export const WORKFLOW_SCHEMA = 1;

export const WORKFLOW_FIELDS = Object.freeze(["api", "name", "purpose", "provides", "parameters", "units", "bounds"]);

export const TEMPLATE_UNIT_FIELDS = Object.freeze(["key", "kind", "objective", "dependsOn", "when", "requiredCapabilities", "requestedEffects", "verification", "onFailure", "serves"]);

// What a template never holds -- refused by name wherever it appears.
export const FORBIDDEN_IN_TEMPLATE = Object.freeze(["status", "state", "approval", "approved", "credential", "secret", "token", "password", "verdict", "outcome", "evidence", "assignedAgentRunIds", "grants", "revision", "mode", "operationKind", "attempt", "lifecycle"]);

const PARAM = /^[a-z][a-zA-Z0-9]{0,31}$/;

const NAME = /^[a-z][a-z0-9-]{1,40}$/;

const TYPES = { string: (v) => typeof v === "string", number: (v) => typeof v === "number" && Number.isFinite(v), boolean: (v) => typeof v === "boolean" };

const slotsOf = (text) => [...String(text).matchAll(/\{([a-z][a-zA-Z0-9]{0,31})\}/g)].map((m) => m[1]);

const forbiddenIn = (o) => (isObject(o) ? Object.keys(o).filter((k) => FORBIDDEN_IN_TEMPLATE.includes(k)) : []);

const paramsOk = (p) => p === undefined || (isObject(p) && Object.entries(p).every(([k, v]) => PARAM.test(k) && isObject(v) && Object.keys(v).every((x) => ["type", "required", "say"].includes(x)) && TYPES[v.type] && (v.required === undefined || typeof v.required === "boolean")));

const whenOk = (u, params) => u.when === undefined || (isObject(u.when) && Object.keys(u.when).every((k) => ["param", "eq"].includes(k)) && Boolean(params?.[u.when.param]) && TYPES[params[u.when.param].type](u.when.eq));

const unitOk = (u, params) => isObject(u) && Object.keys(u).every((k) => TEMPLATE_UNIT_FIELDS.includes(k)) && UNIT_KEY.test(String(u.key)) && UNIT_KIND_NAMES.includes(u.kind) && isSentence(u.objective) && slotsOf(u.objective).every((s) => Boolean(params?.[s])) && whenOk(u, params) && list(u.requiredCapabilities).every((c) => CAPABILITY.test(String(c))) && list(u.requestedEffects).every((e) => MODES[UNIT_KINDS[u.kind].mode].kinds.includes(e)) && (u.verification === undefined || (isObject(u.verification) && EVIDENCE_LEVELS.includes(u.verification.min ?? "CONTRACT_MET"))) && (u.onFailure === undefined || (isObject(u.onFailure) && ["retry", "replan", "stop"].includes(u.onFailure.then) && Number.isInteger(u.onFailure.max ?? 1) && (u.onFailure.max ?? 1) <= 3)) && (u.serves === undefined || ["all", "none"].includes(u.serves));

const keysOf = (t) => list(t.units).map((u) => u?.key);

const branchesClash = (a, b) => Boolean(a.when && b.when) && a.when.param === b.when.param && a.when.eq !== b.when.eq;

const impossible = (t) => list(t.units).some((u) => list(u.dependsOn).some((d) => ((dep) => dep && branchesClash(u, dep))(list(t.units).find((x) => x.key === d))));

const recursive = (t) => Boolean(t.provides) && list(t.units).some((u) => list(u.requiredCapabilities).includes(t.provides));

const textsOf = (t) => [t.purpose, ...list(t.units).map((u) => u?.objective)].filter((x) => typeof x === "string");

// c: { limits } -- every rule asked, each a sentence.
export const WORKFLOW_RULES = Object.freeze([
  { id: "WF_API", fails: (t) => t.api !== WORKFLOW_API, say: () => `api is ${WORKFLOW_API}` },
  { id: "WF_FIELDS", fails: (t) => Object.keys(t).some((k) => !WORKFLOW_FIELDS.includes(k)), say: (t) => `unknown field(s): ${Object.keys(t).filter((k) => !WORKFLOW_FIELDS.includes(k)).join(", ")}` },
  { id: "WF_STATE", fails: (t) => [...forbiddenIn(t), ...list(t.units).flatMap(forbiddenIn)].length > 0, say: (t) => `a template carries no execution state, approval, credential or verdict: ${[...new Set([...forbiddenIn(t), ...list(t.units).flatMap(forbiddenIn)])].join(", ")}` },
  { id: "WF_NAME", fails: (t) => !NAME.test(String(t.name)) || !isSentence(t.purpose), say: () => "name is a lower-case word and purpose one sentence" },
  { id: "WF_PROVIDES", fails: (t) => t.provides !== undefined && !CAPABILITY.test(String(t.provides)), say: () => "provides is a dotted capability word" },
  { id: "WF_PARAMETERS", fails: (t) => !paramsOk(t.parameters), say: () => "parameters are { name: { type: string|number|boolean, required? } }" },
  { id: "WF_UNITS", fails: (t, c) => !Array.isArray(t.units) || t.units.length === 0 || t.units.length > c.limits.maxUnits || !t.units.every((u) => unitOk(u, t.parameters)), say: (t, c) => `units are 1 to ${c.limits.maxUnits} { key, kind, objective with declared {slots}, dependsOn, when, requiredCapabilities, requestedEffects its kind's mode carries, verification, onFailure, serves }` },
  { id: "WF_DUPLICATE_KEY", fails: (t) => new Set(keysOf(t)).size !== keysOf(t).length, say: () => "unit keys are unique" },
  { id: "WF_UNKNOWN_DEPENDENCY", fails: (t) => list(t.units).some((u) => list(u.dependsOn).some((d) => !keysOf(t).includes(d))), say: () => "dependsOn names units of the template" },
  { id: "WF_CYCLE", fails: (t) => topo(list(t.units).map((u) => ({ id: u.key, deps: list(u.dependsOn) }))) === null, say: () => "the dependencies hold a cycle" },
  { id: "WF_IMPOSSIBLE_DEPENDENCY", fails: impossible, say: () => "a unit depends on a unit of the opposite branch: it could never become ready" },
  { id: "WF_RECURSION", fails: recursive, say: (t) => `a unit needs ${t.provides}, the capability this workflow provides: it would recurse into itself` },
  { id: "WF_BOUNDS", fails: (t, c) => t.bounds !== undefined && !(isObject(t.bounds) && (t.bounds.maxUnits ?? 1) <= c.limits.maxUnits && (t.bounds.maxDepth ?? 1) <= c.limits.maxDepth && (t.bounds.maxAgentRuns ?? 1) <= c.limits.maxAgentRuns), say: () => "bounds never exceed the mission's own limits" },
  { id: "WF_SECRET", fails: (t) => textsOf(t).some(secretShaped), say: () => "text that looks like a secret is refused" },
]);

export const workflowFindings = (t, c) => (isObject(t) ? WORKFLOW_RULES.filter((r) => r.fails(t, c)).map((r) => ({ id: r.id, say: r.say(t, c) })) : [{ id: "WF_SHAPE", say: "a workflow template is an object" }]);

const paramProblems = (t, params) => [...Object.entries(t.parameters ?? {}).filter(([k, p]) => p.required && params?.[k] === undefined).map(([k]) => `parameter ${k} is required`), ...Object.keys(params ?? {}).filter((k) => !t.parameters?.[k]).map((k) => `no parameter ${k}`), ...Object.entries(params ?? {}).filter(([k, v]) => t.parameters?.[k] && !TYPES[t.parameters[k].type](v)).map(([k]) => `parameter ${k} is a ${t.parameters[k].type}`)];

const applies = (u, params) => !u.when || params?.[u.when.param] === u.when.eq;

const filled = (text, params) => String(text).replace(/\{([a-z][a-zA-Z0-9]{0,31})\}/g, (m, k) => String(params?.[k] ?? m));

const unitFrom = (u, params, kept, prefix, accIds) => ({ key: `${prefix}${u.key}`, kind: u.kind, objective: filled(u.objective, params), dependsOn: list(u.dependsOn).filter((d) => kept.includes(d)).map((d) => `${prefix}${d}`), ...(u.requiredCapabilities ? { requiredCapabilities: u.requiredCapabilities } : {}), ...(u.requestedEffects ? { requestedEffects: u.requestedEffects } : {}), ...(u.verification ? { verificationContract: { min: u.verification.min ?? UNIT_KINDS[u.kind].min, owner: u.verification.owner ?? "any" } } : {}), ...(u.onFailure ? { executionBudget: { maxAttempts: Math.min(3, u.onFailure.then === "retry" ? 1 + (u.onFailure.max ?? 1) : 1) } } : {}), acceptanceCriteriaRefs: u.serves === "none" ? [] : accIds });

// The units a template becomes for ONE mission: its parameters filled, its branches resolved, nothing else carried.
export function instantiate(t, params, opts = {}) {
  const problems = paramProblems(t, params);
  if (problems.length) return { problems, units: [] };
  const kept = list(t.units).filter((u) => applies(u, params)).map((u) => u.key);
  return { problems: [], units: list(t.units).filter((u) => kept.includes(u.key)).map((u) => unitFrom(u, params, kept, opts.prefix ?? "", opts.acceptance ?? [])) };
}

export const workflowIdOf = (name) => `wft-${name}`.slice(0, 52);
