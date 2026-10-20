// The USAGE stage: which files are worth reading, read them through the source
// port within a budget, hand each to the analysers that apply, and fold what
// comes back into usage and wiring facts -- one per directory, SCOPED to the
// files that showed it. A directory's fingerprint covers everything beneath it,
// so a fact scoped to `src/Infrastructure` would go stale whenever any
// subdirectory moved; scoped to its own files, it moves only when they do.
//
// Three things keep it bounded, and each is a rule rather than a tuning knob:
//
//   an analyser runs only where it could matter -- a checkout with a unit of
//   its ecosystem, and one of the technologies it `requires` DECLARED there. A
//   client nobody depends on is not searched for;
//
//   ONE search over the index names the candidate files, the union of every
//   active analyser's triggers. Nothing that search did not name is opened, and
//   an untracked file cannot contribute: the index is what is searched;
//
//   a file under a scope that is still FRESH is never re-read. What the last
//   scan learned there still describes it -- which is what lets a change in one
//   directory leave every other directory's usages alone.
//
// Nothing here knows an idiom. The analysers do; this knows that there are
// analysers, and what shape their answers must have.
import { extname } from "node:path/posix";
import { splitPath } from "../../frontend/composite.mjs";
import { attempt } from "../attempt.mjs";
import { dirOf, groupBy, sortedUnique, underAny } from "../group.mjs";
import { rootOf } from "../model.mjs";
import { checkedOutput } from "./output.mjs";

export const DEFAULT_BUDGET = 400;
export const MAX_EVIDENCE = 6;

const EMPTY = { facts: [], unknowns: [], read: [], analysers: [] };

// `known` = { technologies, ecosystems } (facts) and `descriptors` (a Set of
// ids); `plan` = { scopes: null for the whole tree or a list, fresh: a list }.
export function usagePass(input, analyzers, known, plan) {
  const active = analyzers.map((a) => ({ a, roots: rootsFor(a, known) })).filter((x) => x.roots.size > 0);
  if (!active.length) return EMPTY;
  const hits = input.search(triggerPattern(active.map((x) => x.a)));
  if (hits === null) return { ...EMPTY, unknowns: [NO_SEARCH] };
  return analysedAll(input, active, known, wanted(hits, active, plan));
}

const NO_SEARCH = "which files use any technology — the index could not be searched, so no usage here was observed";

function rootsFor(a, known) {
  const roots = known.ecosystems.filter((e) => e.ecosystem === a.ecosystem && e.units > 0).map((e) => e.root);
  const needed = a.requires ?? [];
  return new Set(roots.filter((r) => !needed.length || known.technologies.some((t) => t.root === r && needed.includes(t.technology))));
}

const triggerPattern = (analyzers) => `(${sortedUnique(analyzers.flatMap((a) => a.triggers)).map(ere).join("|")})`;

const ere = (s) => s.replace(/[.[\]()*+?{}|^$\\]/g, "\\$&");

function wanted(hits, active, plan) {
  const exts = new Set(active.flatMap((x) => x.a.extensions));
  const paths = sortedUnique(hits.map((h) => h.path)).filter((p) => exts.has(extname(splitPath(p).local)));
  return paths.filter((p) => (plan.scopes === null || underAny(p, plan.scopes)) && !underAny(p, plan.fresh ?? []));
}

function analysedAll(input, active, known, paths) {
  const budget = input.budget ?? DEFAULT_BUDGET;
  const read = paths.slice(0, budget);
  const results = read.flatMap((p) => fileResults(input, active, known, p));
  return { facts: [...usageFacts(results), ...wiringFacts(results)], unknowns: [...sortedUnique(results.flatMap((r) => r.unknowns)), ...spent(paths, budget)], read, analysers: active.map((x) => x.a.id) };
}

// The file is read ONCE however many analysers apply, and an analyser whose
// own triggers the text does not contain is not asked -- the search matched
// the union, not each one.
function fileResults(input, active, known, path) {
  const mine = active.filter((x) => x.a.extensions.includes(extname(splitPath(path).local)) && x.roots.has(rootOf(path))).map((x) => x.a);
  const text = mine.length ? input.read(path) : null;
  if (text === null) return [];
  return mine.filter((a) => a.triggers.some((t) => text.includes(t))).map((a) => oneAnalysis(a, path, text, known));
}

