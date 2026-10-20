// The PROJECT INTELLIGENCE REGISTRY: ecosystem adapters, technology
// descriptors and usage analysers -- three tables, one rule.
//
// Everything project intelligence knows about any particular ecosystem,
// library or product is a REGISTRATION here. The core iterates these tables and
// never tests a row's name, so a new ecosystem is one adapter, a new library a
// descriptor, and a new idiom an analyser -- the zero-core-change property
// test/intelligence-extensibility.test.mjs holds it to, with an ecosystem this
// engine has never shipped.
//
// The capability registry's rules, for the capability registry's reasons: a
// duplicate id is REFUSED, never last-one-wins (whichever module loaded second
// would decide what a package means); a malformed row is a sentence, never a
// TypeError three layers up; and `offer` -- the door for rows nobody in this
// repository wrote, a project's own descriptors -- records every refusal and
// never throws, because one bad JSON file must not take the built-ins down.
import { constraintFindings, missingFindings } from "../constraints.mjs";
import { Refused } from "../errors.mjs";
import { createEcosystemRegistry } from "../ecosystems/registry.mjs";
import { short } from "../hash.mjs";
import { ANALYZER_FIELDS, ANALYZER_METHODS, ANALYZER_REQUIRED, DESCRIPTOR_FIELDS, DESCRIPTOR_REQUIRED, MATCHER_FIELDS, MATCHER_REQUIRED } from "./contract.mjs";

export function createIntelligenceRegistry(opts = {}) {
  return {
    ecosystems: opts.ecosystems ?? createEcosystemRegistry(),
    descriptors: table("technology descriptor", descriptorProblems),
    analyzers: table("usage analyzer", analyzerProblems),
  };
}

function table(what, problems) {
  const byId = new Map();
  const register = (row, from) => add(byId, what, problems, row, from);
  return { register, offer: (rows, from) => offered(register, rows, from), list: () => [...byId.values()], get: (id) => byId.get(id) ?? null, ids: () => [...byId.keys()] };
}

function add(byId, what, problems, row, from) {
  const bad = isObject(row) ? [...problems(row, `${what} "${row.id ?? "?"}"`), ...takenProblem(byId, row.id, what)] : [`a ${what} is an object`];
  if (bad.length) throw new Refused(`${from ?? "this caller"}: cannot register a ${what} — ${bad.join("; ")}`);
  byId.set(row.id, { ...row, from: from ?? "core" });
}

const takenProblem = (byId, id, what) => (byId.has(id) ? [`${what} "${id}" is already registered by ${byId.get(id).from} — two meanings for one id, so neither wins`] : []);

function offered(register, rows, from) {
  const out = { loaded: [], refused: [] };
  for (const row of rows) tried(out, register, row, from);
  return out;
}

function tried(out, register, row, from) {
  try {
    register(row, from);
    out.loaded.push(row.id);
  } catch (e) {
    out.refused.push({ id: row?.id ?? "?", from, why: e.message });
  }
}

const descriptorProblems = (d, at) => [...shapeOf(DESCRIPTOR_FIELDS, DESCRIPTOR_REQUIRED, d, at), ...matcherProblems(d, at)];

const matcherProblems = (d, at) => (Array.isArray(d.matchers) ? d.matchers.flatMap((m, i) => shapeOf(MATCHER_FIELDS, MATCHER_REQUIRED, m, `${at} matcher ${i + 1}`)) : []);

const analyzerProblems = (a, at) => [...shapeOf(ANALYZER_FIELDS, ANALYZER_REQUIRED, a, at, ANALYZER_METHODS), ...ANALYZER_METHODS.filter((m) => typeof a[m] !== "function").map((m) => `${at}: has no ${m}()`)];

// A key nobody declared is refused rather than ignored: in a DATA file it is a
// typo, and a typo in `matchers` would otherwise be a descriptor that silently
// recognises nothing.
function shapeOf(fields, required, row, at, methods = []) {
  if (!isObject(row)) return [`${at}: must be an object`];
  const unknown = Object.keys(row).filter((k) => !(k in fields) && !methods.includes(k) && k !== "from").map((k) => `${at}: unknown key "${k}"`);
  return [...missingFindings(required, row, at), ...constraintFindings(fields, row, at), ...unknown];
}

// What this registry RECOGNISES, as one hash: every descriptor's meaning and
// every analyser's id. A snapshot taken under a different one was read with
// different eyes -- a package that meant nothing then may mean a technology
// now -- so the decision table compares this, and a change re-reads.
export function registryPrint(registry) {
  const descriptors = registry.descriptors.list().map((d) => [d.id, d.category, d.matchers, d.domains ?? [], d.aliases ?? []]).sort();
  return short(JSON.stringify([registry.ecosystems.ids().sort(), descriptors, registry.analyzers.ids().sort()]));
}

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
