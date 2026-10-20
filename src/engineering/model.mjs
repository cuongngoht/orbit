// Making one engineering fact, and holding it to the table that declares it.
//
// `makeFact` is the ONLY constructor -- src/architecture/model.mjs's same rule.
// Everything that is not a judgement -- when, against which commit, what the
// scope hashed to, whether it still holds, how much evidence actually backs it
// -- is STAMPED here rather than asked for, so a candidate arriving from an
// observer agent cannot claim to have been checked, or repeated, by filling a
// field in.
import { constraintFindings, missingFindings } from "../constraints.mjs";
import { short } from "../hash.mjs";
import { scrubEngineering } from "../scrub.mjs";
import { FACT_FIELDS, REQUIRED, STAMPED, allowedOn, misplacedOn } from "./fields.mjs";
import { KIND_NAMES, kindsWith, verifiedBy } from "./vocab.mjs";

export const MODEL_VERSION = 1;

// Two facts with the same kind and key are ONE fact said twice. Deriving the id
// from the subject rather than from the wording is what lets a rescan rewrite a
// file instead of leaving the old sentence beside the new one.
export const factId = (f) => `eng-${f.kind}-${short(`${f.kind}\u0000${f.key}`)}`;

// `required` is a parameter because a CANDIDATE owes less than a fact does:
// src/engineering/candidate.mjs passes a list without `confidence`, which the
// engine derives rather than asks for.
export function factFindings(raw, where = "fact", required = REQUIRED) {
  if (!isObject(raw)) return [`${where}: must be a JSON object`];
  const shape = [...missingFindings(required, raw, where), ...constraintFindings(FACT_FIELDS, raw, where)];
  return [...shape, ...extraFindings(raw, where)];
}

export const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

// `support`/`lastSeenBy`/`fingerprint` are declared fields (the schema needs a
// type for them) but never a candidate's to set -- unlike an undeclared field,
// they would otherwise pass `allowed.includes(k)` silently. A candidate
// stamping its own `support` is exactly how one submission could fake the two
// independent sessions `reconcile.mjs` requires for `certain`.
function extraFindings(raw, where) {
  const allowed = KIND_NAMES.includes(raw.kind) ? allowedOn(raw.kind) : Object.keys(FACT_FIELDS);
  const extra = Object.keys(raw).filter((k) => !allowed.includes(k)).map((k) => said(raw.kind, k, where));
  const stamped = Object.keys(raw).filter((k) => STAMPED.includes(k)).map((k) => `${where}: "${k}" is stamped by the store or by reconciliation, not supplied by a candidate`);
  return [...extra, ...stamped];
}

const said = (kind, k, where) => (misplacedOn(kind, k) ? `${where}: ${k} belongs to a ${kindsWith(k).join(" or ")} fact, not to a ${kind} one` : `${where}: unknown field "${k}"`);

// The id is ALWAYS derived, never read off `raw`: a supplied id that did not
// match kind and key was a way to overwrite some other fact entirely.
export function makeFact(raw, deps = {}) {
  const base = { unknowns: [], ...raw };
  return scrubEngineering({ ...base, ...stamps(deps), id: factId(base) });
}

// Dropped when absent rather than written as null: the field table says these
// are typed values, and a null would be a value nobody declared sitting in a
// record that claims to have been validated.
function stamps(deps) {
  const all = { at: deps.now?.() ?? new Date().toISOString(), commit: deps.commit, fingerprint: deps.fingerprint, status: deps.status ?? "unknown", support: deps.support };
  return Object.fromEntries(Object.entries(all).filter(([, v]) => v !== undefined && v !== null));
}

// What freshness WATCHES for a fact: its scope, plus the gate files that make an
// `enforced` fact enforced. A gate that moves or disappears is exactly what
// should send an enforced fact back for revalidation -- as `stale`/`unknown`,
// never as a demoted strength.
export const watched = (fact) => [...new Set([...(fact?.scope ?? []), ...(fact?.enforcedBy ?? [])])];

// Asked of the TABLE, never of the fact -- src/architecture/model.mjs's same
// guard against a candidate promoting itself by writing a boolean.
export const verifiedAgainstSource = (fact) => verifiedBy(fact?.source);

// What the store keeps ABOUT the facts, as opposed to the facts themselves.
export const emptyModel = (now) => ({ v: MODEL_VERSION, at: now, commit: null, roots: [], scopes: {}, scans: [] });

export function usableModel(raw) {
  if (!isObject(raw)) return { model: null, why: "the engineering state file is not a JSON object" };
  if (raw.v !== MODEL_VERSION) return { model: null, why: `the engineering state was written by schema v${raw.v ?? "?"} and this engine reads v${MODEL_VERSION}` };
  return { model: raw, why: null };
}
