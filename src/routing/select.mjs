// For ONE requirement, which resource may satisfy it -- never "which server do
// I like". Pure and deterministic: the same registry and prompt always choose
// the same provider, and nothing here connects, starts or installs anything.
//
// CANDIDATES are the resources that PROVIDE the requirement and, if they say
// `requiresSignal`, are named by one of their own signals in the prompt. Each is
// then judged for THIS requirement:
//
//   eligible     the registry says the resolver may consider it at all -- Orbit
//                can route to it (never an external server), it is
//                enabled, its runtime is ready, its selection is not disabled
//   verdict      allow · approval · deny for this capability, in this workflow
//                (src/policy.mjs -- the invocation gate asks the same function)
//   evidence     for an OPTIONAL requirement, the task must name it: a signal of
//                the resource's own in the prompt. Enabled means eligible to be
//                CONSIDERED; it never means "add me to every task"
//
// The selectable ones are then ORDERED by a table of comparisons, the first
// that separates two deciding -- a person's explicit priority before anything
// the engine infers, and a stable id last, so a tie is never decided by the
// order a provider happened to list things in.
import { capabilityVerdict } from "../policy.mjs";
import { FAMILIES, stateText } from "../resources/model.mjs";
import { keyOf } from "./terms.mjs";

// The engine's own answer before a shipped playbook, before a project's code,
// before a server somebody added, before anything merely observed.
export const TRUST = ["orbit", "plugin", "project", "orbit-managed", "external", "catalog"];

const ORDER = [
  (a, b) => Number(b.selectable) - Number(a.selectable),
  (a, b) => Number(a.verdict === "approval") - Number(b.verdict === "approval"),
  (a, b) => (b.resource.priority ?? 0) - (a.resource.priority ?? 0),
  (a, b) => b.sigHits.length - a.sigHits.length,
  (a, b) => rank(TRUST, a.resource.ownership) - rank(TRUST, b.resource.ownership),
  (a, b) => b.coverage - a.coverage,
  (a, b) => rank(FAMILIES.map((f) => f.kind), a.resource.kind) - rank(FAMILIES.map((f) => f.kind), b.resource.kind),
  (a, b) => a.resource.key.localeCompare(b.resource.key),
];

const rank = (list, value) => (list.includes(value) ? list.indexOf(value) : list.length);

// node: { requirement, level }   ctx: { resources, grams, asked (Set), workflow }
export function resolveRequirement(node, ctx) {
  const candidates = ctx.resources.map((r) => judged(r, node, ctx)).filter(Boolean).sort(compare);
  return { ...outcomeOf(node, candidates), candidates: candidates.map(shown) };
}

function judged(resource, node, ctx) {
  if (!resource.routing.provides.includes(node.requirement)) return null;
  const sigHits = resource.routing.signals.filter((s) => ctx.grams.has(keyOf(s)));
  if (resource.routing.requiresSignal && !sigHits.length) return null;
  const verdict = resource.kind === "mcp" ? capabilityVerdict(resource.policy, node.requirement, ctx.workflow) : "allow";
  return { resource, sigHits, verdict: resource.selection === "approval" && verdict === "allow" ? "approval" : verdict, coverage: resource.routing.provides.filter((p) => ctx.asked.has(p)).length, selectable: resource.eligible && verdict !== "deny" && (node.level !== "optional" || sigHits.length > 0) };
}

const compare = (a, b) => ORDER.reduce((d, by) => d || by(a, b), 0);

// What became of the requirement, in order; the last row always matches.
const OUTCOMES = [
  { status: "selected", when: (c) => c[0]?.selectable && c[0].verdict === "allow", provider: (c) => c[0] },
  { status: "approval", when: (c) => c[0]?.selectable, provider: (c) => c[0] },
  { status: "skipped", when: (c, node) => node.level === "optional" && !c.some((x) => x.sigHits.length), provider: () => null },
  { status: "blocked", when: (c) => c.some((x) => x.resource.eligible && x.verdict === "deny"), provider: (c) => c.find((x) => x.resource.eligible && x.verdict === "deny") },
  { status: "missing", when: (c) => c.some((x) => x.resource.state !== "unknown"), provider: (c) => c.find((x) => x.resource.state !== "unknown") },
  { status: "unknown", when: (c) => c.length > 0, provider: () => null },
  { status: "unprovided", when: () => true, provider: () => null },
];

function outcomeOf(node, candidates) {
  const row = OUTCOMES.find((o) => o.when(candidates, node));
  const chosen = row.provider(candidates);
  return { status: row.status, provider: chosen ? chosen.resource : null, sigHits: chosen?.sigHits ?? [], why: chosen ? whyOf(row.status, chosen) : null };
}

const WHY = {
  selected: () => null,
  approval: (c) => (c.resource.selection === "approval" ? "its selection mode asks for a person's approval" : "policy asks for a person's approval"),
  blocked: () => "policy denies it",
  missing: (c) => whyUnusable(c.resource),
};

const whyOf = (status, chosen) => (WHY[status] ?? (() => null))(chosen);

// Why a candidate cannot be chosen, in the words a person acts on.
function whyUnusable(r) {
  if (r.available && !r.eligible) return r.selection === "disabled" ? "its selection mode is disabled" : "policy leaves it nothing it may be used for";
  return r.why ?? stateText(r.state);
}

// A candidate as the Router Inspector shows it: why it could or could not be
// chosen, and never a fragment of the prompt -- a signal is a table word.
const shown = (c) => ({ kind: c.resource.kind, key: c.resource.key, id: c.resource.id, ownership: c.resource.ownership, eligible: c.resource.eligible, selectable: c.selectable, verdict: c.verdict, signals: c.sigHits, state: c.resource.state, why: c.selectable ? null : c.resource.eligible ? (c.verdict === "deny" ? "policy denies it" : "optional, and nothing in the task names it") : whyUnusable(c.resource) });
