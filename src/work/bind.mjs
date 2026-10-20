// Which provider serves a need TODAY -- asked of the resolver that already exists, never
// answered beside it.
//
// A need names a capability, and a capability is a word. Who provides it -- a managed server,
// a project's own adapter, a tool -- is the resource registry's to say, with its eligibility,
// policy, approvals and priority exactly as the prompt router gets them. So the question goes
// to src/knowledge/verify.mjs `resolved`, which walks the same requirement graph and the same
// ordered selector, and what comes back is written down as a BINDING: the provider's key and
// a FINGERPRINT of the state that made it eligible.
//
// A binding is a fact about today. When the registry no longer looks the way the fingerprint
// says -- the server was disabled, the tool upgraded, a policy tightened -- the binding has
// MOVED, and the need is asked again. The need itself never changes: it names what it wants,
// not who gave it. Nothing here calls a provider.
import { sha } from "../hash.mjs";
import { discovered } from "../knowledge/opportunities.mjs";
import { resolved } from "../knowledge/verify.mjs";
import { canonical } from "../network/fingerprint.mjs";
import { everyResource } from "../resources/registry.mjs";
import { numbered, stateOf } from "./model.mjs";
import { NEED_TYPES } from "./vocab.mjs";

export const WORKFLOW = "orbit-requirements";

// A need's state is worth binding again while it waits, is stuck, or went stale.
const REBIND = ["pending", "blocked", "stale"];

const verbOf = (type) => NEED_TYPES.find((t) => t.name === type)?.verb ?? "settle";

// A need as the resolver asks about it: derived (never asked by a person), so it is always
// resolved and never skipped, and only the top node can be a gap.
export const asNeed = (need) => ({ capability: need.capability, proves: { subject: need.subject }, context: {}, conditional: false, tier: "rule", because: [`the work has to ${verbOf(need.type)} ${need.subject}`], by: "work" });

// What a binding rests on. Everything that decides whether the selector may pick a provider,
// and nothing that only describes it.
export const fingerprintOf = (r) => sha(canonical({ key: r.key, kind: r.kind, id: r.id, ownership: r.ownership, enabled: r.enabled, runtimeReady: r.runtimeReady, eligible: r.eligible, selection: r.selection, priority: r.priority, state: r.state, version: r.detail?.version ?? null })).slice(0, 16);

// A resource's key is unique within its family and not across them: a skill and an agent of the
// same plugin are both `orbit-qa-agent`. So a provider is named by its kind AND its key, and
// what it stands for is looked up by both.
export const resourceOf = (effective, provider) => everyResource(effective).find((r) => r.kind === provider?.kind && r.key === provider?.key) ?? null;

const identityOf = (r) => `${r.kind}|${r.key}`;

// Is the provider a binding chose still what it was: current, moved, or gone.
export function revalidate(binding, effective) {
  const resource = resourceOf(effective, binding.provider);
  if (!resource) return "gone";
  return fingerprintOf(resource) === binding.fingerprint ? "current" : "moved";
}

const bindable = (model) => [...model.needs.values()].filter((n) => n.capability && REBIND.includes(stateOf(n, model)));

function lineOf(need, result, resources) {
  const resource = result.provider ? resources.get(identityOf(result.provider)) : null;
  return { need: need.id, provider: result.provider ?? null, fingerprint: resource ? fingerprintOf(resource) : null, status: result.outcome, why: result.why };
}

const unchanged = (standing, row) => Boolean(standing) && standing.provider?.key === row.provider?.key && standing.fingerprint === row.fingerprint && standing.status === row.status;

// A capability nothing provides is remembered as ONE opportunity, through the door knowledge
// already keeps; and when something provides it again, the engine moves it on. Evidence moves
// it, nothing else does, and nothing is installed, enabled or generated here.
function remembered(w, targets, results) {
  const run = { at: w.now(), workflow: w.workflow ?? WORKFLOW, subjects: [...new Set(targets.map((n) => n.subject))], context: {} };
  return w.opportunities.settle(discovered(w.opportunities.docs(), results, run)).written;
}

const written = (w, model, rows) => numbered(model, "binding", rows).map((row) => w.works.append(model.meta.id, "binding", row));

const NOTHING = { checked: 0, bound: [], results: [], opportunities: [] };

// The resolver's answer for every target, and the lines that differ from what already stands.
function asked(w, model, targets) {
  const effective = w.effective();
  const { results } = resolved(targets.map(asNeed), effective);
  const resources = new Map(everyResource(effective).map((r) => [identityOf(r), r]));
  const rows = targets.map((n) => lineOf(n, results.find((r) => r.capability === n.capability), resources));
  return { results, rows: rows.filter((row) => !unchanged(model.bindings.get(row.need), row)) };
}

// Ask the resolver once for every need that has to be bound, and write down only what
// differs from what already stands -- a second look at the same registry adds no line.
//
// w: { works, effective(), opportunities: { docs(), settle(docs) }, now(), workflow? }
export function bindNeeds(w, model) {
  const targets = bindable(model);
  if (!targets.length) return NOTHING;
  const { results, rows } = asked(w, model, targets);
  return { checked: targets.length, bound: written(w, model, rows), results, opportunities: remembered(w, targets, results) };
}
