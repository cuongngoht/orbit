// Which DECLARED dependencies a registered descriptor recognises -- the
// Specification pattern, because that is exactly its shape: a matcher is a
// predicate over one dependency record, a descriptor is the OR of its matchers,
// and nothing here ever compares a package name to a literal. Knowing that a
// package means a technology is the DESCRIPTOR's; this only asks it.
//
// Only a relationship that DECLARES is offered to a matcher (src/ecosystems/
// contract.mjs). A centrally managed version is the case that makes this
// matter: a technology recognised from a version list alone would be a
// technology this project merely COULD use, reported as one it does.
import { RELATIONSHIPS, declares } from "../../ecosystems/contract.mjs";
import { groupBy, sortedUnique } from "../group.mjs";
import { prefixOf, rootOf } from "../model.mjs";

export const MAX_EVIDENCE = 8;

// The canonical DependencyRecord, flattened off the manifests: which ecosystem,
// which manifest, which name, how it is related -- and the file that says so.
export function dependencyRecords(manifests) {
  return manifests.filter((m) => !m.unreadable).flatMap((m) => m.dependencies.map((d) => ({ ecosystem: m.ecosystem, manifest: m.path, ...d, evidence: [m.path] })));
}

// One matcher, compiled once into a predicate over a record.
export function specOf(matcher) {
  const re = new RegExp(`^${matcher.dependency.split("*").map(escaped).join(".*")}$`, "i");
  return (dep) => dep.ecosystem === matcher.ecosystem && re.test(dep.name);
}

const escaped = (s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

export const recognising = (descriptors) => descriptors.map((d) => ({ d, specs: d.matchers.map(specOf) }));

export const descriptorsFor = (compiled, dep) => compiled.filter((c) => c.specs.some((spec) => spec(dep))).map((c) => c.d);

export function technologyFacts(manifests, descriptors) {
  const compiled = recognising(descriptors);
  const declared = dependencyRecords(manifests).filter((dep) => declares(dep.relationship));
  const hits = declared.flatMap((dep) => descriptorsFor(compiled, dep).map((d) => ({ dep, d })));
  return [...groupBy(hits, (h) => `${prefixOf(h.dep.manifest)}${h.d.id}`)].map(([key, group]) => technologyFact(key, group));
}

function technologyFact(key, group) {
  const d = group[0].d;
  const manifests = sortedUnique(group.map((h) => h.dep.manifest));
  const packages = sortedUnique(group.map((h) => h.dep.name));
  return { kind: "technology", key, root: rootOf(manifests[0]), technology: d.id, category: d.category, ...(d.provider ? { provider: d.provider } : {}), ecosystems: sortedUnique(group.map((h) => h.dep.ecosystem)), packages, ...(d.domains?.length ? { domains: d.domains } : {}), statement: `${d.id} is declared in ${rootOf(manifests[0])} through ${packages.join(", ")}`, scope: manifests, evidence: manifests.slice(0, MAX_EVIDENCE), source: "package-manifest", confidence: "certain", because: how(group), unknowns: [DECLARED_IS_NOT_USED, ...conditional(group)] };
}

const how = (group) => sortedUnique(group.map((h) => h.dep.relationship)).map((r) => `${r}: ${RELATIONSHIPS.find((row) => row.name === r).doc}`).join("; ");

const DECLARED_IS_NOT_USED = "whether any code actually uses it — a declared package is allowed, not used. `intelligence technologies` shows how far up the ladder the code takes it";

const conditional = (group) => (group.some((h) => h.dep.conditional) ? ["whether the condition it is declared under holds in the build that ships — this read did not evaluate it"] : []);
