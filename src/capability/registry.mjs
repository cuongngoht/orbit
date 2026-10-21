// The capability REGISTRY: namespaced ids, resolved to one implementation each.
//
// The same three rules the executor registry has, for the same three reasons:
// a duplicate id is REFUSED rather than overwritten (last-one-wins picks whichever
// module happened to load second), a malformed row is a sentence rather than a
// TypeError, and resolving an id nobody registered says so instead of returning
// undefined for somebody else to dereference.
//
// One per CONTEXT, so project A's `postgres.query` and project B's are two
// different things that never meet -- which matters more here than it does for
// verbs, because two projects' idea of "the orders database" is exactly the kind
// of thing that must not be shared by accident.
import { constraintFindings, missingFindings } from "../constraints.mjs";
import { Refused } from "../errors.mjs";
import { BIND_KIND_IDS, EFFECT_IDS, meaningAt, mutatingEffect } from "../topology/vocab.mjs";
import { CAPABILITY_FIELDS, CAPABILITY_REQUIRED, SUPPORTED_CAPABILITY_APIS, providesFindings } from "./contract-v1.mjs";
import { helperFindings } from "./helper.mjs";

const KNOWN = new Set([...Object.keys(CAPABILITY_FIELDS), "invoke"]);

export function createCapabilityRegistry() {
  const byId = new Map();
  return {
    register: (cap, from) => add(byId, cap, from),
    check: (cap, from) => problems(byId, cap, from),
    resolve: (id) => resolved(byId, id),
    has: (id) => byId.has(id),
    list: () => [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
    ids: () => [...byId.keys()].sort(),
    sourceOf: (id) => byId.get(id)?.from ?? null,
  };
}

function add(byId, cap, from) {
  const bad = problems(byId, cap, from);
  if (bad.length) throw new Refused(`${from ?? "this caller"}: cannot register a capability — ${bad.join("; ")}`);
  byId.set(cap.id, { ...cap, from: from ?? "core" });
}

function problems(byId, cap, from) {
  if (!isObject(cap)) return ["a capability is an object"];
  const at = `capability "${cap.id ?? "?"}"`;
  const declared = [...missingFindings(CAPABILITY_REQUIRED, cap, at), ...constraintFindings(CAPABILITY_FIELDS, cap, at)];
  return [...declared, ...unknownKeys(cap, at), ...providesFindings(cap, at), ...invokeProblems(cap, at), ...takenProblem(byId, cap.id, at), ...apiProblems(cap, at), ...DECLARED.flatMap((rule) => rule(cap, at, from))];
}

// The rules across the optional 0.1.0 fields (ADR 0035, 0036), one row each.
const DECLARED = [
  (cap, at) => (cap.invoke?.constructor?.name === "AsyncFunction" ? [`${at}: invoke is async — a capability answers synchronously, and a promise would be judged as {} (Boolean(it) would pass); reach an asynchronous SDK through a helper (ext.helper.run)`] : []),
  (cap, at) => (Array.isArray(cap.effects) ? cap.effects : []).filter((e) => !EFFECT_IDS.includes(e)).map((e) => `${at}: effect "${e}" is not one of ${EFFECT_IDS.join(", ")}`),
  (cap, at) => (Array.isArray(cap.effects) && cap.effects.some(mutatingEffect) && cap.mutates !== true ? [`${at}: it declares a mutating effect and not mutates: true — the two must say the same thing`] : []),
  (cap, at) => Object.entries(isObject(cap.outputs) ? cap.outputs : {}).filter(([, m]) => !meaningAt(String(m))).map(([f, m]) => `${at}: output ${f} means "${m}", which is not a meaning (src/topology/vocab.mjs)`),
  (cap, at) => helperFindings(cap.helper, at),
  (cap, at) => Object.entries(isObject(cap.inputSchema) ? cap.inputSchema : {}).filter(([, row]) => row?.bind !== undefined && !BIND_KIND_IDS.includes(row.bind)).map(([k, row]) => `${at}: input ${k} binds "${row.bind}", which is not a bind kind (${BIND_KIND_IDS.join(", ")})`),
  (cap, at, from) => (String(cap.id ?? "").startsWith("orbit.") && !ORBIT_OWNERS.test(String(from ?? "core")) ? [`${at}: orbit.* ids belong to the engine and the packs it ships — a project names its own capability project.<domain>.<operation>`] : []),
];

const ORBIT_OWNERS = /^(core|pack:[a-z0-9-]+)$/;

const unknownKeys = (cap, at) => Object.keys(cap).filter((k) => !KNOWN.has(k)).map((k) => `${at}: unknown key "${k}"`);

const invokeProblems = (cap, at) => (typeof cap.invoke === "function" ? [] : [`${at}: has no invoke(ext, input)`]);

// The enum on the row refuses an unpublished version; this says the useful half,
// which is that upgrading the ENGINE is the fix rather than editing the file.
function apiProblems(cap, at) {
  if (cap.apiVersion === undefined || SUPPORTED_CAPABILITY_APIS.includes(cap.apiVersion)) return [];
  return [`${at}: apiVersion ${cap.apiVersion} is not one this engine serves (${SUPPORTED_CAPABILITY_APIS.join(", ")})`];
}

function takenProblem(byId, id, at) {
  const owner = byId.get(id)?.from;
  return owner ? [`${at}: already registered by ${owner} — two definitions of one id is two answers to one question, so neither wins`] : [];
}

// Refused, not undefined. A case naming a capability nothing registered was never
// going to run, and the message names what IS available, because the usual cause
// is an extension that failed to load three lines earlier.
function resolved(byId, id) {
  const cap = byId.get(id);
  if (!cap) throw new Refused(`no capability "${id}" is registered${offered(byId)}`);
  return cap;
}

const offered = (byId) => (byId.size ? ` — this project offers ${[...byId.keys()].sort().join(", ")}` : " — this project has registered none at all");

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
