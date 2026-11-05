// What an ADAPTER declares, version 1, as DATA (ADR 0035).
//
// An adapter is how one family of backend question is asked of one kind of system: the
// messaging operations over some broker, the scheduler operations over some scheduler. It is a
// declaration plus a helper -- a separate program, in any language, using whatever official
// protocol, SDK or CLI that system has -- and the engine reads only the declaration. So the
// declaration says everything the engine reasons with: the family, the transport tokens it
// serves (matched against what discovery found, never interpreted), the operations it answers
// with the effects each can have and the meanings each output field carries, the semantics of
// the system behind it, its limits, how its helper is launched and which conformance kit
// proves it. A support level is never declared: it is computed from the kit's receipts
// (src/adapters/matrix.mjs).
import { HELPER_FIELDS, helperFindings } from "../capability/helper.mjs";
import { constraintFindings, missingFindings } from "../constraints.mjs";
import { meaningAt, meaningEntries } from "../topology/vocab.mjs";
import { walkFindings } from "../walk.mjs";
import { EFFECT_IDS, FAMILY_IDS, familyOf, operationOf } from "./families.mjs";
import { semanticsFindings } from "./semantics.mjs";

export const ADAPTER_API = "orbit.adapter/v1";
export const SUPPORTED_ADAPTER_APIS = [ADAPTER_API];

// Namespaced like a capability: `<transport-ish>.<name>`, two segments at least.
export const ADAPTER_ID = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;
export const TRANSPORT_TOKEN = /^[a-z][a-z0-9.+-]{0,47}$/;

export const ADAPTER_FIELDS = {
  id: { type: "string", pattern: ADAPTER_ID.source, doc: "Namespaced name, e.g. queue.reference. Two segments at least." },
  apiVersion: { type: "string", enum: SUPPORTED_ADAPTER_APIS, doc: "Which published contract this was written against." },
  version: { type: "string", doc: "The adapter's own version. A conformance receipt is for one version and one fingerprint." },
  doc: { type: "string", doc: "One line: what this adapter reaches and how." },
  family: { type: "string", enum: FAMILY_IDS, doc: "The family of operation it answers (src/adapters/families.mjs)." },
  transports: { type: "array", items: { type: "string" }, minItems: 1, doc: "The transport tokens it serves, as discovery spells them. Matched, never interpreted." },
  operations: { type: "object", minProperties: 1, additionalProperties: { $ref: "#/definitions/operation" }, doc: "The family operations it answers, by name." },
  semantics: { type: "object", doc: "How the system behind it behaves, in the semantics vocabulary (catalog/semantics.json and its layers). \"unknown\" is always allowed and never a default." },
  limits: { $ref: "#/definitions/limits", doc: "Its own ceilings. The effective limit is the narrowest of policy, grant, these and the run budget left." },
  helper: { $ref: "#/definitions/helper", doc: "How its helper program is launched. An argument list, never a shell line." },
  conformance: { $ref: "#/definitions/conformance", doc: "Which conformance kit proves it, with the parameters the kit needs." },
  bind: { type: "object", doc: "How the resources it OWNS for a run are named -- an observer, a fixture -- as templates over {ns}, {alias} and the bound channel's own fields ({channel.<field>}); the sandbox's binder fills them (src/runtime/sandbox/bindings.mjs)." },
};

export const ADAPTER_REQUIRED = ["id", "apiVersion", "version", "doc", "family", "transports", "operations", "helper"];

export const OPERATION_FIELDS = {
  effects: { type: "array", items: { type: "string" }, doc: "What this operation does to the world, from the family's allowed effects." },
  outputs: { type: "object", doc: "Each output field it answers with, and the meaning it carries (src/topology/vocab.mjs MEANINGS)." },
  op: { type: "string", pattern: "^[a-z][a-z0-9.-]{0,47}$", doc: "The operation name the helper is asked, when it differs from the family's." },
  limits: { $ref: "#/definitions/limits", doc: "Ceilings for this operation alone." },
  doc: { type: "string", doc: "What this operation does on this system, in one line." },
  request: { type: "object", additionalProperties: { $ref: "#/definitions/requestField" }, doc: "What its request may carry: one row per field its helper reads (ADR 0052). Optional -- absent, a request is held to nothing until its helper reads it; declared, one that names a field it does not is refused where a design is made." },
};

