// Making one runtime fact, and holding it to the table that declares it.
//
// `makeFact` is the ONLY constructor, as it is for every other kind of fact
// here. Everything a fact carries that is not a judgement -- when, against which
// commit, which checkout, what its scope hashed to, whether it still holds -- is
// STAMPED here rather than asked for, so a candidate arriving from an agent
// cannot claim to have been checked by filling a field in.
import { constraintFindings, missingFindings } from "../constraints.mjs";
import { short } from "../hash.mjs";
import { scrubRuntime } from "../scrub.mjs";
import { FACT_FIELDS, REQUIRED, STAMPED, allowedOn, misplacedOn } from "./fields.mjs";
import { KIND_NAMES, kindsWith, verifiedBy } from "./vocab.mjs";

export const MODEL_VERSION = 1;

// Two facts with the same kind and key are ONE fact said twice. The id is
// derived from the subject, never the wording, so a re-read rewrites a file
// instead of leaving the old sentence beside the new one.
export const factId = (f) => `rt-${f.kind}-${short(`${f.kind}\u0000${f.key}`)}`;

export function factFindings(raw, where = "fact") {
  if (!isObject(raw)) return [`${where}: must be a JSON object`];
  const shape = [...missingFindings(REQUIRED, raw, where), ...constraintFindings(FACT_FIELDS, raw, where)];
  return [...shape, ...extraFindings(raw, where)];
}

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

// A field that exists but belongs to another kind reads differently from one
// nobody declared: the first is a misunderstanding about what this fact is, the
// second is a typo.
function extraFindings(raw, where) {
  const allowed = KIND_NAMES.includes(raw.kind) ? allowedOn(raw.kind) : Object.keys(FACT_FIELDS);
  return Object.keys(raw).filter((k) => !allowed.includes(k)).map((k) => said(raw.kind, k, where, KIND_NAMES.includes(raw.kind) ? allowed : null));
}

// A typo is easier to correct when the sentence says what the kind CAN say -- which is not what the
// engine stamps or decides: an id, a time, a commit, a status, where it came from and how sure.
const ENGINE_OWNED = [...STAMPED, "id", "source", "confidence", "argv", "safe"];

const mayCarry = (kind, allowed) => (allowed ? ` (a ${kind} fact may carry: ${allowed.filter((k) => !ENGINE_OWNED.includes(k)).join(", ")})` : "");

const said = (kind, k, where, allowed) => (misplacedOn(kind, k) ? `${where}: ${k} belongs to a ${kindsWith(k).join(" or ")} fact, not to a ${kind} one` : `${where}: unknown field "${k}"${mayCarry(kind, allowed)}`);

export function makeFact(raw, deps = {}) {
  const base = { unknowns: [], ...raw };
  const id = raw.id ?? factId(base);
  return scrubRuntime({ ...base, ...stamps(deps), id });
}

// Dropped when absent rather than written as null: the field table says these
// are strings, and a null would be a value nobody declared sitting in a record
// that claims to have been validated.
function stamps(deps) {
  const all = { at: deps.now?.() ?? new Date().toISOString(), commit: deps.commit, fingerprint: deps.fingerprint, checkout: deps.checkout, status: deps.status ?? "unknown" };
  return Object.fromEntries(Object.entries(all).filter(([, v]) => v !== undefined && v !== null));
}

export const verifiedAgainstSource = (fact) => verifiedBy(fact?.source);

// What the store keeps ABOUT the facts: which commit and branch the last scan
// saw, what each scope hashed to then, which evidence files it read (`inventory`,
// so a file that APPEARS is noticed without reading anything), what read them
// (`readers`, so a new engine re-reads), what it could not settle (`unknowns`) and
// which of those mean something could not be READ at all (`gaps`), and which evidence files were listed
// and read as nothing (`unreadable`): asked again when the commit moves, because a file that was only
// staged is readable once it is committed.
export const emptyModel = (now) => ({ v: MODEL_VERSION, at: now, commit: null, branch: null, scopes: {}, inventory: [], unreadable: [], readers: null, unknowns: [], gaps: [], scans: 0 });

export function usableModel(raw) {
  if (!isObject(raw)) return { model: null, why: "the runtime state file is not a JSON object" };
  if (raw.v !== MODEL_VERSION) return { model: null, why: `the runtime state was written by schema v${raw.v ?? "?"} and this engine reads v${MODEL_VERSION}` };
  return { model: raw, why: null };
}
