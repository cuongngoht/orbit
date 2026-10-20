// Two DERIVED views of the capability graph, for Orbit Control -- computed from
// the registry every time and never stored, because a stored "skill X uses
// server Y" is exactly the mapping this design refuses to keep:
//
//   explainNeeds(owner)   for every capability a skill or agent needs (and can
//                         use), who would provide it right now -- the resolver's
//                         own answer (src/routing/select.mjs), asked as if the task
//                         had named every provider, since there is no task here
//   consumersOf(target)   for a resource, every skill or agent whose needs name
//                         a capability it provides -- its POTENTIAL consumers
//
// Pure, like the router: nothing here connects, starts or writes anything.
import { everyResource } from "../resources/registry.mjs";
import { resolveRequirement } from "./select.mjs";
import { keyOf } from "./terms.mjs";

export function explainNeeds(owner, effective) {
  const resources = everyResource(effective);
  const grams = new Set(resources.flatMap((r) => r.routing.signals.map(keyOf)));
  const needs = [...owner.routing.needs.map((n) => [n, "required"]), ...owner.routing.optional.map((n) => [n, "optional"])];
  return needs.map(([requirement, level]) => explained(requirement, level, resolveRequirement({ requirement, level }, { resources, grams, asked: new Set([requirement]), workflow: owner.kind === "skill" ? owner.id : null })));
}

// An optional need is only ever used when a task names its provider, and the
// view says so rather than calling it selected.
const explained = (requirement, level, r) => ({ requirement, level, status: r.status === "selected" && level === "optional" ? "when-named" : r.status, provider: r.provider ? { kind: r.provider.kind, key: r.provider.key, id: r.provider.id, ownership: r.provider.ownership } : null, why: r.why, candidates: r.candidates });

export function consumersOf(target, effective) {
  const provided = new Set(target.routing.provides);
  const owners = [...(effective?.skills ?? []), ...(effective?.agents ?? [])];
  return owners.flatMap((o) => [...o.routing.needs.map((n) => [n, "required"]), ...o.routing.optional.map((n) => [n, "optional"])].filter(([n]) => provided.has(n)).map(([requirement, level]) => ({ kind: o.kind, id: o.id, requirement, level })));
}
