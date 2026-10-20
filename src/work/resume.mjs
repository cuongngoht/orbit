// Picking a work up where it stopped -- in another session, on another day, by another model.
//
// Everything a continuation needs is in the journal, so resuming reads only that: the needs,
// what each came to, and the frontier they leave. What it re-checks is what could have moved
// while nobody was looking, and only that -- the facts the work depends on against the newest
// requirement snapshot, the providers it bound against the registry now, the files it settled
// against the tree. Nothing is re-acquired, re-asked or rebuilt unless one of those said so.
//
// `refreshed` is the revalidation and `resume` is the revalidation plus a line saying a
// session picked the work up. A checkpoint asks for the first without the second.
import { Refused } from "../errors.mjs";
import { bindNeeds } from "./bind.mjs";
import { invalidated } from "./freshness.mjs";
import { frontierOf, modelOf, numbered, statesOf } from "./model.mjs";
import { rootOf } from "./store.mjs";

export function load(w, id) {
  const lines = w.works.read(id);
  if (lines === null) throw new Refused(`no work ${id} — start one with work start`);
  return modelOf(lines);
}

// Revalidate, then bind again what has to be bound. Stale first, so a provider that moved is
// seen against the binding it moved from, and only then asked again.
export function refreshed(w, id) {
  const stale = invalidated(w, load(w, id));
  const bound = bindNeeds(w, load(w, id));
  return { stale, bound };
}

// Where the work stands, read off its journal alone.
export function standing(w, id) {
  const model = load(w, id);
  const adopted = w.snapshot(model.snapshot?.snapshot, rootOf(id)) ?? null;
  const latest = w.latestSnapshot(rootOf(id)) ?? null;
  return { work: id, objective: model.meta.objective ?? null, snapshot: model.snapshot?.snapshot ?? null, newer: latest && latest.id !== adopted?.id ? latest.id : null, needs: statesOf(model), frontier: frontierOf(model, adopted).map((n) => ({ need: n.id, type: n.type, capability: n.capability ?? null, subject: n.subject })) };
}

function noted(w, id, done) {
  const model = load(w, id);
  const [row] = numbered(model, "resumed", [{ session: w.session ?? null, revalidated: done.bound.checked, stale: done.stale.map((s) => s.need) }]);
  return w.works.append(id, "resumed", row);
}

export function resume(w, id) {
  return w.works.transact(id, () => {
    const done = refreshed(w, id);
    noted(w, id, done);
    return { ...standing(w, id), checked: done.bound.checked, stale: done.stale, bound: done.bound.bound, opportunities: done.bound.opportunities };
  });
}
