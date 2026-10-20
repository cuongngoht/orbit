// What a work IS at any moment: a fold over its journal, and nothing stored beside it.
//
// A need's STATE is one of a small table read in order -- stale, not-applicable, satisfied,
// blocked, pending -- and derived every time, so it cannot disagree with the journal. The
// FRONTIER is what can be worked on NOW: the pending needs whose dependencies are met, in
// the order the rank column says. A need depends on requirement FACTS (met when the adopted
// snapshot lists them as standing and saying something) and on other needs (met when they
// are satisfied or not applicable).
//
// A need goes STALE by a dependency moving, and only the needs that depended on it do. What
// clears it depends on why it went stale: a provider that moved is cleared by resolving the
// need again; anything the result was DERIVED from moving is cleared only by settling it
// again, because a new provider does not undo a result that rests on an old fact.
import { Refused } from "../errors.mjs";
import { short } from "../hash.mjs";
import { settles } from "../requirements/vocab.mjs";
import { BLOCKING_STATUSES, PREFIX, WORK_SCHEMA, rankOf } from "./vocab.mjs";

// A need is what it asks, for which capability: proposing the same need twice is the one.
export const needId = (work, type, capability, subject) => `nd-${short(`${work}\u0000${type}\u0000${capability ?? ""}\u0000${subject}`, 10)}`;

// A journal from a newer engine is refused, never guessed at or written over.
export function readable(meta) {
  if ((meta?.schema ?? 1) > WORK_SCHEMA) throw new Refused(`this work was written by a newer Orbit (journal format ${meta.schema}); upgrade the plugin before working on it`);
  return meta;
}

const emptyModel = () => ({ meta: null, position: 0, needs: new Map(), bindings: new Map(), receipts: [], settled: new Map(), stale: new Map(), snapshots: [], checkpoints: [], resumed: [], records: [] });

const listed = (map, need, record) => map.set(need, [...(map.get(need) ?? []), record]);

// How each kind of line changes the picture. The first line for a need defines it, and a
// proposal of the same need again is that need, not a second.
const FOLDS = {
  created: (m, r) => { m.meta = r; },
  snapshot: (m, r) => { m.snapshots.push(r); },
  need: (m, r) => { if (!m.needs.has(r.id)) m.needs.set(r.id, { ...r, dependsOn: r.dependsOn ?? [], scope: r.scope ?? [] }); },
  binding: (m, r) => { m.bindings.set(r.need, r); },
  receipt: (m, r) => { m.receipts.push(r); },
  settled: (m, r) => { m.settled.set(r.need, r); },
  stale: (m, r) => listed(m.stale, r.need, r),
  checkpoint: (m, r) => { m.checkpoints.push(r); },
  resumed: (m, r) => { m.resumed.push(r); },
};

// The fold, and what is read off it: the position is how many lines there are, the current
// snapshot is the last one adopted. A newer journal format is refused before anything is used.
export function modelOf(records) {
  const model = emptyModel();
  for (const [n, line] of records.entries()) FOLDS[line.kind]?.(model, { ...line, n });
  readable(model.meta);
  return Object.assign(model, { records, position: records.length, snapshot: model.snapshots.at(-1) ?? null });
}

const countOf = (model, kind) => model.records.filter((r) => r.kind === kind).length;

// The next id of a kind, under the lock that stops two writers counting at once.
export const nextId = (model, kind) => `${PREFIX[kind]}-${countOf(model, kind) + 1}`;

// Several records of one kind in one go: each gets the id after the one before it.
export const numbered = (model, kind, rows) => rows.map((row, i) => ({ ...row, id: `${PREFIX[kind]}-${countOf(model, kind) + i + 1}` }));

const at = (map, need) => map.get(need)?.n ?? -1;

// The stale lines not yet cleared: a moved provider is cleared by resolving again or by
// settling; anything else the result rests on is cleared only by settling.
export function openStale(need, model) {
  const settled = at(model.settled, need.id);
  const bound = at(model.bindings, need.id);
  return (model.stale.get(need.id) ?? []).filter((s) => s.n > (s.because === "binding" ? Math.max(settled, bound) : settled));
}

const staleOpen = (need, model) => openStale(need, model).length > 0;

const settledAs = (state) => (need, model) => model.settled.get(need.id)?.state === state;

// First row that holds; the last always does.
export const NEED_STATES = [
  { name: "stale", when: staleOpen, doc: "something it rested on moved, and it has not been settled or resolved again since" },
  { name: "not-applicable", when: settledAs("not-applicable"), doc: "it turned out not to be needed" },
  { name: "satisfied", when: settledAs("satisfied"), doc: "it was settled, on evidence" },
  { name: "blocked", when: (need, model) => settledAs("blocked")(need, model) || BLOCKING_STATUSES.includes(model.bindings.get(need.id)?.status), doc: "nothing can serve it yet, or somebody said it cannot go on" },
  { name: "pending", when: () => true, doc: "it waits to be worked on" },
];

export const stateOf = (need, model) => NEED_STATES.find((s) => s.when(need, model)).name;

const dependencyMet = (id, model, standing) => {
  if (!id.startsWith("nd-")) return standing.has(id);
  const need = model.needs.get(id);
  return Boolean(need) && ["satisfied", "not-applicable"].includes(stateOf(need, model));
};

const byRank = (a, b) => rankOf(a.type) - rankOf(b.type) || a.id.localeCompare(b.id);

// What can be worked on now: pending needs whose dependencies are met, best first. A fact
// is met when the ADOPTED snapshot lists it as standing and saying something.
export function frontierOf(model, snapshot) {
  const standing = new Set((snapshot?.facts ?? []).filter((f) => settles(f.status)).map((f) => f.id));
  return [...model.needs.values()].filter((n) => stateOf(n, model) === "pending" && n.dependsOn.every((d) => dependencyMet(d, model, standing))).sort(byRank);
}

// Every need with its state, in the order they were proposed.
export const statesOf = (model) => [...model.needs.values()].map((need) => ({ need: need.id, type: need.type, subject: need.subject, capability: need.capability ?? null, state: stateOf(need, model) }));