// What one field of a request may be (0.5.0, ADR 0052): what a table says may be SENT, never what to send -- so no
// default, no example, no value. An object's own keys are rows of their own; with none declared, any key.
export const REQUEST_TYPES = ["string", "integer", "number", "boolean", "object", "array"];

// What a MATCH picks of what an operation reads (0.5.0): `answer` -- only the items that carry every one of its fields
// are answered; `count` -- every item read is answered, and the ones that carry every one of its fields are what the
// request's `count` counts before the wait ends. With `means` on each of its fields, this is what a design is held to
// when an assertion rules on the very field its own match names (src/qa/backend/contradictions.mjs).
export const MATCH_SELECTS = ["answer", "count"];

export const REQUEST_FIELD_FIELDS = {
  doc: { type: "string", doc: "What the field tells the helper, in one line." },
  type: { type: "string", enum: REQUEST_TYPES, doc: "Its JSON type. Absent: any value -- what `doc` says it is (a body, a text or a number)." },
  enum: { type: "array", minItems: 1, doc: "The only values it takes." },
  pattern: { type: "string", doc: "A pattern a text value matches." },
  minimum: { type: "number", doc: "The least a number may be." },
  maximum: { type: "number", doc: "The most a number may be." },
  required: { type: "boolean", doc: "The operation is never asked without it." },
  fields: { type: "object", additionalProperties: { $ref: "#/definitions/requestField" }, doc: "An object's own keys, each a row of its own. Absent: any key." },
  means: { type: "string", doc: "For a field a match compares: the meaning (src/topology/vocab.mjs MEANINGS, or a sub-path of one) of the answered item's field it is compared with. Absent: unknown, and nothing is concluded from it." },
  selects: { type: "string", enum: MATCH_SELECTS, doc: "For a match: answer -- only the items that carry every one of its fields are answered; count -- every item read is answered, and those that carry every one are what count counts before the wait ends. Absent: unknown." },
};

export const LIMIT_FIELDS = {
  timeoutMs: { type: "integer", minimum: 1, doc: "The longest one call may take." },
  requestBytes: { type: "integer", minimum: 1, doc: "The largest request it accepts." },
  answerBytes: { type: "integer", minimum: 1, doc: "The largest answer it may return." },
  rate: { type: "number", minimum: 0, doc: "Calls per second at most." },
  concurrency: { type: "integer", minimum: 1, doc: "Calls in flight at most." },
};

export const CONFORMANCE_FIELDS = {
  kit: { type: "string", enum: FAMILY_IDS, doc: "The family kit that proves it." },
  params: { type: "object", doc: "What the kit needs to know about this system: the witness command, the resource names it may create." },
};

export const DEFINITIONS = {
  operation: { table: OPERATION_FIELDS, required: [] },
  limits: { table: LIMIT_FIELDS, required: [] },
  helper: { table: HELPER_FIELDS, required: ["argv"] },
  conformance: { table: CONFORMANCE_FIELDS, required: ["kit"] },
  requestField: { table: REQUEST_FIELD_FIELDS, required: ["doc"] },
};

// The whole declaration, judged before anything registers: the table's own rules, then the
// rules ACROSS fields the table cannot say. `vocab` is the semantics vocabulary in effect.
export function declarationFindings(decl, vocab, at = decl?.id ?? "adapter") {
  if (!decl || typeof decl !== "object" || Array.isArray(decl)) return { problems: [`${at}: an adapter declaration is an object`], undeclared: [] };
  const sem = semanticsFindings(vocab, decl.semantics, at);
  const problems = [...walkFindings(DEFINITIONS, ADAPTER_FIELDS, ADAPTER_REQUIRED, decl, at), ...crossFindings(decl, at), ...sem.problems];
  return { problems, undeclared: sem.undeclared };
}

const crossFindings = (decl, at) => CROSS.flatMap((rule) => rule(decl, at));

const CROSS = [
  (d, at) => (Array.isArray(d.transports) ? d.transports : []).filter((t) => typeof t !== "string" || !TRANSPORT_TOKEN.test(t)).map((t) => `${at}: transport "${String(t).slice(0, 48)}" is not a token`),
  (d, at) => Object.keys(isTable(d.operations) ? d.operations : {}).filter((name) => familyOf(d.family) && !rowOf(d, name)).map((name) => `${at}: ${name} is not an operation of the ${d.family} family, nor ${SHARED.join(".<op> or ")}.<op> for a resource it owns`),
  (d, at) => operationEntries(d).flatMap(([name, o]) => effectFindings(d, name, o, at)),
  (d, at) => operationEntries(d).flatMap(([name, o]) => outputFindings(name, o, at)),
  (d, at) => operationEntries(d).flatMap(([name, o]) => patternFindings(o?.request, `${at}: ${name} request`)),
  (d, at) => operationEntries(d).flatMap(([name, o]) => requestMeaningFindings(o?.request, `${at}: ${name} request`)),
  (d, at) => helperFindings(d.helper, at),
];

