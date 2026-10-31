// THE SPEC of ORBIT-E2E-007: the goal of ORBIT-E2E-004 -- what the payments consumer must have done by the time it
// acknowledges a message -- carried through a session that was cut off mid-work. The hidden checks are ORBIT-E2E-004's,
// written
// from the goal's own words -- an acknowledged payment's invoice is on disk, once per message id; an unknown order is
// never acknowledged; anything else is skipped -- and never from the fixture's code. What the interruption adds is read
// off the owners' records (`records`): an action a crash left open was closed as interrupted and taken again as a new
// action that settled -- never settled as if it had run -- and nothing is left running. Kept beside the probe and handed to
// no runner; the controller imports a FROZEN copy of it, and it never imports the target.
//
// An input is a list of orders to create and a list of messages to deliver, in order, each through a store opened again
// on the same directory (so nothing a process keeps in memory counts). After EVERY delivery the probe opens the store
// once more and counts the invoices on disk; at the end it names each invoice by the order it is for and its amount.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to a table written by hand from the goal
//   records(readBack) -> [{ id, ok, says }]  what the engineering task's own journal must show after the interruption
export const CASE = "ORBIT-E2E-007";

export const GROUPS = {
  "on-disk-at-ack": "every acknowledged payment's invoice is on disk when the store is opened again right after the acknowledgement",
  "content": "an invoice names its order and the order's total",
  "once": "a payment delivered again is acknowledged and writes no second invoice",
  "unknown-order": "a payment for an order nobody has is not acknowledged, and writes nothing",
  "not-a-payment": "a message that is not a payment is acknowledged and skipped, and writes nothing",
  "seeded": "seeded deliveries: every acknowledgement and every invoice on disk as the goal has it",
};

// ---- the reference model, as the goal words it ---------------------------------------------------------------------------

const totalOf = (lines) => lines.reduce((sum, l) => sum + l.qty * l.unitMinor, 0);

// One delivery against what the consumer has done so far: whether it is acknowledged, and what is on disk after it.
const DELIVERY = [
  { when: (msg) => msg.type !== "order.paid", run: (st) => ({ ...st, ack: true }) },
  { when: (msg, st) => st.done.includes(msg.id), run: (st) => ({ ...st, ack: true }) },
  { when: (msg, st, orders) => !(msg.order >= 1 && msg.order <= orders.length), run: (st) => ({ ...st, ack: false }) },
  { when: () => true, run: (st, msg, orders) => ({ done: [...st.done, msg.id], invoices: [...st.invoices, `${msg.order}:${totalOf(orders[msg.order - 1])}`], ack: true }) },
];

const delivered = (orders) => (acc, msg, n) => ((st) => ({ st, out: [...acc.out, `${n + 1}:ack=${st.ack}:on-disk=${st.invoices.length}`] }))(DELIVERY.find((d) => d.when(msg, acc.st, orders)).run(acc.st, msg, orders));

export const answersOf = (input) => ((end) => [...end.out, ...end.st.invoices.map((inv) => `invoice=${inv}`)])(input.messages.reduce(delivered(input.orders), { st: { done: [], invoices: [], ack: null }, out: [] }));

// ---- the checks written by hand ------------------------------------------------------------------------------------------

const paid = (id, order) => ({ id, type: "order.paid", order });
const other = (id, order) => ({ id, type: "order.shipped", order });
const deliveries = (orders, messages) => ({ call: "deliveries", orders, messages });

const A = [{ qty: 3, unitMinor: 400 }];
const B = [{ qty: 1, unitMinor: 999 }, { qty: 2, unitMinor: 50 }];

