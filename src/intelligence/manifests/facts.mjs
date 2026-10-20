// What the manifests SAY, as facts: one per manifest, and one per ecosystem
// per checkout.
//
// A manifest fact keeps EVERY dependency record the adapter read -- recognised
// by a descriptor or not. An internal package nobody has described is still
// something this project depends on, and dropping it because no table knew its
// name would make the catalog the limit of what the tool can see. The
// technology facts are the recognised subset; this is the whole.
import { declares } from "../../ecosystems/contract.mjs";
import { groupBy, sortedUnique } from "../group.mjs";
import { prefixOf, rootOf } from "../model.mjs";

export const MAX_EVIDENCE = 8;

export function manifestFacts(manifests) {
  return [...manifests.map(manifestFact), ...ecosystemFacts(manifests.filter((m) => !m.unreadable))];
}

function manifestFact(m) {
  const base = { kind: "manifest", key: m.path, root: rootOf(m.path), ecosystem: m.ecosystem, unit: m.unit, reach: m.reach, scope: [m.path], evidence: [m.path], source: "package-manifest", unknowns: m.unknowns };
  if (m.unreadable) return { ...base, statement: `${m.path} could not be read as a ${m.ecosystem} manifest`, confidence: "unknown", because: "the adapter could not read it — see what it could not settle" };
  return { ...base, ...described(m), confidence: "certain", ...optional(m) };
}

function described(m) {
  const stated = m.dependencies.filter((d) => declares(d.relationship)).length;
  const managed = m.dependencies.length - stated;
  const what = m.unit ? `a ${m.ecosystem} unit` : `a shared ${m.ecosystem} manifest reaching ${(m.appliesTo ?? []).length} unit(s)`;
  return { statement: `${m.path} is ${what} that declares ${stated} dependency(ies)${managed ? ` and makes ${managed} more available without declaring them` : ""}`, because: "read through its ecosystem adapter; a name, never a version" };
}

// Present only when the manifest said it: an empty `targets` on a file that has
// none would read as "targets nothing", which is a different sentence.
function optional(m) {
  const all = { dependencies: m.dependencies, requires: Object.keys(m.requires).length ? m.requires : undefined, runtime: m.runtime, targets: m.targets.length ? m.targets : undefined, sdk: m.sdk, projectKinds: m.kinds.length ? m.kinds : undefined, appliesTo: m.appliesTo };
  return Object.fromEntries(Object.entries(all).filter(([, v]) => v !== undefined));
}

const ecosystemFacts = (manifests) => [...groupBy(manifests, (m) => `${prefixOf(m.path)}${m.ecosystem}`)].map(([key, members]) => ecosystemFact(key, members));

function ecosystemFact(key, members) {
  const units = members.filter((m) => m.unit);
  const targets = sortedUnique(members.flatMap((m) => m.targets));
  const pinned = members.find((m) => m.sdk)?.sdk;
  return { kind: "ecosystem", key, root: rootOf(members[0].path), ecosystem: members[0].ecosystem, units: units.length, ...runtimeOf(members), ...(targets.length ? { targets } : {}), ...(pinned ? { sdk: pinned } : {}), statement: `${rootOf(members[0].path)} has ${units.length} ${members[0].ecosystem} unit(s)${targets.length ? ` targeting ${targets.join(", ")}` : ""}`, scope: members.map((m) => m.path), evidence: members.map((m) => m.path).slice(0, MAX_EVIDENCE), source: "package-manifest", confidence: "certain", because: `${members.length} manifest(s) read`, unknowns: targets.length || !units.length ? [] : [NO_TARGETS] };
}

const runtimeOf = (members) => {
  const runtime = members.find((m) => m.runtime)?.runtime;
  return runtime ? { runtime } : {};
};

const NO_TARGETS = "what these units build for — none of their manifests states a target";
