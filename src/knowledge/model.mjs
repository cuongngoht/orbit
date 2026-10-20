// Making one knowledge claim, and holding it to the table that declares it.
//
// `makeClaim` is the ONLY constructor -- every other memory's same rule. Its id
// is DERIVED from what the claim says (subject, relation, object) AND from
// WHEN it says it (the context, in canonical order): the same triple in two
// contexts is two claims, so "in A this, in B that" can never collapse into a
// false global rule by being written to one file. Everything that is not a
// judgement -- when, against which commit, what the scope hashed to -- is
// stamped here, never asked for.
import { constraintFindings, missingFindings } from "../constraints.mjs";
import { short } from "../hash.mjs";
import { scrub, scrubKnowledge } from "../scrub.mjs";
import { CLAIM_FIELDS, DIMENSION, MAX_DIMS, REQUIRED, VALUE } from "./fields.mjs";

export const CLAIM_VERSION = 1;
export const MODEL_VERSION = 1;

export const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

// A context in one order, whatever order it was written in -- or the id would
// depend on how somebody typed it.
export const canonical = (context) => Object.fromEntries(Object.entries(isObject(context) ? context : {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

export const claimId = (c) => `k-${short(JSON.stringify([c.subject, c.relation, c.object, canonical(c.context)]), 12)}`;

export function claimFindings(raw, where = "claim", required = REQUIRED) {
  if (!isObject(raw)) return [`${where}: must be a JSON object`];
  const shape = [...missingFindings(required, raw, where), ...constraintFindings(CLAIM_FIELDS, raw, where)];
  return [...shape, ...unknownFields(raw, where), ...contextFindings(raw.context, where), ...refFindings(raw, where), ...identityFindings(raw, where)];
}

const unknownFields = (raw, where) => Object.keys(raw).filter((k) => !(k in CLAIM_FIELDS)).map((k) => `${where}: unknown field "${k}"`);

function contextFindings(context, where) {
  if (!isObject(context)) return [];
  const entries = Object.entries(context);
  const tooMany = entries.length > MAX_DIMS ? [`${where}: context holds ${entries.length} dimensions — at most ${MAX_DIMS}; a claim that needs more is several claims`] : [];
  return [...tooMany, ...entries.flatMap(([k, v]) => dimensionFindings(k, v, where))];
}

const dimensionFindings = (k, v, where) => [...(new RegExp(DIMENSION).test(k) ? [] : [`${where}: context dimension "${k}" is not a slug`]), ...(typeof v === "string" && new RegExp(VALUE).test(v) ? [] : [`${where}: context ${k} must be a slug value`])];

// Every path a claim names is a path somebody will open, and none may leave the
// checkout or carry a credential: never absolute, never ../, never a URL.
const PATHS = ["evidence", "scope", "enforcedBy"];

const refFindings = (raw, where) => PATHS.flatMap((f) => (Array.isArray(raw[f]) ? raw[f] : []).filter((p) => typeof p === "string" && !safeRef(p)).map((p) => `${where}: ${f} "${p}" must be a repo-relative path — never absolute, never ../, never a URL`));

const safeRef = (p) => !/^([\\/]|[A-Za-z]:[\\/])/.test(p) && !p.split(/[\\/]/).includes("..") && !p.includes("://");

// A claim's subject, relation, object and context ARE its id. One that looks
// like a secret is refused rather than masked: masking it would quietly turn it
// into a different claim.
const identity = (raw) => [raw.subject, raw.relation, raw.object, ...Object.values(isObject(raw.context) ? raw.context : {})].filter((v) => typeof v === "string");

const identityFindings = (raw, where) => identity(raw).filter((v) => scrub(v) !== v).map((v) => `${where}: an identity field looks like a secret (${scrub(v)}) — a claim's subject, relation, object and context are its id, so it is refused, never masked`);

export function makeClaim(raw, deps = {}) {
  const base = { v: CLAIM_VERSION, unknowns: [], layer: "project", ...raw, context: canonical(raw.context) };
  return scrubKnowledge({ ...base, ...stamps(deps), id: claimId(base) });
}

// Dropped when absent rather than written as null: a null would be a value
// nobody declared, sitting in a record that claims to have been validated.
function stamps(deps) {
  const all = { at: deps.now?.() ?? new Date().toISOString(), commit: deps.commit, fingerprint: deps.fingerprint, status: deps.status ?? "unknown" };
  return Object.fromEntries(Object.entries(all).filter(([, v]) => v !== undefined && v !== null));
}

// A `scheme:id` reference the engine stamped (`host:<provider>#<hint>`) rather
// than a path. Two letters at least before ONE colon, so a Windows drive and a
// namespaced `<alias>::path` both read as paths.
export const isReference = (p) => /^[a-z][a-z0-9-]+:(?!:)/.test(String(p));

export const pathsIn = (refs) => (refs ?? []).filter((p) => !isReference(p));

// What freshness WATCHES: the declared scope, or else the paths it cites -- plus
// the gate an enforced claim names, whose moving is what should send it back.
export const watched = (claim) => [...new Set([...((claim.scope ?? []).length ? claim.scope : pathsIn(claim.evidence)), ...(claim.enforcedBy ?? [])])];

// The sentence a reader sees, rendered from the triple, never stored.
export const said = (c) => `${c.subject} ${c.relation} ${c.object}${whenOf(c.context)}`;

export function whenOf(context) {
  const entries = Object.entries(context ?? {});
  return entries.length ? ` when ${entries.map(([k, v]) => `${k}=${v}`).join(", ")}` : " (everywhere)";
}

export const emptyModel = (now) => ({ v: MODEL_VERSION, at: now, commit: null, scopes: {} });

export function usableModel(raw) {
  if (!isObject(raw)) return { model: null, why: "the knowledge state file is not a JSON object" };
  if (raw.v !== MODEL_VERSION) return { model: null, why: `the knowledge state was written by schema v${raw.v ?? "?"} and this engine reads v${MODEL_VERSION}` };
  return { model: raw, why: null };
}
