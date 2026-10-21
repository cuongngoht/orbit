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
import { meaningAt } from "../topology/vocab.mjs";
import { walkFindings } from "../walk.mjs";
import { EFFECT_IDS, FAMILY_IDS, familyOf, operationOf } from "./families.mjs";
import { semanticsFindings } from "./semantics.mjs";

export const ADAPTER_API = "orbit.adapter/v1";
export const SUPPORTED_ADAPTER_APIS = [ADAPTER_API];

// Namespaced like a capability: `<transport-ish>.<name>`, two segments at least.
export const ADAPTER_ID = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;
export const TRANSPORT_TOKEN = /^[a-z][a-z0-9.+-]{0,47}$/;
// A digest-pinned image reference: anything that could move under a tag is refused.
export const PINNED_IMAGE = "^[^\\s@]+@sha256:[0-9a-f]{64}$";

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
};

export const ADAPTER_REQUIRED = ["id", "apiVersion", "version", "doc", "family", "transports", "operations", "helper"];

export const OPERATION_FIELDS = {
  effects: { type: "array", items: { type: "string" }, doc: "What this operation does to the world, from the family's allowed effects." },
  outputs: { type: "object", doc: "Each output field it answers with, and the meaning it carries (src/topology/vocab.mjs MEANINGS)." },
  op: { type: "string", pattern: "^[a-z][a-z0-9.-]{0,47}$", doc: "The operation name the helper is asked, when it differs from the family's." },
  limits: { $ref: "#/definitions/limits", doc: "Ceilings for this operation alone." },
  doc: { type: "string", doc: "What this operation does on this system, in one line." },
};

export const LIMIT_FIELDS = {
  timeoutMs: { type: "integer", minimum: 1, doc: "The longest one call may take." },
  requestBytes: { type: "integer", minimum: 1, doc: "The largest request it accepts." },
  answerBytes: { type: "integer", minimum: 1, doc: "The largest answer it may return." },
  rate: { type: "number", minimum: 0, doc: "Calls per second at most." },
  concurrency: { type: "integer", minimum: 1, doc: "Calls in flight at most." },
};

export const HELPER_FIELDS = {
  argv: { type: "array", items: { type: "string" }, minItems: 1, doc: "The program and its arguments. The first is a path inside the adapter's own directory or a tool name; never an absolute path, never a shell line." },
  runIn: { enum: ["host", "worker", "image"], doc: "Where it runs: on this machine, inside the task's isolated worker, or in its own pinned image on the task's network." },
  image: { type: "string", pattern: PINNED_IMAGE, doc: "The digest-pinned image it runs in, when runIn is image. Trusted by fingerprint in Orbit Control." },
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
  (d, at) => Object.keys(isTable(d.operations) ? d.operations : {}).filter((name) => familyOf(d.family) && !operationOf(d.family, name)).map((name) => `${at}: ${name} is not an operation of the ${d.family} family`),
  (d, at) => operationEntries(d).flatMap(([name, o]) => effectFindings(d, name, o, at)),
  (d, at) => operationEntries(d).flatMap(([name, o]) => outputFindings(name, o, at)),
  (d, at) => helperFindings(d.helper, at),
];

const isTable = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

const operationEntries = (d) => Object.entries(isTable(d.operations) ? d.operations : {}).filter(([name]) => operationOf(d.family, name));

function effectFindings(d, name, o, at) {
  const allowed = operationOf(d.family, name).effects;
  const effects = Array.isArray(o?.effects) ? o.effects : [];
  return effects.filter((e) => !EFFECT_IDS.includes(e) || !allowed.includes(e)).map((e) => `${at}: ${name} may not declare effect "${e}" — ${d.family}.${name} allows ${allowed.join(", ")}`);
}

const outputFindings = (name, o, at) => Object.entries(isTable(o?.outputs) ? o.outputs : {}).filter(([, means]) => !meaningAt(String(means))).map(([field, means]) => `${at}: ${name} output ${field} means "${means}", which is not a meaning (src/topology/vocab.mjs)`);

function helperFindings(h, at) {
  if (!isTable(h) || !Array.isArray(h.argv)) return [];
  const first = String(h.argv[0] ?? "");
  const where = /^([/\\]|[A-Za-z]:)/.test(first) || first.split(/[/\\]/).includes("..") ? [`${at}: helper.argv[0] "${first.slice(0, 60)}" leaves the adapter's directory — an absolute path or .. is refused`] : [];
  return [...where, ...(h.runIn === "image" && !h.image ? [`${at}: helper.runIn is image and no image is pinned`] : []), ...h.argv.filter((a) => /[\0\n\r]/.test(String(a))).map(() => `${at}: helper.argv holds a control character`)];
}
