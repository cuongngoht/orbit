// The EFFECTIVE vocabulary: core plus whatever this project's extensions added,
// and the one place anything derived from it is computed.
//
// Why this exists. The tables in core/ answer "what does the engine understand".
// A consuming project may need one more thing -- a step field, very rarely a verb
// -- and the only way to get it used to be to edit core/verbs.mjs inside the
// installed plugin, which the next upgrade overwrites. So the tables stayed the
// engine's, and a REGISTRY over them became the thing everyone asks. Core seeds
// it; a project's extensions register into a copy of it; the schema, the
// validator, the interpolator and the runner all read the same copy. There is
// still exactly one answer to "is `foo` a verb", it is just no longer a constant.
//
// Registration is deterministic and it REFUSES rather than overwrites: a second
// definition of a name is two stories about one word, and last-one-wins picks
// whichever module happened to load second.
//
// LAYERS is the one thing extensions may NOT extend, and the reason is
// arithmetic. A layer is a denominator: src/qa/coverage.mjs divides by it and
// src/report/ prints a column per layer. A project that could invent a fourth
// would change what every ratio in every other project's report MEANS. So the
// set is core's, an extension verb ruling on a layer must name one that exists,
// and `call` -- the extension point a provider actually reaches for -- proves
// whichever of the three it was pointed at.
import { constraintFindings, missingFindings } from "../constraints.mjs";
import { Refused } from "../errors.mjs";
import { ESCAPERS } from "./escape.mjs";
import { CORE_COMMON_FIELDS, CORE_LITERAL_FIELDS, CORE_STEP_FIELDS } from "./core/fields.mjs";
import { CORE_LAYERS, CORE_VERBS } from "./core/verbs.mjs";

// Computed in core/verbs.mjs, because a field row needs it too. Re-exported here
// because this is where everything else asks.
export const LAYERS = CORE_LAYERS;

// A screenshot is evidence for exactly one layer -- the one whose subject IS the
// screen. Named with the vocabulary so the run loop can ask "is this worth
// photographing?" without naming a layer or a verb itself.
export const SCREEN_LAYER = "ui";

export const noneProved = () => Object.fromEntries(LAYERS.map((l) => [l, 0]));

const KINDS = ["act", "observe", "control", "verdict"];

// What a verb ROW is, declared the way a case field is, so a malformed extension
// becomes a sentence instead of a TypeError six frames into a run.
const VERB_DEF = {
  name: { type: "string", pattern: "^[a-z][a-z0-9-]*$" },
  kind: { type: "string", enum: KINDS },
  doc: { type: "string" },
  needs: { type: "array" },
  fields: { type: "array", items: { type: "string" } },
  verdict: { type: "string", enum: ["always", "expect"] },
  proves: { type: "string", enum: LAYERS },
  provesStep: { type: "boolean" },
  requests: { type: "string", enum: ["mark", "since"] },
  changes: { type: "boolean" },
  navigates: { type: "boolean" },
  switchesIdentity: { type: "boolean" },
  pageless: { type: "boolean" },
};
const VERB_REQUIRED = ["name", "kind", "doc", "needs", "fields"];

const FIELD_DEF = {
  type: { type: "string", enum: ["string", "integer", "number", "boolean", "object", "array"] },
  doc: { type: "string" },
  esc: { type: "string", enum: Object.keys(ESCAPERS) },
  literal: { type: "boolean" },
};
const FIELD_REQUIRED = ["doc"];

export function createDslRegistry() {
  const s = seeded();
  return { ...reads(s), ...writes(s) };
}

const seeded = () => ({
  verbs: [...CORE_VERBS],
  byName: new Map(CORE_VERBS.map((v) => [v.name, v])),
  fields: { ...CORE_STEP_FIELDS },
  literal: new Set(CORE_LITERAL_FIELDS),
  from: new Map(),
});

const reads = (s) => ({
  verbs: () => s.verbs,
  verb: (name) => s.byName.get(name),
  verbNames: () => s.verbs.map((v) => v.name),
  has: (name) => s.byName.has(name),
  fields: () => s.fields,
  field: (name) => s.fields[name],
  fieldNames: () => Object.keys(s.fields),
  commonFields: () => CORE_COMMON_FIELDS,
  literalFields: () => s.literal,
  escOf: (name) => s.fields[name]?.esc ?? "text",
  ownersOf: (f) => s.verbs.filter((v) => v.fields.includes(f)).map((v) => v.name),
  verbsWhere: (k, value = true) => new Set(s.verbs.filter((v) => v[k] === value).map((v) => v.name)),
  layers: () => LAYERS,
  isVerdict: (step) => isVerdictIn(s, step),
  provedBy: (step) => provedIn(s, step),
  showsScreen: (step) => provedIn(s, step) === SCREEN_LAYER,
  // WHO put a name here. A `check` that can only say "unknown verb" cannot tell
  // somebody their extension failed to load from somebody else's typo.
  sourceOf: (name) => s.from.get(name) ?? (s.byName.has(name) || name in s.fields ? "core" : null),
  added: () => [...s.from.entries()].map(([name, from]) => ({ name, from })),
});

