// Which needs stopped being valid, and why -- by DEPENDENCY, never all at once.
//
// A need rests on three kinds of thing, and each is measured its own way:
//
//   fact      the requirement facts it depends on, compared between the snapshot the work
//             adopted and the newest one. Only the needs that depend on a fact that moved
//             go stale; a work is not thrown away because one sentence changed.
//   binding   the provider it was bound to, by fingerprint against the registry now
//   scope     the project files it is about, hashed when it was settled and again now
//
// Each row of INVALIDATE finds the needs one dimension touched, as `{need, because, from}`,
// where `from` names what moved down to the state it moved to. A line is written once per
// `from`: settling a need again and finding the same fact at the same revision does not stale
// it a second time, and a fact that moves AGAIN is a new `from`. Nothing here re-reads the
// requirement, calls a provider or settles anything.
import { STALE, measure } from "../freshness.mjs";
import { revalidate } from "./bind.mjs";
import { numbered, stateOf } from "./model.mjs";
import { rootOf } from "./store.mjs";

const signature = (entry) => (entry ? `${entry.revision}|${entry.status}|${entry.digest}` : "absent");

const entriesOf = (snapshot) => new Map((snapshot?.facts ?? []).map((f) => [f.id, f]));

// The facts that differ between what the work adopted and what is newest, by the revision
// and state each one is at now. Nothing to say when either side cannot be read.
export function changedFacts(adopted, latest) {
  if (!adopted || !latest || adopted.id === latest.id) return new Map();
  const then = entriesOf(adopted);
  const now = entriesOf(latest);
  const ids = [...new Set([...then.keys(), ...now.keys()])];
  return new Map(ids.filter((id) => signature(then.get(id)) !== signature(now.get(id))).map((id) => [id, now.get(id)]));
}

const fromFact = (id, entry) => (entry ? `${id}@${entry.revision}/${entry.status}` : `${id}@gone`);

function byFacts(w, model) {
  const root = rootOf(model.meta.id);
  const changed = changedFacts(w.snapshot(model.snapshot?.snapshot, root), w.latestSnapshot(root));
  return [...model.needs.values()].flatMap((n) => n.dependsOn.filter((d) => changed.has(d)).map((d) => ({ need: n.id, because: "fact", from: fromFact(d, changed.get(d)) })));
}

function byBindings(w, model) {
  const effective = w.effective();
  return [...model.bindings.values()].filter((b) => b.provider && revalidate(b, effective) !== "current").map((b) => ({ need: b.need, because: "binding", from: `${b.provider.key}#${b.fingerprint}` }));
}

// What the files hashed to when the need was settled, in the shape `measure` reads.
const baselineOf = (model, need) => ({ scopes: Object.fromEntries(Object.entries(model.settled.get(need.id)?.scopes ?? {}).map(([path, hash]) => [path, { hash }])) });

function movedFor(w, model, need) {
  const measured = measure([{ scope: need.scope }], baselineOf(model, need), w.source);
  return Object.entries(measured).filter(([, v]) => v.state === STALE).map(([path, v]) => ({ need: need.id, because: "scope", from: `${path}#${v.hash}` }));
}

// Only a need that was SETTLED has a result resting on files; unknown (no baseline, or an
// edit the index cannot see) is not a claim that anything moved.
function byScopes(w, model) {
  if (!w.source) return [];
  return [...model.needs.values()].filter((n) => n.scope.length && stateOf(n, model) === "satisfied").flatMap((n) => movedFor(w, model, n));
}

export const INVALIDATE = [
  { name: "fact", because: "fact", find: byFacts },
  { name: "binding", because: "binding", find: byBindings },
  { name: "scope", because: "scope", find: byScopes },
];

const recorded = (model, row) => (model.stale.get(row.need) ?? []).some((s) => s.because === row.because && s.from === row.from);

const live = (model, row) => model.needs.has(row.need) && stateOf(model.needs.get(row.need), model) !== "not-applicable";

const distinct = (rows) => rows.filter((r, i) => rows.findIndex((x) => x.need === r.need && x.because === r.because && x.from === r.from) === i);

// Every need a dimension touched that is not already recorded as touched by the same thing.
export function invalidated(w, model) {
  const found = distinct(INVALIDATE.flatMap((row) => row.find(w, model)));
  const fresh = found.filter((r) => live(model, r) && !recorded(model, r));
  return numbered(model, "stale", fresh).map((row) => w.works.append(model.meta.id, "stale", row));
}
