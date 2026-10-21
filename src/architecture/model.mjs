// Making one architecture fact, and holding it to the table that declares it.
//
// `makeFact` is the ONLY constructor, the way `makeLesson` and `makeNote` are
// the only constructors of the things they make. Everything a fact carries that
// is not a judgement -- when, against which commit, what the scope hashed to,
// whether it still holds -- is STAMPED here rather than asked for, so a
// candidate arriving from an agent cannot claim to have been checked by filling
// a field in.
//
// `verifiedAgainstSource` is the sharpest case and is not a field at all. It is
// read off the fact's `source` row, so "this came out of somebody's memory" can
// never be promoted to "this was checked against the code" by writing a boolean.
import { constraintFindings, missingFindings } from "../constraints.mjs";
import { short } from "../hash.mjs";
import { scrubFact } from "../scrub.mjs";
import { FACT_FIELDS, REQUIRED, allowedOn, misplacedOn } from "./fields.mjs";
import { graphFactFindings } from "./relations.mjs";
import { KIND_NAMES, kindsWith, verifiedBy } from "./vocab.mjs";

export const MODEL_VERSION = 1;

// Two facts with the same kind and key are ONE fact said twice. Deriving the id
// from the subject rather than from the wording is what lets a rescan rewrite a
// file instead of leaving the old sentence beside the new one -- the lesson
// store's rule, for the same reason.
export const factId = (f) => `arch-${f.kind}-${short(`${f.kind}\u0000${f.key}`)}`;

export function factFindings(raw, where = "fact") {
  if (!isObject(raw)) return [`${where}: must be a JSON object`];
  const shape = [...missingFindings(REQUIRED, raw, where), ...constraintFindings(FACT_FIELDS, raw, where)];
  return [...shape, ...extraFindings(raw, where), ...graphFactFindings(raw, where)];
}

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

// A field that exists but belongs to another kind reads differently from one
// nobody ever declared: the first is a misunderstanding about what this fact is,
// the second is a typo. The DSL already separates them for that reason.
function extraFindings(raw, where) {
  const allowed = KIND_NAMES.includes(raw.kind) ? allowedOn(raw.kind) : Object.keys(FACT_FIELDS);
  return Object.keys(raw).filter((k) => !allowed.includes(k)).map((k) => said(raw.kind, k, where));
}

const said = (kind, k, where) => (misplacedOn(kind, k) ? `${where}: ${k} belongs to a ${kindsWith(k).join(" or ")} fact, not to a ${kind} one` : `${where}: unknown field "${k}"`);

export function makeFact(raw, deps = {}) {
  const base = { unknowns: [], ...raw };
  const id = raw.id ?? factId(base);
  return scrubFact({ ...base, ...stamps(deps), id });
}

// Dropped when absent rather than written as null: the field table says these
// are strings, and a null would be a value nobody declared sitting in a record
// that claims to have been validated.
function stamps(deps) {
  const all = { at: deps.now?.() ?? new Date().toISOString(), commit: deps.commit, fingerprint: deps.fingerprint, status: deps.status ?? "unknown" };
  return Object.fromEntries(Object.entries(all).filter(([, v]) => v !== undefined && v !== null));
}

// Asked of the TABLE, never of the fact. A caller writing
// `fact.source !== "claude-memory"` would be one row away from being wrong.
export const verifiedAgainstSource = (fact) => verifiedBy(fact?.source);

// What the store keeps ABOUT the facts, as opposed to the facts themselves:
// which commit the last scan saw, and what each scope hashed to then. Separate
// file, separate damage rule -- a torn state file costs a rescan, a torn fact
// costs one fact.
export const emptyModel = (now) => ({ v: MODEL_VERSION, at: now, commit: null, roots: [], scopes: {}, scans: [] });

// A state file this version cannot read is treated as ABSENT and said so, never
// repaired and never silently trusted. The bad file is left exactly where it is:
// whoever has to work out what happened needs it more than we need the space.
export function usableModel(raw) {
  if (!isObject(raw)) return { model: null, why: "the architecture state file is not a JSON object" };
  if (raw.v !== MODEL_VERSION) return { model: null, why: `the architecture state was written by schema v${raw.v ?? "?"} and this engine reads v${MODEL_VERSION}` };
  return { model: raw, why: null };
}
