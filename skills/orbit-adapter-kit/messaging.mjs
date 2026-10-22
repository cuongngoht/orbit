// The MESSAGING conformance kit (doc §5.10, §14 #24/#29; ADR 0035): the scenarios a messaging
// adapter is held to, on a REAL system, through its REAL helper -- the same rows for the reference
// adapters this plugin ships and for an adapter a project brings.
//
// It knows no transport. WHERE a scenario's resources go is the adapter's own declaration,
// `conformance.params`, as templates over {ns} (the kit's namespace), {id} (a scenario's sink),
// {obs} (an observer) and {key} (a routing key or subject suffix):
//
//   channel   how to publish with {key}
//   observer  an observer of its own, named by {id}
//   sink      a fixture that makes {key} land somewhere an APPLICATION would read -- the stand-in the
//             non-stealing scenario asks the system's witness about
//   witness   which of the sink's resources the witness counts pending messages on
//
// A scenario whose semantics are unknown or unmet is NOT APPLICABLE, never a pass. What the system
// holds is asked of a WITNESS the caller binds -- the system's own tooling, never the adapter under
// test. `ask(op, request, bound)` runs the helper as the engine would.
import { meets } from "../../src/adapters/semantics.mjs";

const NON_STEALING = ["shadow-subscription", "independent-cursor", "peek-cursor"];

export const SCENARIOS = [
  { id: "publish-confirmed", ops: ["publish", "fixture.prepare", "fixture.cleanup"], needs: { publishAck: ["broker-confirm", "durable-write"] }, run: publishConfirmed },
  { id: "unroutable-not-confirmed", ops: ["publish"], needs: { unroutable: ["returned", "error"] }, run: unroutableNotConfirmed },
  { id: "observe-complete-window", ops: ["observe", "observe.await", "publish", "fixture.prepare"], needs: { observation: NON_STEALING }, run: completeWindow },
  { id: "observer-non-stealing", ops: ["observe", "observe.await", "fixture.prepare"], needs: { observation: NON_STEALING }, run: nonStealing },
  { id: "fixture-own-namespace", ops: ["fixture.prepare", "fixture.cleanup"], needs: {}, run: fixtureLifecycle },
];

// {ns}, {id} and {key} filled into a template, every string at any depth.
export function filled(template, vars) {
  if (typeof template === "string") return template.replace(/\{(ns|id|obs|key)\}/g, (_, k) => String(vars[k] ?? ""));
  if (Array.isArray(template)) return template.map((t) => filled(t, vars));
  return template && typeof template === "object" ? Object.fromEntries(Object.entries(template).map(([k, v]) => [k, filled(v, vars)])) : template;
}

const resourceOf = (kit, name, vars, alias) => ({ alias, transport: kit.adapter.transports[0], endpoint: kit.system.endpoint, credential: kit.system.credential, adapter: kit.adapter.id, ...filled(kit.params[name] ?? {}, { ns: kit.ns, ...vars }) });

const channel = (kit, id, key) => resourceOf(kit, "channel", { id, key }, "events");
const observer = (kit, id, obs, key) => resourceOf(kit, "observer", { id, obs, key }, obs);
const sink = (kit, id, key) => resourceOf(kit, "sink", { id, key }, `sink-${id}`);

function withSink(kit, id, key, then) {
  const fx = sink(kit, id, key);
  const prepared = kit.ask("fixture.prepare", {}, { fixtureRef: fx });
  try { return prepared.ok ? then(fx) : { ok: false, saw: { prepared } }; }
  finally { kit.ask("fixture.cleanup", {}, { fixtureRef: fx }); }
}

function publishConfirmed(kit) {
  return withSink(kit, "route", "invoice.routed", () => {
    const out = kit.ask("publish", { messageId: "kit-m-1", payload: { invoice: "kit" } }, { channelRef: channel(kit, "route", "invoice.routed") });
    return { ok: out.ok && out.value.outcome === "confirmed", saw: out.value ?? out };
  });
}

