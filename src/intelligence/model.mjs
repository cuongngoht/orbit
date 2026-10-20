// Making one project intelligence fact, and holding it to the table that
// declares it -- src/architecture/model.mjs's discipline for a third subject.
//
// `makeFact` is the only constructor. What is not a judgement -- when, against
// which commit, what the scope hashed to, whether it still holds -- is STAMPED
// here, never asked for. The id is derived from kind and key, so re-deriving a
// fact rewrites one file instead of appending its twin.
import { constraintFindings, missingFindings } from "../constraints.mjs";
import { short } from "../hash.mjs";
import { scrubIntelligence } from "../scrub.mjs";
import { splitPath } from "../frontend/composite.mjs";
import { FACT_FIELDS, REQUIRED, allowedOn, misplacedOn } from "./fields.mjs";
import { KIND_NAMES, kindsWith, verifiedBy } from "./vocab.mjs";

export const MODEL_VERSION = 1;

export const factId = (f) => `intel-${f.kind}-${short(`${f.kind}\u0000${f.key}`)}`;

export function factFindings(raw, where = "fact") {
  if (!isObject(raw)) return [`${where}: must be a JSON object`];
  const allowed = KIND_NAMES.includes(raw.kind) ? allowedOn(raw.kind) : Object.keys(FACT_FIELDS);
  const extra = Object.keys(raw).filter((k) => !allowed.includes(k)).map((k) => (misplacedOn(raw.kind, k) ? `${where}: ${k} belongs to a ${kindsWith(k).join(" or ")} fact, not to a ${raw.kind} one` : `${where}: unknown field "${k}"`));
  return [...missingFindings(REQUIRED, raw, where), ...constraintFindings(FACT_FIELDS, raw, where), ...extra];
}

export function makeFact(raw, deps = {}) {
  const base = { unknowns: [], ...raw };
  return scrubIntelligence({ ...base, ...stamps(deps), id: factId(base) });
}

function stamps(deps) {
  const all = { at: deps.now?.() ?? new Date().toISOString(), commit: deps.commit, fingerprint: deps.fingerprint, status: deps.status ?? "unknown" };
  return Object.fromEntries(Object.entries(all).filter(([, v]) => v !== undefined && v !== null));
}

export const verifiedAgainstSource = (fact) => verifiedBy(fact?.source);

// Which checkout a path belongs to, as a fact records it: `.` for the primary,
// the alias for any other. src/frontend/composite.mjs owns the path language;
// this is only its label.
export const rootOf = (path) => splitPath(path).prefix.replace(/::$/, "") || ".";

export const prefixOf = (path) => splitPath(path).prefix;

// The bookkeeping beside the facts: what each scope hashed to, which
// manifests the last scan saw, and which directories it swept for usage. A torn
// state file costs a rescan; a torn fact costs one fact.
export const emptyModel = (now) => ({ v: MODEL_VERSION, at: now, commit: null, scopes: {}, manifests: [], sweeps: [], swept: [] });

export function usableModel(raw) {
  if (!isObject(raw)) return { model: null, why: "the intelligence state file is not a JSON object" };
  if (raw.v !== MODEL_VERSION) return { model: null, why: `the intelligence state was written by schema v${raw.v ?? "?"} and this engine reads v${MODEL_VERSION}` };
  return { model: raw, why: null };
}

export const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
