// How a declared workflow (src/skill-factory/workflow.mjs) is CARRIED: pure functions over its data, shared by the
// dry run validation holds a draft to and by the engine's skill runner (src/automation/skill-run.mjs), so what was
// proved at registration is what runs. Nothing here calls anything, reads a file or evaluates a string: an input is
// a value or a lookup by name, an output is a lookup by a dotted path of plain keys, a condition is one of a table's
// comparisons.
//
//   orderOf(wf)                 -> the step ids in dependency order (Kahn), or null when they wait in a circle
//   inputFor(step, scope)       -> { ok, input } | { ok: false, missing: [argument] }
//   outputsOf(step, answer)     -> { values, missing: [output] }   each value of its declared type, or missing
//   contractOf(step, out)       -> { met, missing, failed: [condition] }
//   dryRunFindings(wf)          -> [{ id, says }]: the workflow carried end to end over typed stand-ins
export const WF_API = "orbit.skill-workflow/v1";

export const WF_LIMITS = { steps: 16, retries: 3, minTimeoutMs: 1000, timeoutMs: 120000, defaultTimeoutMs: 30000, maxCalls: 16, maxMs: 600000, args: 16, outputs: 8, success: 8, after: 16, text: 240 };

// The records an `owner-record` output may name: what an Orbit owner keeps and the coordinator reads back.
export const RECORD_DOMAINS = ["task", "investigation", "requirement"];

const RECORD = new RegExp(`^(${RECORD_DOMAINS.join("|")}):[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`);

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

const finite = (v) => typeof v === "number" && Number.isFinite(v);

const sizeOf = (v) => (Array.isArray(v) ? v.length : isObject(v) ? Object.keys(v).length : Number.isInteger(v) && v >= 0 ? v : undefined);

// What an answer's value is as each declared type -- or undefined, which is a missing output.
export const TYPES = {
  string: (v) => (typeof v === "string" ? v.slice(0, WF_LIMITS.text) : undefined),
  number: (v) => (finite(v) ? v : undefined),
  boolean: (v) => (typeof v === "boolean" ? v : undefined),
  count: sizeOf,
  record: (v) => (typeof v === "string" && RECORD.test(v) ? v : undefined),
};

export const WF_TYPES = Object.keys(TYPES);

const sameKind = (type, v) => ({ string: typeof v === "string", record: typeof v === "string", number: finite(v), count: finite(v), boolean: typeof v === "boolean" })[type] === true;

const ALL = WF_TYPES;
const NUMERIC = ["number", "count"];

// The comparisons a condition may make: which output types it applies to, whether it takes a value, and the test.
export const WF_OPS = {
  eq: { types: ALL, value: true, fits: sameKind, test: (a, b) => a === b },
  ne: { types: ALL, value: true, fits: sameKind, test: (a, b) => a !== b },
  gt: { types: NUMERIC, value: true, fits: sameKind, test: (a, b) => a > b },
  gte: { types: NUMERIC, value: true, fits: sameKind, test: (a, b) => a >= b },
  lt: { types: NUMERIC, value: true, fits: sameKind, test: (a, b) => a < b },
  lte: { types: NUMERIC, value: true, fits: sameKind, test: (a, b) => a <= b },
  present: { types: ALL, value: false, fits: () => true, test: (a) => a !== undefined },
  nonempty: { types: ["string", "count", "record"], value: false, fits: () => true, test: (a) => (typeof a === "string" ? a.length > 0 : a > 0) },
};

// ---- order -------------------------------------------------------------------------------------------

const edgesOf = (steps) => ((ids) => steps.map((s) => ({ id: s.id, after: (Array.isArray(s.after) ? s.after : []).filter((a) => ids.has(a) && a !== s.id) })))(new Set(steps.map((s) => s.id)));

const kahn = (left, done) => ((ready) => (ready.length ? kahn(left.filter((s) => !ready.includes(s)), [...done, ...ready.map((s) => s.id)]) : done))(left.filter((s) => s.after.every((a) => done.includes(a))));

