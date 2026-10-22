// WHICH adapter answers one family operation for one bound resource (ADR 0035).
//
// Ordered rows, the last always answering. A resource the binding PINNED to an adapter (an
// observer is awaited through the adapter that armed it) is answered by that adapter or by no
// one; otherwise the transport the bound resource carries -- a token discovery set, matched and
// never interpreted -- chooses among the adapters that serve it and declare the operation, by a
// stable id. When nothing does, the answer is a GAP, boundary-scoped and named: never a
// fallback to another transport, an emulator or a fake. Fitness of an adapter's semantics for an
// obligation is decided when the test is designed (src/adapters/semantics.mjs meets) and pinned
// into the binding, so the run never re-decides it.

export const SELECT = [
  { id: "pinned", when: (q) => Boolean(q.pinned), pick: (reg, q) => pinnedOf(reg, q) },
  { id: "transport", when: (q) => Boolean(q.transport), pick: (reg, q) => servingOf(reg, q) },
  { id: "none", when: () => true, pick: (reg, q) => ({ gap: gapOf(q, "the bound resource names no transport to choose an adapter by") }) },
];

export const selectAdapter = (reg, q) => SELECT.find((row) => row.when(q)).pick(reg, q);

function pinnedOf(reg, q) {
  const a = reg?.get?.(q.pinned) ?? null;
  return a && answers(a, q) ? { adapter: a, by: "pinned" } : { gap: gapOf(q, `the adapter ${q.pinned} this resource was bound to is not registered here, or does not answer ${q.family}.${q.op}`) };
}

function servingOf(reg, q) {
  const list = (reg?.list?.() ?? []).filter((a) => a.transports.includes(q.transport) && answers(a, q)).sort((a, b) => (a.id < b.id ? -1 : 1));
  return list.length ? { adapter: list[0], by: "transport" } : { gap: gapOf(q, `no registered adapter serves ${q.family}.${q.op} over ${q.transport}`) };
}

const answers = (a, q) => Boolean(a.operations?.[opKeyOf(a, q)]);

// The key an adapter answers the operation under: its own family's name, or a shared family's
// qualified one (observe.await, fixture.cleanup) for a resource it owns.
export const opKeyOf = (a, q) => (a.family === q.family ? q.op : `${q.family}.${q.op}`);

const gapOf = (q, why) => ({ need: "capability", capability: `orbit.${q.family}.${q.op}`, context: { family: q.family, transport: q.transport ?? null }, why });
