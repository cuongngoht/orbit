// A playbook's DECLARED WORKFLOW (0.0.4): `workflow.json`, the steps the engine runs itself -- each one a capability
// the resolver finds a provider for at run time, asked through that provider's own owner gate (src/work/invoke.mjs
// invokeBound). It is DATA the engine interprets (src/skill-factory/interpret.mjs), and nothing in it can run: there
// is no command, no script, no expression, no module and no path, because there is no field for any of them and a
// field nobody declared is refused.
//
//   { "api": "orbit.skill-workflow/v1",
//     "bounds": { "maxCalls": 8, "maxMs": 120000 },
//     "steps": [ { "id": "collect", "capability": "qa.evidence.read", "tool": "search", "after": [],
//                  "input": { "query": { "from": "context.objective" }, "limit": { "value": 5 } },
//                  "outputs": { "count": { "type": "count", "path": "items" } },
//                  "success": [ { "output": "count", "op": "gte", "value": 1 } ],
//                  "required": true, "retries": 1, "timeoutMs": 30000, "evidence": "report", "approval": "none" } ] }
//
//   capability   a word the manifest NEEDS (and never one it provides: a workflow never runs itself)
//   tool         the tool to call when the provider is a managed server; ignored by a project's capability
//   after        the steps it waits for -- a DAG, checked for cycles before anything runs
//   input        arguments, each ONE binding: { "from": "context.objective" | "context.ref" |
//                "steps.<an earlier step>.<one of its outputs>" } or { "value": a string, number, boolean or null }.
//                No interpolation, no expression, no secret, no file: a value is what it says
//   outputs      typed values read off the answer by a dotted path of plain keys (at most four deep)
//   success      conditions over its own outputs -- what the step's OUTPUT CONTRACT is
//   evidence     `report` (a call that answered and met its contract is reported, never verified) or
//                `owner-record` (an output of type `record` names a record an Orbit owner keeps, read back)
//   required     a required step's failure stops the run; an optional one's is recorded and the run goes on
//   retries      0-3, only after an error or a spent wait of a call that read -- never after a refusal
//   approval     `owner`: a person allows this step's call, once, before it runs (Orbit Control)
//
//   workflowFindings(raw, manifest) -> [{ id, says }]   every rule asked; the dry run only on a workflow the others pass
import { dryRunFindings, orderOf, WF_API, WF_LIMITS, WF_OPS, WF_TYPES } from "./interpret.mjs";

const CAPABILITY = /^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9-]*)+$/;
const STEP_ID = /^[a-z][a-z0-9-]{0,31}$/;
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
const TOOL = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const PATH = /^[A-Za-z0-9_]{1,40}(\.[A-Za-z0-9_]{1,40}){0,3}$/;
const FROM = /^(context\.(objective|ref)|steps\.[a-z][a-z0-9-]{0,31}\.[A-Za-z_][A-Za-z0-9_]{0,39})$/;

export const TOP_FIELDS = ["api", "bounds", "steps"];
export const STEP_FIELDS = ["id", "capability", "tool", "after", "input", "outputs", "success", "required", "retries", "timeoutMs", "evidence", "approval"];
export const EVIDENCE_MODES = ["report", "owner-record"];
export const APPROVALS = ["none", "owner"];

const finding = (id, says) => ({ id, says });
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const entries = (v) => (isObject(v) ? Object.entries(v) : []);
const stepsOf = (wf) => (Array.isArray(wf.steps) ? wf.steps.filter(isObject) : []);
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const unknownIn = (v, allowed) => Object.keys(isObject(v) ? v : {}).filter((k) => !allowed.includes(k));
const where = (s) => `step ${typeof s.id === "string" ? s.id : "?"}`;

// ---- a binding ----------------------------------------------------------------------------------

const isScalar = (v) => v === null || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.length <= WF_LIMITS.text);

// Every step a step waits for, directly or through another.
const afterOf = (wf, id) => ((s) => (Array.isArray(s?.after) ? s.after : []))(stepsOf(wf).find((x) => x.id === id));

