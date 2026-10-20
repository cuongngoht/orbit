// A BOUNDED exploration of the surfaces a plan named: every control it planned,
// reached the way the map says it is reached, each touch one action inside its
// own observation boundary (src/investigation/act.mjs).
//
// For each planned control, in the plan's order (least-verified first):
//   goto its screen's URL                 a fresh start, so one control's
//                                          aftermath never becomes the next's
//   click the one opener, if it lives     a dialog or a panel has no URL
//   in a dialog or a panel
//   fill the surface's REQUIRED inputs    explore-write only, synthetic TC- values
//   click it
//
// It stops at the first gate that says no -- the action budget, the deadline, a
// wrong host, a signed-out session, a cancel -- and says which one. A control
// that fails to respond is recorded and the loop goes on; a refusal ends it,
// because every action after a refusal would face the same refusal.
import { Blocked, Refused } from "../errors.mjs";
import { act } from "./act.mjs";
import { controlOf, requiredInputs } from "./surfaces.mjs";

export function explore(w, plan) {
  const specs = plan.actions.planned.flatMap((p, i) => specsFor(w, p, i));
  const out = { actions: [], stopped: null };
  specs.reduce((o, spec) => (o.stopped ? o : stepped(w, o, spec)), out);
  return out;
}

function stepped(w, out, spec) {
  try { out.actions.push(act(w, spec).action.id); }
  catch (e) { out.stopped = stopOf(e, spec); }
  return out;
}

function stopOf(e, spec) {
  if (!(e instanceof Refused) && !(e instanceof Blocked)) throw e;
  return { at: spec.on ?? spec.url, kind: e instanceof Refused ? "refused" : "blocked", why: e.message };
}

function specsFor(w, planned, i) {
  const control = controlOf(w.ctx.graph, w.ctx.graph.edgeOn.get(planned.on));
  const fills = control.writes ? requiredInputs(w.ctx.graph, control).map((c, k) => ({ kind: "fill", on: c.key, value: syntheticValue(w, i, k) })) : [];
  return [{ kind: "goto", url: planned.reach.url, surface: planned.reach.via[0]?.from ?? control.from }, ...planned.reach.via.map((v) => ({ kind: "click", on: v.key })), ...fills, { kind: "click", on: control.key }];
}

// Unique to this investigation and this control, findable by its prefix.
export const syntheticValue = (w, i, k) => `TC-${w.id.slice(-4)}-${i + 1}${k ? `-${k}` : ""}`;