const writes = (s) => ({
  registerVerb: (def, from) => addVerb(s, def, from),
  registerField: (name, def, from) => addField(s, name, def, from),
});

function isVerdictIn(s, step) {
  const v = s.byName.get(step?.do);
  if (!v?.verdict) return false;
  return v.verdict === "always" || Boolean(step.expect);
}

// Which layer this step actually ruled on, or null when it ruled on nothing: a
// `report` without `expect` records a value and proves no more than a comment.
//
// A row saying `provesStep` hands the answer to the STEP, because the row cannot
// know it -- `call postgres.query` is the data underneath, `call msgraph…` after
// a click may be the call the screen made, and the same capability can be either.
// The field is enum-constrained to LAYERS, so this can still only ever return one
// of the three.
function provedIn(s, step) {
  if (!isVerdictIn(s, step)) return null;
  const verb = s.byName.get(step.do);
  return (verb.provesStep ? step.proves : verb.proves) ?? null;
}

function addVerb(s, def, from) {
  const bad = verbProblems(s, def, from);
  if (bad.length) throw new Refused(`${where(from)} cannot add a verb — ${bad.join("; ")}`);
  const row = Object.freeze({ ...def });
  s.verbs = [...s.verbs, row];
  register(s, def.name, row, from);
}

function register(s, name, row, from) {
  s.byName.set(name, row);
  s.from.set(name, from);
}

function verbProblems(s, def, from) {
  if (!isObject(def)) return ["a verb must be an object"];
  const at = `verb "${def.name ?? "?"}"`;
  const shape = [...missingFindings(VERB_REQUIRED, def, at), ...constraintFindings(VERB_DEF, def, at)];
  return [...shape, ...takenProblem(s, def.name, at), ...verdictProblems(def, at), ...knownFieldProblems(s, def, at)];
}

// Core names are protected, and so is another extension's: the engine refuses to
// be the place where two definitions of one word are silently reconciled.
function takenProblem(s, name, at) {
  const owner = s.from.get(name) ?? (s.byName.has(name) ? "core" : null);
  if (!owner) return [];
  return [`${at}: already defined by ${owner}`];
}

// A verdict that rules on nothing cannot raise coverage and cannot be reported,
// so it is a row that quietly does not work rather than one that fails loudly.
function verdictProblems(def, at) {
  if (!def.verdict || def.provesStep) return [];
  return def.proves ? [] : [`${at}: declares a verdict but no proves — name one of ${LAYERS.join(", ")}`];
}

// A verb may only need or own fields that EXIST. The alternative is a row
// promising `input` and a schema that never mentions it, which validates clean
// and then hands the executor undefined.
function knownFieldProblems(s, def, at) {
  const named = [...asArray(def.fields), ...asArray(def.needs).flat()];
  const missing = named.filter((f) => typeof f === "string" && !(f in s.fields) && !CORE_COMMON_FIELDS.includes(f));
  return [...new Set(missing)].map((f) => `${at}: names field "${f}", which no table defines`);
}

function addField(s, name, def, from) {
  const bad = fieldProblems(s, name, def, from);
  if (bad.length) throw new Refused(`${where(from)} cannot add a field — ${bad.join("; ")}`);
  s.fields = { ...s.fields, [name]: def };
  s.from.set(name, from);
  if (def.literal) s.literal.add(name);
}

function fieldProblems(s, name, def, from) {
  if (!isObject(def)) return ["a field must be an object"];
  const at = `field "${name}"`;
  const shape = [...missingFindings(FIELD_REQUIRED, def, at), ...constraintFindings(FIELD_DEF, def, at)];
  return [...shape, ...nameProblems(s, name, at), ...escProblems(def, at)];
}

function nameProblems(s, name, at) {
  if (!/^[a-z][a-zA-Z0-9]*$/.test(String(name))) return [`${at}: a field name is lowerCamelCase`];
  const owner = s.from.get(name) ?? (name in s.fields ? "core" : null);
  return owner ? [`${at}: already defined by ${owner}`] : [];
}

// The rule escape.mjs states: a value spliced into text something else
// INTERPRETS has to declare which language, or it goes in raw. An extension
// field is interpolated unless it says it names something, so the declaration is
// required of exactly the fields that reach an interpreter.
function escProblems(def, at) {
  if (def.literal || def.type !== "string") return [];
  return def.esc ? [] : [`${at}: an interpolated string field must declare esc (${Object.keys(ESCAPERS).join(" | ")}) — or literal: true if it names something`];
}

const where = (from) => (from ? `${from}:` : "this caller:");
const asArray = (v) => (Array.isArray(v) ? v : []);
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

// The registry the ENGINE itself reasons through -- core and nothing else. What
// a project added lives on its own registry, built by the composition root and
// carried on ctx, so two projects in one process cannot see each other's words.
export const CORE = createDslRegistry();
