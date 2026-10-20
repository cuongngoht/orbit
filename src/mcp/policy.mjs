// MCP POLICY as data in the machine store (policies.json), and what of it a
// resource carries. The verdict itself is src/policy.mjs's, shared with the
// resolver; this file only says what a policy document may contain.
//
//   { resources: { "<key>": { default?, capabilities?, operations? } },
//     workflows: { "<skill>": { "<capability>": verdict } } }
//
// Keyed by the compound identity (managed:<id>), so a policy set for the
// server Orbit manages can never be read as one for an external server that
// happens to share its name. Deliberately small: a verdict per capability, a
// default, read/write, and a workflow exception. No roles, no users, no groups.
import { isVerdict, OPERATIONS, VERDICTS } from "../policy.mjs";

const WORD = /^[a-z0-9][a-z0-9._:-]{0,63}$/i;
const SKILL = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const LIMIT = 64;

// The policy a resource carries: its own rules plus every workflow exception,
// so the resolver needs nothing beside the registry to decide.
export function policyOf(policies, key) {
  const own = policies?.resources?.[key] ?? {};
  return { default: isVerdict(own.default) ? own.default : "allow", capabilities: verdictMap(own.capabilities), operations: verdictMap(own.operations), workflows: policies?.workflows ?? {} };
}

const verdictMap = (map) => Object.fromEntries(Object.entries(map && typeof map === "object" ? map : {}).filter(([k, v]) => WORD.test(k) && isVerdict(v)));

const RESOURCE_RULES = [
  { says: `default is one of ${VERDICTS.join(", ")}`, fails: (p) => p.default !== undefined && !isVerdict(p.default) },
  { says: `capabilities maps a capability to one of ${VERDICTS.join(", ")}`, fails: (p) => p.capabilities !== undefined && !mapOk(p.capabilities, WORD) },
  { says: `operations maps ${OPERATIONS.join(" or ")} to one of ${VERDICTS.join(", ")}`, fails: (p) => p.operations !== undefined && !mapOk(p.operations, /^(read|write)$/) },
];

export const resourcePolicyProblems = (p) => (p && typeof p === "object" && !Array.isArray(p) ? RESOURCE_RULES.filter((r) => r.fails(p)).map((r) => r.says) : ["a policy is an object"]);

export function workflowProblems(w) {
  if (!w || typeof w !== "object" || Array.isArray(w)) return ["workflows is an object of skill -> { capability: verdict }"];
  const bad = Object.entries(w).filter(([skill, map]) => !SKILL.test(skill) || !mapOk(map, WORD));
  return bad.length ? [`each workflow is a skill name mapping capabilities to one of ${VERDICTS.join(", ")}`] : [];
}

const mapOk = (map, keys) => Boolean(map) && typeof map === "object" && !Array.isArray(map) && Object.keys(map).length <= LIMIT && Object.entries(map).every(([k, v]) => keys.test(k) && isVerdict(v));

// Only what was said is kept: an empty rule is no rule.
export function withResourcePolicy(doc, key, policy) {
  const kept = Object.fromEntries(Object.entries({ default: policy.default, capabilities: policy.capabilities, operations: policy.operations }).filter(([, v]) => v !== undefined));
  return { ...doc, resources: { ...(doc.resources ?? {}), [key]: kept } };
}

export function withoutResourcePolicy(doc, key) {
  const { [key]: _gone, ...rest } = doc.resources ?? {};
  return { ...doc, resources: rest };
}

export const withWorkflows = (doc, workflows) => ({ ...doc, workflows });
