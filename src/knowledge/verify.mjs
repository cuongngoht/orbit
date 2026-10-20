// Which proof needs something HERE can meet -- asked of the EXISTING requirement
// graph and resource resolver (src/routing/graph.mjs, src/routing/select.mjs),
// never answered beside them.
//
// Knowledge produces capability REQUIREMENTS and stops. Who provides one --
// a Orbit built-in, a project's capability, a managed MCP server, a CLI tool, a
// family nobody has written yet -- is the resolver's to decide, with its
// eligibility, policy, approvals, priority and ownership exactly as the prompt
// router gets them. So a need goes in as a node, one graph per capability:
//
//   level `conditional`  derived, not asked by a person -- and only `optional`
//                        is ever skipped, so a derived need is always resolved
//   grams                every resource's OWN signals (src/routing/explain.mjs's
//                        "as if the task named every provider"): a provider that
//                        waits to be named must never look absent, or a false
//                        opportunity would open
//
// and only the TOP node can be a gap. A chosen provider's own unmet need (a
// command it shells out to, say) is `impaired` -- the provider exists, and its
// health is `query doctor`'s and Orbit Control's business, not a missing
// capability.
import { everyResource } from "../resources/registry.mjs";
import { expandGraph } from "../routing/graph.mjs";
import { keyOf } from "../routing/terms.mjs";

export const MAX_CAPABILITIES = 12;

// What became of one capability, ordered, the last always matching. A resolver
// status added one day falls through to `cannot-tell` -- never into a gap by
// default. `unknown` (a candidate nobody has checked) is never "missing".
export const OUTCOMES = [
  { outcome: "cannot-tell", gap: false, when: (top) => !top, why: () => "the resolver answered nothing for it" },
  { outcome: "impaired", gap: false, when: (top, nodes) => provided(top) && unmet(nodes).length > 0, why: (top, nodes) => `${top.provider.id} provides it, but its own need ${unmet(nodes).map((n) => n.requirement).join(", ")} is unmet here — \`query doctor\` or Orbit Control` },
  { outcome: "provided", gap: false, when: (top) => provided(top), why: (top) => (top.status === "approval" ? `${top.provider.id} provides it, once a person approves it` : `${top.provider.id} provides it`) },
  { outcome: "decision", gap: false, when: (top) => top.status === "blocked", why: (top) => top.why ?? "Orbit policy blocks what could provide it — a person's decision, not a gap" },
  { outcome: "gap", gap: true, remedy: "prepare", when: (top) => top.status === "unprovided", why: () => "nothing here provides it — an opportunity to prepare a reusable capability" },
  { outcome: "gap", gap: true, remedy: "enable", when: (top) => top.status === "missing", why: (top) => `${top.provider?.id ?? "a known provider"} could provide it, but is not usable here (${top.why ?? "not ready"}) — enable it in Orbit Control` },
  { outcome: "cannot-tell", gap: false, when: () => true, why: (top) => `its provider's state is ${top.status} — nobody has looked` },
];

const provided = (top) => top.status === "selected" || top.status === "approval";

const unmet = (nodes) => nodes.filter((n) => n.transitive && n.level === "required" && (n.status === "missing" || n.status === "unprovided"));

// Every signal any resource carries -- the grams a task that named every
// provider would have produced.
export const everySignal = (resources) => new Set(resources.flatMap((r) => r.routing.signals.map(keyOf)));

export function resolved(needs, effective) {
  const resources = everyResource(effective);
  const grams = everySignal(resources);
  const capabilities = [...new Set(needs.map((n) => n.capability))];
  return { results: capabilities.slice(0, MAX_CAPABILITIES).map((cap) => judged(cap, needs.filter((n) => n.capability === cap), resources, grams)), skipped: capabilities.slice(MAX_CAPABILITIES) };
}

function judged(capability, needs, resources, grams) {
  const graph = expandGraph([{ requirement: capability, level: "conditional", because: `proves ${needs.map((n) => n.proves.consequence ?? n.proves.subject).join(", ")}` }], { resources, grams });
  const top = graph.nodes.find((n) => n.requirement === capability && !n.transitive) ?? null;
  const row = OUTCOMES.find((o) => o.when(top, graph.nodes));
  return { capability, outcome: row.outcome, gap: row.gap, remedy: row.remedy ?? null, status: top?.status ?? null, provider: top?.provider ? providerOf(top.provider) : null, why: row.why(top, graph.nodes), needs, candidates: top?.candidates ?? [] };
}

// A provider as a decision names it -- never the whole resource record.
const providerOf = (p) => ({ kind: p.kind, id: p.id, key: p.key, ownership: p.ownership });
