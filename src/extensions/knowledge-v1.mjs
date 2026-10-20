// What may be taught to PROJECT KNOWLEDGE, version 1, as data: the shape of a
// relation row and of an interpreter -- whoever offers one.
//
// The knowledge kernel (src/knowledge/) is not allowed to know what any
// relation MEANS. It knows a handful of structural ROLES -- the stages its
// derivation walks from "this changes" to "this is how it is proved" -- and it
// asks for relations by the column a role carries, never by a name. The names
// arrive as rows: Orbit's generic vocabulary (catalog/knowledge.json), an
// organisation's and a project's own files in the machine store, and the
// extensions a project registered. So a relation nobody here has ever heard of
// becomes usable the moment a row gives it a role, and until then it is kept
// and shown and derives nothing.
//
// An INTERPRETER is the procedural half, for what a row cannot say: code an
// extension ships that declares which relations it `understands`, and is handed
// those claims -- frozen copies, never the store -- to return what they imply.
// Pure over what it is given: it reaches nothing, and the engine validates what
// it returns (src/knowledge/interpreters.mjs).
//
// This file sits beside the other published shapes (contract-v1.mjs,
// context-v1.mjs) because the loader must hold an extension to it BEFORE that
// extension registers anything, and the loader may not import the kernel above
// it. The kernel reads its roles from here.
import { constraintFindings, missingFindings } from "../constraints.mjs";

// The stages of a derivation, as columns. `follows`: walked from a changing
// subject, and `marks` names the slot of a proof need the object fills.
// `needs`: the object is a capability id a need is resolved against.
// `concern` keeps what the application DOES apart from HOW it is built and HOW
// it is checked -- three questions a replaced technology must not merge.
export const ROLES = [
  { name: "consequence", follows: true, needs: false, marks: "consequence", concern: "semantics", doc: "the object happens, changes or is produced when the subject does" },
  { name: "implementation", follows: true, needs: false, marks: "implementation", concern: "mechanism", doc: "the object is the mechanism that implements the subject here — how, never what" },
  { name: "observation", follows: true, needs: false, marks: "observation", concern: "verification", doc: "the object is a way to observe that the subject happened" },
  { name: "capability", follows: false, needs: true, marks: null, concern: "verification", doc: "the object is a capability id something needs in order to do or to prove the subject" },
];

// Whether two objects for one subject COMPETE. A relation nobody declared is
// `many`: the engine never infers a conflict its vocabulary does not state.
export const CARDINALITY = [
  { name: "many", competes: false, doc: "a subject may hold any number of objects through it" },
  { name: "one", competes: true, doc: "in one context a subject holds one object through it — two are a conflict to settle" },
];

export const ROLE_NAMES = ROLES.map((r) => r.name);
export const CARDINALITY_NAMES = CARDINALITY.map((c) => c.name);

// A concept, a relation, a context value: lowercase, so a capability id reaches
// the resource registry (which lowercases what a resource provides) unchanged.
export const ID = "^[a-z0-9][a-z0-9._-]{0,95}$";

export const RELATION_FIELDS = {
  id: { type: "string", pattern: ID, doc: "The relation, as claims name it. Lowercase; dots namespace it." },
  role: { enum: ROLE_NAMES, doc: "Which derivation stage it is, if any. None is legal: the relation is kept and shown, and derives nothing." },
  cardinality: { enum: CARDINALITY_NAMES, doc: "`one` when two objects for one subject in one context are a conflict. Default `many`." },
  doc: { type: "string", doc: "One line: what the relation says. Shown quoted, never interpreted." },
};

export const RELATION_REQUIRED = ["id"];

export const INTERPRETER_FIELDS = {
  id: { type: "string", pattern: "^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*)+$", doc: "Namespaced: <extension>.<what it reads>." },
  doc: { type: "string", doc: "One line: what it can tell from the relations it understands." },
  understands: { type: "array", items: { type: "string" }, minItems: 1, doc: "The relation ids it is handed claims of. It sees nothing else." },
};

export const INTERPRETER_REQUIRED = ["id", "doc", "understands"];

export const INTERPRETER_METHODS = ["interpret"];

// A relation row's own problems, out of any context: its shape, and no key
// nobody declared -- in a data file an unknown key is a typo, and a typo in
// `role` would otherwise be a relation that silently derives nothing.
export const relationProblems = (row, at) => shaped(RELATION_FIELDS, RELATION_REQUIRED, row, at);

export function interpreterProblems(row, at) {
  const shape = shaped(INTERPRETER_FIELDS, INTERPRETER_REQUIRED, row, at, INTERPRETER_METHODS);
  const methods = INTERPRETER_METHODS.filter((m) => typeof row?.[m] !== "function").map((m) => `${at}: has no ${m}()`);
  const names = (Array.isArray(row?.understands) ? row.understands : []).filter((r) => !new RegExp(ID).test(String(r))).map((r) => `${at}: understands "${r}", which is not a relation id`);
  return [...shape, ...methods, ...names];
}

function shaped(fields, required, row, at, methods = []) {
  if (!isObject(row)) return [`${at}: must be an object`];
  const unknown = Object.keys(row).filter((k) => !(k in fields) && !methods.includes(k)).map((k) => `${at}: unknown key "${k}"`);
  return [...missingFindings(required, row, at), ...constraintFindings(fields, row, at), ...unknown];
}

// Two rows for one relation MEAN the same when their role and cardinality
// agree; the doc line is prose and may differ.
export const sameMeaning = (a, b) => (a.role ?? null) === (b.role ?? null) && (a.cardinality ?? "many") === (b.cardinality ?? "many");

export const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