function oneAnalysis(a, path, text, known) {
  const out = attempt(() => a.analyze({ path: splitPath(path).local, text }));
  if (out.error) return { path, usages: [], wirings: [], defines: [], unknowns: [`the ${a.id} analyser failed on ${path} — ${out.error}`] };
  return { path, ...checkedOutput(out.value, known.descriptors, `${a.id} on ${path}`) };
}

const spent = (paths, budget) => (paths.length > budget ? [`what the remaining ${paths.length - budget} file(s) do — the budget of ${budget} was spent first, so the usages here are a floor, never a complete list`] : []);

const present = (fields) => Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined && v !== null));

const usageEntries = (results) => results.flatMap((r) => r.usages.map((u) => ({ u, path: r.path, dir: dirOf(r.path), defines: r.defines })));

const usageFacts = (results) => [...groupBy(usageEntries(results), (e) => [e.u.technology, e.u.integration, e.u.operation, e.u.role, e.dir].join("|"))].map(([, entries]) => usageFact(entries));

function usageFact(entries) {
  const { u, dir } = entries[0];
  const files = sortedUnique(entries.map((e) => e.path));
  const signals = sortedUnique(entries.flatMap((e) => e.u.signals ?? []));
  return { kind: "usage", key: `${u.technology}:${u.integration ?? "?"}:${u.operation ?? "?"}${u.role ? `:${u.role}` : ""}@${dir}`, root: rootOf(dir), technology: u.technology, ...present({ integration: u.integration, operation: u.operation, role: u.role }), signals, defines: sortedUnique(entries.flatMap((e) => e.defines)), statement: usageSays(u, dir), scope: files, evidence: files.slice(0, MAX_EVIDENCE), source: "repository", confidence: entries.every((e) => e.u.confidence === "certain") ? "certain" : "possible", because: `${files.length} file(s) show ${signals.slice(0, 5).join(", ") || "it"}`, unknowns: sortedUnique([...gaps(u), ...entries.flatMap((e) => e.u.unknowns ?? [])]) };
}

// A technology that IS the system it reaches -- a database client reaching
// that database -- is said once, not "X to reach X".
const usageSays = (u, dir) => `${dir} uses ${u.technology}${u.integration && u.integration !== u.technology ? ` to reach ${u.integration}` : ""}${u.operation ? ` for ${u.operation}` : ""}${u.role ? ` as a ${u.role}` : ""}`;

// What a usage does NOT settle is said on the fact, every time. "the client is used"
// and "the client is used for files" are different claims, and the first must never
// be read as the second.
const gaps = (u) => [...(u.operation ? [] : [NO_OPERATION]), ...(u.integration ? [] : [NO_INTEGRATION])];

const NO_OPERATION = "what it is used for — the code shows the technology, not an operation it performs";

const NO_INTEGRATION = "which system it reaches — nothing in these files names one";

const wiringEntries = (results) => results.flatMap((r) => r.wirings.map((w) => ({ w, path: r.path, dir: dirOf(r.path) })));

const wiringFacts = (results) => [...groupBy(wiringEntries(results), (e) => [e.dir, e.w.abstraction, e.w.implementation, e.w.lifetime, e.w.name].join("|"))].map(([, entries]) => wiringFact(entries));

function wiringFact(entries) {
  const { w, dir } = entries[0];
  const files = sortedUnique(entries.map((e) => e.path));
  return { kind: "wiring", key: `${dir}:${w.abstraction}->${w.implementation ?? "?"}:${w.lifetime}${w.name ? `#${w.name}` : ""}`, root: rootOf(dir), abstraction: w.abstraction, ...present({ implementation: w.implementation, name: w.name }), lifetime: w.lifetime, signals: sortedUnique(entries.flatMap((e) => e.w.signals ?? [])), statement: `${w.abstraction} is registered ${w.lifetime}, answered by ${w.implementation ?? "a factory"}${w.name ? ` (named ${w.name})` : ""}`, scope: files, evidence: files.slice(0, MAX_EVIDENCE), source: "repository", confidence: "certain", because: `a registration in ${files.length} file(s)`, unknowns: w.implementation ? [] : [FACTORY] };
}

const FACTORY = "what type answers it — a factory builds it and the registration does not say which";