export function orderOf(wf) {
  const steps = (Array.isArray(wf?.steps) ? wf.steps : []).filter(isObject);
  const order = kahn(edgesOf(steps), []);
  return order.length === steps.length ? order : null;
}

export const stepOf = (wf, id) => wf.steps.find((s) => s.id === id) ?? null;

// ---- inputs ---------------------------------------------------------------------------------------------

const present = (v) => (v === undefined || v === null ? { ok: false } : { ok: true, v });

const fromOf = (from, scope) => ((parts) => (parts[0] === "context" ? present(scope.context?.[parts[1]]) : present(scope.outputs?.get(parts[1])?.[parts[2]])))(from.split("."));

const valueOf = (b, scope) => ("value" in b ? { ok: true, v: b.value } : fromOf(b.from, scope));

// scope: { context: { objective, ref }, outputs: Map(step id -> { output: value }) }
export function inputFor(step, scope) {
  const pairs = Object.entries(step.input ?? {}).map(([k, b]) => [k, valueOf(b, scope)]);
  const missing = pairs.filter(([, r]) => !r.ok).map(([k]) => k);
  return missing.length ? { ok: false, missing } : { ok: true, input: Object.fromEntries(pairs.map(([k, r]) => [k, r.v])) };
}

// ---- outputs and the contract ------------------------------------------------------------------------

const at = (value, path) => path.split(".").reduce((v, k) => (v !== null && typeof v === "object" && Object.hasOwn(v, k) ? v[k] : undefined), value);

export function outputsOf(step, answer) {
  const rows = Object.entries(step.outputs ?? {}).map(([name, o]) => [name, TYPES[o.type](at(answer, o.path))]);
  return { values: Object.fromEntries(rows.filter(([, v]) => v !== undefined)), missing: rows.filter(([, v]) => v === undefined).map(([n]) => n) };
}

const said = (c) => `${c.output} ${c.op}${"value" in c ? ` ${JSON.stringify(c.value)}` : ""}`;

export function contractOf(step, out) {
  const failed = (step.success ?? []).filter((c) => !Object.hasOwn(out.values, c.output) || !WF_OPS[c.op].test(out.values[c.output], c.value));
  return { met: out.missing.length === 0 && failed.length === 0, missing: out.missing, failed: failed.map(said) };
}

// ---- the dry run -------------------------------------------------------------------------------------

// A stand-in of each type that reads back as that type.
const STAND_IN = { string: "x", number: 1, boolean: true, count: [0], record: "task:tsk-000000000000" };

const placed = (obj, keys, v) => (keys.length === 1 ? { ...obj, [keys[0]]: v } : { ...obj, [keys[0]]: placed(isObject(obj[keys[0]]) ? obj[keys[0]] : {}, keys.slice(1), v) });

// An answer shaped so every declared path holds a value of its type -- unless two outputs read one path as two things.
const answerFor = (step) => Object.values(step.outputs ?? {}).reduce((acc, o) => placed(acc, o.path.split("."), STAND_IN[o.type]), {});

const dryFinding = (says) => ({ id: "WF_DRYRUN", says });

function dryStep(wf, scope, id) {
  const step = stepOf(wf, id);
  const input = inputFor(step, scope);
  const out = outputsOf(step, answerFor(step));
  scope.outputs.set(id, out.values);
  return [...(input.ok ? [] : [dryFinding(`step ${id} could not bind ${input.missing.join(", ")} when it ran`)]), ...out.missing.map((n) => dryFinding(`step ${id}: output ${n} cannot be read as its type — two outputs read one path as two things`))];
}

export function dryRunFindings(wf) {
  const order = orderOf(wf);
  if (!order) return [dryFinding("its steps have no order to run in")];
  const scope = { context: { objective: "x", ref: "x" }, outputs: new Map() };
  return order.flatMap((id) => dryStep(wf, scope, id));
}