// A publication nothing routes is never reported confirmed -- whatever the system's own word for it.
function unroutableNotConfirmed(kit) {
  const out = kit.ask("publish", { messageId: "kit-m-2", payload: {} }, { channelRef: channel(kit, "nowhere", "nobody.listens") });
  return { ok: out.ok ? out.value.outcome !== "confirmed" : out.class !== "ambiguous", saw: out.value ?? out };
}

function completeWindow(kit) {
  return withSink(kit, "window", "invoice.created", () => windowed(kit, observer(kit, "window", "obswindow", "invoice.created"), channel(kit, "window", "invoice.created")));
}

function windowed(kit, obs, ch) {
  const armed = kit.ask("observe", {}, { channelRef: ch, observerRef: obs });
  const pub = kit.ask("publish", { messageId: "kit-m-3", correlationId: "kit-c-3", payload: { n: 3 } }, { channelRef: ch });
  const seen = kit.ask("observe.await", { waitMs: 1500 }, { observerRef: obs });
  const again = kit.ask("observe.await", { waitMs: 500 }, { observerRef: obs });
  return { ok: [armed, pub, seen, again].every((r) => r.ok) && seen.value.completeness === "complete" && seen.value.messages.map((m) => m.id).join() === "kit-m-3" && again.value.messages.length === 0 && again.value.completeness === "complete", saw: { armed: armed.value ?? armed, seen: seen.value ?? seen, again: again.value ?? again } };
}

// The application's own resource keeps its message while the observer reads its copy: the
// system's witness, never the adapter, says so.
function nonStealing(kit) {
  return withSink(kit, "steal", "invoice.created", () => stolenNothing(kit, observer(kit, "steal", "obssteal", "invoice.created"), channel(kit, "steal", "invoice.created")));
}

function stolenNothing(kit, obs, ch) {
  kit.ask("observe", {}, { channelRef: ch, observerRef: obs });
  kit.ask("publish", { messageId: "kit-m-4", payload: {} }, { channelRef: ch });
  const seen = kit.ask("observe.await", { count: 1, waitMs: 1500 }, { observerRef: obs });
  const pending = kit.system.witness.pending(filled(kit.params.witness ?? {}, { ns: kit.ns, id: "steal", key: "invoice.created" }));
  return { ok: seen.ok && seen.value.messages.some((m) => m.id === "kit-m-4") && pending >= 1, saw: { observed: seen.value?.messages?.map((m) => m.id), pendingByWitness: pending } };
}

// A fixture removes only what is its own: a name outside its namespace is refused before anything.
function fixtureLifecycle(kit) {
  const fx = sink(kit, "life", "invoice.life");
  const prepared = kit.ask("fixture.prepare", {}, { fixtureRef: fx });
  const outside = kit.ask("fixture.cleanup", {}, { fixtureRef: { ...fx, namespace: `${fx.namespace}x` } });
  const cleaned = kit.ask("fixture.cleanup", {}, { fixtureRef: fx });
  return { ok: prepared.ok && !outside.ok && outside.class === "refused" && cleaned.ok && (cleaned.value.cleanup?.removed ?? []).length > 0, saw: { prepared: prepared.value ?? prepared, outside: outside.class, cleaned: cleaned.value ?? cleaned } };
}

// One scenario's word: not-applicable on semantics it does not meet, else what its steps showed.
export function scenarioResult(kit, s) {
  const fit = meets(kit.adapter.semantics, s.needs);
  if (fit.unknown.length || fit.unmet.length) return { id: s.id, ops: s.ops, outcome: "not-applicable", why: { unknown: fit.unknown, unmet: fit.unmet.map((u) => u.field) } };
  const r = s.run(kit);
  return { id: s.id, ops: s.ops, outcome: r.ok ? "passed" : "failed", saw: r.saw };
}
