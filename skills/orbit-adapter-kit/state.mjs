// The STATE conformance kit (doc §5.4, §5.5, §5.10): the scenarios an adapter that reads durable state
// below the interface is held to, on a REAL store, through its REAL helper. It knows no product and
// no table: which state it reads, under which key, is the SYSTEM's -- bound values the caller hands
// in (`system.bound`) -- and how many rows really hold a key is asked of a WITNESS the caller binds
// (`system.witness`), never of the adapter under test. A read that comes back with what the
// witness wrote, nothing for a key nobody wrote, and a refusal -- with the store untouched -- for a
// request that tries to say more than values, is a read that can be ruled on.
import { meets } from "../../src/adapters/semantics.mjs";

export const SCENARIOS = [
  { id: "count-by-key", family: "state", ops: ["read"], needs: {}, run: countByKey },
  { id: "absent-is-zero", family: "state", ops: ["read"], needs: {}, run: absentIsZero },
  { id: "values-are-parameters", family: "state", ops: ["read"], needs: {}, run: valuesAreParameters },
  { id: "names-are-refused", family: "state", ops: ["read"], needs: {}, run: namesAreRefused },
];

// The rows the witness wrote under a key are the rows the adapter counts, and the sample is theirs.
function countByKey(kit) {
  const out = kit.ask("read", { key: kit.system.bound.key, limit: 2 }, { stateRef: kit.system.bound.state });
  const expected = kit.system.witness.count(kit.system.bound.key);
  return { ok: out.ok && expected > 0 && out.value.count === expected && out.value.rows.length === Math.min(2, expected), saw: { count: out.value?.count ?? null, sampled: out.value?.rows?.length ?? null, expected } };
}

function absentIsZero(kit) {
  const out = kit.ask("read", { key: `nobody-wrote-${kit.system.nonce}` }, { stateRef: kit.system.bound.state });
  return { ok: out.ok && out.value.count === 0 && out.value.rows.length === 0, saw: { count: out.value?.count ?? null } };
}

// A value that reads as SQL is only ever a value: it matches no row, and the store holds what it held.
function valuesAreParameters(kit) {
  const before = kit.system.witness.total();
  const out = kit.ask("read", { key: `x' OR '1'='1'; DELETE FROM ${kit.system.bound.state.table}; --` }, { stateRef: kit.system.bound.state });
  return { ok: out.ok && out.value.count === 0 && kit.system.witness.total() === before, saw: { count: out.value?.count ?? null, before, after: kit.system.witness.total() } };
}

// A column a request names is a name, held to what a name may be: one that would say more is refused before
// anything is sent.
function namesAreRefused(kit) {
  const out = kit.ask("read", { match: { "status = status OR 1": "1" } }, { stateRef: kit.system.bound.state });
  return { ok: !out.ok && out.class === "refused", saw: { class: out.class ?? null } };
}

// One scenario's word for one adapter: not applicable on semantics it does not meet.
export function scenarioResult(kit, s) {
  const fit = meets(kit.adapter.semantics, s.needs);
  if (fit.unknown.length || fit.unmet.length) return { id: s.id, ops: s.ops, outcome: "not-applicable", why: { unknown: fit.unknown, unmet: fit.unmet.map((u) => u.field) } };
  const r = s.run(kit);
  return { id: s.id, ops: s.ops, outcome: r.ok ? "passed" : "failed", saw: r.saw };
}