export function ancestorsOf(wf, id, seen = new Set()) {
  const fresh = afterOf(wf, id).filter((a) => !seen.has(a));
  for (const a of fresh) seen.add(a);
  for (const a of fresh) ancestorsOf(wf, a, seen);
  return seen;
}

const outputOf = (wf, ref) => ((m) => (m ? stepsOf(wf).find((s) => s.id === m[1])?.outputs?.[m[2]] ?? null : null))(/^steps\.([^.]+)\.(.+)$/.exec(ref));

// What is wrong with one argument's binding: its form, where it reads from, and whether that is an earlier step's output.
function bindingProblem(wf, s, b) {
  if (!isObject(b) || Object.keys(b).length !== 1 || !("from" in b || "value" in b)) return "is one { from } or one { value }";
  if ("value" in b) return isScalar(b.value) ? null : `holds a value that is not a short string, a number, a boolean or null`;
  if (typeof b.from !== "string" || !FROM.test(b.from)) return "reads from context.objective, context.ref or steps.<step>.<output> — nothing else";
  return b.from.startsWith("steps.") && !(ancestorsOf(wf, s.id).has(b.from.split(".")[1]) && outputOf(wf, b.from)) ? `reads ${b.from}, which no step it waits for declares` : null;
}

const inputFindings = (wf, s) => [...(entries(s.input).length > WF_LIMITS.args ? [finding("WF_BINDING", `${where(s)} takes at most ${WF_LIMITS.args} arguments`)] : []), ...entries(s.input).flatMap(([k, b]) => ((p) => [...(NAME.test(k) ? [] : [finding("WF_BINDING", `${where(s)}: ${k} is not an argument name`)]), ...(p ? [finding("WF_BINDING", `${where(s)}: argument ${k} ${p}`)] : [])])(bindingProblem(wf, s, b)))];

// ---- outputs and the output contract -------------------------------------------------------------------

const outputProblem = (o) => (!isObject(o) || unknownIn(o, ["type", "path"]).length ? "is { type, path }" : !WF_TYPES.includes(o.type) ? `has a type that is not one of ${WF_TYPES.join(", ")}` : typeof o.path !== "string" || !PATH.test(o.path) ? "reads a path that is not dotted plain keys, at most four deep" : null);

const outputFindings = (s) => [...(entries(s.outputs).length > WF_LIMITS.outputs ? [finding("WF_OUTPUT", `${where(s)} declares at most ${WF_LIMITS.outputs} outputs`)] : []), ...entries(s.outputs).flatMap(([k, o]) => [...(NAME.test(k) ? [] : [finding("WF_OUTPUT", `${where(s)}: ${k} is not an output name`)]), ...((p) => (p ? [finding("WF_OUTPUT", `${where(s)}: output ${k} ${p}`)] : []))(outputProblem(o))])];

function conditionProblem(s, c) {
  if (!isObject(c) || unknownIn(c, ["output", "op", "value"]).length) return "is { output, op, value? }";
  const type = s.outputs?.[c.output]?.type;
  if (!type) return `names ${c.output}, which this step does not declare`;
  const op = WF_OPS[c.op];
  return !op ? `has an op that is not one of ${Object.keys(WF_OPS).join(", ")}` : !op.types.includes(type) ? `asks ${c.op} of a ${type}` : op.value !== ("value" in c) || ("value" in c && !op.fits(type, c.value)) ? `${op.value ? "compares with a value of the output's own type" : "takes no value"}` : null;
}

const successFindings = (s) => [...(s.success !== undefined && (!Array.isArray(s.success) || s.success.length > WF_LIMITS.success) ? [finding("WF_SUCCESS", `${where(s)}: success is a list of at most ${WF_LIMITS.success} conditions`)] : []), ...(Array.isArray(s.success) ? s.success : []).flatMap((c, i) => ((p) => (p ? [finding("WF_SUCCESS", `${where(s)}: condition ${i + 1} ${p}`)] : []))(conditionProblem(s, c)))];