const isTable = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

// The families any adapter serves FOR the resources it owns: an observer it armed is awaited
// through it, and the fixture resources it created are prepared and cleaned up through it. Named
// as `<family>.<op>` (observe.await, fixture.cleanup) beside its own family's operations.
export const SHARED = ["observe", "fixture"];

export function rowOf(d, name) {
  const own = operationOf(d.family, name);
  if (own || !String(name).includes(".")) return own;
  const [family, op] = String(name).split(".");
  return SHARED.includes(family) ? operationOf(family, op) : null;
}

const operationEntries = (d) => Object.entries(isTable(d.operations) ? d.operations : {}).filter(([name]) => rowOf(d, name));

function effectFindings(d, name, o, at) {
  const allowed = rowOf(d, name).effects;
  const effects = Array.isArray(o?.effects) ? o.effects : [];
  return effects.filter((e) => !EFFECT_IDS.includes(e) || !allowed.includes(e)).map((e) => `${at}: ${name} may not declare effect "${e}" — it allows ${allowed.join(", ")}`);
}

// An output field carries a meaning, or -- for a list -- each item's fields do: `{ each: {...} }`.
const outputFindings = (name, o, at) => meaningEntries(o?.outputs).filter(([, means]) => !meaningAt(String(means))).map(([field, means]) => `${at}: ${name} output ${field} means "${means}", which is not a meaning (src/topology/vocab.mjs)`);

// ── what a request may carry (0.5.0, ADR 0052) ─────────────────────────────

// Every row of a request table, an object's own keys included, by where it is.
const rowsOf = (table, at) => Object.entries(isTable(table) ? table : {}).flatMap(([k, row]) => [[`${at}.${k}`, row], ...rowsOf(row?.fields, `${at}.${k}`)]);

// A pattern is compiled when a request is held to it, so one that does not compile is refused before anything registers.
const patternFindings = (table, at) => rowsOf(table, at).filter(([, row]) => typeof row?.pattern === "string" && !compiles(row.pattern)).map(([where, row]) => `${where}: pattern ${String(row.pattern).slice(0, 60)} is not one a request can be held to`);

// What a match field is compared with is a meaning, as an output's is, so a rule that reads it reasons over the vocabulary.
const requestMeaningFindings = (table, at) => rowsOf(table, at).filter(([, row]) => row?.means !== undefined && !meaningAt(String(row.means))).map(([where, row]) => `${where} means "${String(row.means).slice(0, 60)}", which is not a meaning (src/topology/vocab.mjs)`);

function compiles(pattern) {
  try { return new RegExp(pattern) instanceof RegExp; }
  catch { return false; }
}

// A request held to the table its operation declares: a field the table does not name is refused, saying the ones it
// reads; a required one missing is named; each one it names is held to its own row (src/constraints.mjs, the one leaf
// every table's constraints are enforced by); an object's own keys to its `fields`, when its row declares them. An
// operation that declares no table is held to nothing here -- its helper still refuses, at run time, what it cannot do.
// The QA generation port asks it of every step a design makes (skills/orbit-qa/ports.mjs).
export function requestFindings(table, request, at) {
  if (!isTable(table)) return [];
  const r = isTable(request) ? request : {};
  return [...unknownIn(table, r, at), ...missingFindings(requiredIn(table), r, at), ...constraintFindings(table, r, at), ...Object.entries(table).flatMap(([k, row]) => nestedIn(row, r[k], `${at} ${k}`))];
}

const unknownIn = (table, r, at) => Object.keys(r).filter((k) => !Object.hasOwn(table, k)).map((k) => `${at}: unknown field "${k}" — it reads ${Object.keys(table).join(", ") || "nothing"}`);

const requiredIn = (table) => Object.keys(table).filter((k) => table[k]?.required === true);

const nestedIn = (row, value, at) => (isTable(row?.fields) && isTable(value) ? requestFindings(row.fields, value, at) : []);