const HAND = [
  ["on-disk-at-ack", deliveries([A], [paid("m-1", 1)]), ["1:ack=true:on-disk=1", "invoice=1:1200"]],
  ["on-disk-at-ack", deliveries([A, B], [paid("m-1", 1), paid("m-2", 2)]), ["1:ack=true:on-disk=1", "2:ack=true:on-disk=2", "invoice=1:1200", "invoice=2:1099"]],
  ["on-disk-at-ack", deliveries([A, B], [paid("m-2", 2), paid("m-1", 1)]), ["1:ack=true:on-disk=1", "2:ack=true:on-disk=2", "invoice=2:1099", "invoice=1:1200"]],
  ["content", deliveries([B], [paid("m-9", 1)]), ["1:ack=true:on-disk=1", "invoice=1:1099"]],
  ["content", deliveries([A, B, A], [paid("m-3", 3)]), ["1:ack=true:on-disk=1", "invoice=3:1200"]],
  ["once", deliveries([A], [paid("m-1", 1), paid("m-1", 1)]), ["1:ack=true:on-disk=1", "2:ack=true:on-disk=1", "invoice=1:1200"]],
  ["once", deliveries([A, B], [paid("m-1", 1), paid("m-2", 2), paid("m-1", 1), paid("m-2", 2)]), ["1:ack=true:on-disk=1", "2:ack=true:on-disk=2", "3:ack=true:on-disk=2", "4:ack=true:on-disk=2", "invoice=1:1200", "invoice=2:1099"]],
  ["unknown-order", deliveries([A], [paid("m-1", 2)]), ["1:ack=false:on-disk=0"]],
  ["unknown-order", deliveries([], [paid("m-1", 1), paid("m-1", 1)]), ["1:ack=false:on-disk=0", "2:ack=false:on-disk=0"]],
  ["not-a-payment", deliveries([A], [other("m-1", 1)]), ["1:ack=true:on-disk=0"]],
  ["not-a-payment", deliveries([A, B], [other("m-1", 1), other("m-2", 2), other("m-1", 1)]), ["1:ack=true:on-disk=0", "2:ack=true:on-disk=0", "3:ack=true:on-disk=0"]],
];

const FIXED = HAND.map(([group, input]) => ({ group, input, expect: { exactly: answersOf(input) } }));

// ---- a seeded generator, the same deliveries for the same seed -----------------------------------------------------------

export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    const t = Math.imul(s ^ (s >>> 15), s | 1);
    const u = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((u ^ (u >>> 14)) >>> 0) / 4294967296;
  };
}

const int = (r, n) => Math.floor(r() * n);

const seededLines = (r) => Array.from({ length: 1 + int(r, 3) }, () => ({ qty: 1 + int(r, 5), unitMinor: 1 + int(r, 3000) }));

// A message: mostly a payment for an order made (sometimes one that is not), now and then another kind, often again.
const seededMessage = (r, n, sent) => (sent.length && r() < 0.3 ? sent[int(r, sent.length)] : r() < 0.15 ? other(`m-${sent.length + 1}`, 1 + int(r, n)) : paid(`m-${sent.length + 1}`, 1 + int(r, n + (r() < 0.15 ? 1 : 0))));

const seededInput = (r) => ((orders) => deliveries(orders, Array.from({ length: 2 + int(r, 6) }).reduce((sent) => [...sent, seededMessage(r, orders.length, sent)], [])))(Array.from({ length: 1 + int(r, 3) }, () => seededLines(r)));

const seeded = (r) => ((input) => ({ group: "seeded", input, expect: { exactly: answersOf(input) } }))(seededInput(r));

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  return numbered([...FIXED, ...Array.from({ length: Math.max(16, samples) }, () => seeded(r))]);
}

// ---- the reference model, held to what the goal says in words ------------------------------------------------------------

export const selfTest = () => HAND.filter(([, input, want]) => JSON.stringify(answersOf(input)) !== JSON.stringify(want)).map(([group, input]) => `the reference model disagrees with the goal on ${group}: ${input.messages.map((m) => `${m.type}:${m.id}->${m.order}`).join(" ")}`);

// ---- what the interruption must have left on the owners' records ----------------------------------------------------------

const ordinal = (a) => Number(String(a.id).replace(/\D+/g, "")) || 0;

const interrupted = (a) => /^interrupted/.test(a.why ?? "");

// An action closed as interrupted carries no receipt -- nothing it did was taken as its outcome -- and a later action of
// the same tool settled: it was taken again as a new action, never sent again as the old one.
const takenAgain = (rb, a) => (a.receipts ?? []).length === 0 && rb.actions.some((b) => b.tool === a.tool && b.state === "succeeded" && ordinal(b) > ordinal(a));

export const records = (rb) => [
  { id: "interrupted-taken-again", says: "every action the interruption left open was closed as interrupted, with no outcome taken from it, and taken again as a new action that settled", ok: rb.actions.filter(interrupted).every((a) => takenAgain(rb, a)) },
  { id: "nothing-running", says: "no action of the engineering task is left running", ok: rb.actions.every((a) => a.state !== "running") },
];