const evidenceFindings = (s) => (s.evidence === undefined || EVIDENCE_MODES.includes(s.evidence) ? (s.evidence === "owner-record" && !entries(s.outputs).some(([, o]) => o?.type === "record") ? [finding("WF_EVIDENCE", `${where(s)}: owner-record evidence needs an output of type record — the record an owner keeps, read back`)] : []) : [finding("WF_EVIDENCE", `${where(s)}: evidence is one of ${EVIDENCE_MODES.join(", ")}`)]);

// ---- bounds ------------------------------------------------------------------------------------------

const callsOf = (wf) => stepsOf(wf).reduce((n, s) => n + 1 + (Number.isInteger(s.retries) ? s.retries : 0), 0);

const maxCallsOf = (wf) => wf.bounds?.maxCalls ?? WF_LIMITS.maxCalls;

const stepBoundFindings = (s) => [...(s.retries === undefined || isInt(s.retries, 0, WF_LIMITS.retries) ? [] : [finding("WF_BOUNDS", `${where(s)}: retries is 0 to ${WF_LIMITS.retries}`)]), ...(s.timeoutMs === undefined || isInt(s.timeoutMs, WF_LIMITS.minTimeoutMs, WF_LIMITS.timeoutMs) ? [] : [finding("WF_BOUNDS", `${where(s)}: timeoutMs is ${WF_LIMITS.minTimeoutMs} to ${WF_LIMITS.timeoutMs}`)]), ...(s.required === undefined || typeof s.required === "boolean" ? [] : [finding("WF_BOUNDS", `${where(s)}: required is true or false`)]), ...(s.approval === undefined || APPROVALS.includes(s.approval) ? [] : [finding("WF_BOUNDS", `${where(s)}: approval is one of ${APPROVALS.join(", ")}`)])];

const boundFindings = (wf) => [...(wf.bounds === undefined || (isObject(wf.bounds) && !unknownIn(wf.bounds, ["maxCalls", "maxMs"]).length && (wf.bounds.maxCalls === undefined || isInt(wf.bounds.maxCalls, 1, WF_LIMITS.maxCalls)) && (wf.bounds.maxMs === undefined || isInt(wf.bounds.maxMs, 1000, WF_LIMITS.maxMs))) ? [] : [finding("WF_BOUNDS", `bounds is { maxCalls: 1 to ${WF_LIMITS.maxCalls}, maxMs: 1000 to ${WF_LIMITS.maxMs} }`)]), ...(callsOf(wf) > maxCallsOf(wf) ? [finding("WF_BOUNDS", `its steps and their retries make ${callsOf(wf)} calls, more than ${maxCallsOf(wf)} (bounds.maxCalls)`)] : []), ...stepsOf(wf).flatMap(stepBoundFindings)];

// ---- the steps as a graph ---------------------------------------------------------------------------

const idFindings = (wf) => [...stepsOf(wf).filter((s) => typeof s.id !== "string" || !STEP_ID.test(s.id)).map((s) => finding("WF_STEP_ID", `${where(s)}: a step id is lower case letters, digits and dashes, starting with a letter`)), ...[...new Set(stepsOf(wf).map((s) => s.id).filter((id, i, all) => all.indexOf(id) !== i))].map((id) => finding("WF_DUPLICATE", `two steps are called ${id}`))];

const afterFindings = (wf) => stepsOf(wf).flatMap((s) => (s.after !== undefined && (!Array.isArray(s.after) || s.after.length > WF_LIMITS.after) ? [finding("WF_AFTER", `${where(s)}: after is a list of step ids`)] : (s.after ?? []).filter((a) => a === s.id || !stepsOf(wf).some((x) => x.id === a)).map((a) => finding("WF_AFTER", `${where(s)} waits for ${a}, which is ${a === s.id ? "itself" : "no step of this workflow"}`))));

const cycleFindings = (wf) => (orderOf(wf) ? [] : [finding("WF_CYCLE", "its steps wait for each other in a circle — nothing could ever start")]);

// ---- capabilities ----------------------------------------------------------------------------------------

const capabilityFindings = (wf, m) => stepsOf(wf).flatMap((s) => [...(typeof s.capability === "string" && CAPABILITY.test(s.capability) ? [] : [finding("WF_CAPABILITY", `${where(s)}: capability is one dotted, lower-case capability word`)]), ...(typeof s.capability === "string" && !(m?.needs ?? []).includes(s.capability) ? [finding("WF_CAPABILITY", `${where(s)} asks ${s.capability}, which the manifest does not declare it needs`)] : []), ...((m?.provides ?? []).includes(s.capability) ? [finding("WF_RECURSION", `${where(s)} asks ${s.capability}, which this playbook provides — a workflow never runs itself`)] : []), ...(s.tool === undefined || (typeof s.tool === "string" && TOOL.test(s.tool)) ? [] : [finding("WF_TOOL", `${where(s)}: tool is a tool's name, never a command`)])]);

// ---- the table -----------------------------------------------------------------------------------------

const shapeFindings = (wf) => (!isObject(wf) ? [finding("WF_SHAPE", "workflow.json is one JSON object")] : [...(wf.api === WF_API ? [] : [finding("WF_SHAPE", `api is ${WF_API}`)]), ...(Array.isArray(wf.steps) && wf.steps.length > 0 && wf.steps.length <= WF_LIMITS.steps && wf.steps.every(isObject) ? [] : [finding("WF_SHAPE", `steps is 1 to ${WF_LIMITS.steps} step objects`)]), ...unknownIn(wf, TOP_FIELDS).map((k) => finding("WF_FIELD", `${k} is not a workflow field — a workflow has no command, script, expression or module`))]);

const fieldFindings = (wf) => stepsOf(wf).flatMap((s) => unknownIn(s, STEP_FIELDS).map((k) => finding("WF_FIELD", `${where(s)}: ${k} is not a step field — a step has no command, script, expression or module`)));

export const RULES = [
  { id: "WF_SHAPE", stops: true, check: shapeFindings },
  { id: "WF_FIELD", check: fieldFindings },
  { id: "WF_STEP_ID", check: idFindings },
  { id: "WF_CAPABILITY", check: capabilityFindings },
  { id: "WF_AFTER", check: afterFindings },
  { id: "WF_CYCLE", stops: true, check: cycleFindings },
  { id: "WF_BINDING", check: (wf) => stepsOf(wf).flatMap((s) => [...(s.input !== undefined && !isObject(s.input) ? [finding("WF_BINDING", `${where(s)}: input is an object of arguments`)] : []), ...inputFindings(wf, s)]) },
  { id: "WF_OUTPUT", check: (wf) => stepsOf(wf).flatMap((s) => [...(s.outputs !== undefined && !isObject(s.outputs) ? [finding("WF_OUTPUT", `${where(s)}: outputs is an object of typed outputs`)] : []), ...outputFindings(s)]) },
  { id: "WF_SUCCESS", check: (wf) => stepsOf(wf).flatMap(successFindings) },
  { id: "WF_EVIDENCE", check: (wf) => stepsOf(wf).flatMap(evidenceFindings) },
  { id: "WF_BOUNDS", check: boundFindings },
];

const staticFindings = (wf, manifest) => RULES.reduce((acc, rule) => (acc.stopped ? acc : ((found) => ({ found: [...acc.found, ...found], stopped: Boolean(rule.stops && found.length) }))(rule.check(wf, manifest))), { found: [], stopped: false }).found;

// The deterministic run over typed stand-ins (interpret.mjs dryRunFindings) proves the interpreter can carry the
// workflow end to end -- and is asked only of a workflow every static rule already passed.
export function workflowFindings(raw, manifest) {
  const found = staticFindings(raw, manifest);
  return found.length ? found : dryRunFindings(raw);
}

export const parsedWorkflow = (text) => {
  try { return JSON.parse(String(text)); }
  catch { return undefined; }
};
