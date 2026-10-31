// THE SPEC of ORBIT-E2E-005: what the payments consumer must do with a message it may be handed more than once, written
// from the goal's own words -- one invoice per message id, every delivery acknowledged, across a restart, two messages
// two payments -- and never from the fixture's code. Kept beside the probe and handed to no runner; the controller
// imports a FROZEN copy of it, and it never imports the target.
//
// An input is a list of orders to create and a list of deliveries, in order; a delivery says whether it comes through a
// store opened again on the same directory (a restart) or through the store the last one used. The answer is each
// delivery's acknowledgement, the number of invoices at the end, and the order and amount each invoice is for.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to a table written by hand from the goal
export const CASE = "ORBIT-E2E-005";

export const GROUPS = {
  "one-invoice": "a payment delivered again writes no second invoice",
  "acknowledged": "every delivery of a payment for a known order is acknowledged, the first and every one after",
  "after-restart": "a payment delivered again after the store is opened again still writes no second invoice",
  "distinct": "two different payment messages are two payments, even for one order",
  "others": "a payment for an unknown order is not acknowledged and a message that is not a payment is skipped, as before",
  "seeded": "seeded interleavings of deliveries, redeliveries and restarts",
};

// ---- the reference model, as the goal words it ---------------------------------------------------------------------------

const totalOf = (lines) => lines.reduce((sum, l) => sum + l.qty * l.unitMinor, 0);

const DELIVERY = [
  { when: (msg) => msg.type !== "order.paid", run: (st) => ({ ...st, ack: true }) },
  { when: (msg, st) => st.done.includes(msg.id), run: (st) => ({ ...st, ack: true }) },
  { when: (msg, st, orders) => !(msg.order >= 1 && msg.order <= orders.length), run: (st) => ({ ...st, ack: false }) },
  { when: () => true, run: (st, msg, orders) => ({ done: [...st.done, msg.id], invoices: [...st.invoices, `${msg.order}:${totalOf(orders[msg.order - 1])}`], ack: true }) },
];

const delivered = (orders) => (acc, msg, n) => ((st) => ({ st, out: [...acc.out, `${n + 1}:ack=${st.ack}`] }))(DELIVERY.find((d) => d.when(msg, acc.st, orders)).run(acc.st, msg, orders));

export const answersOf = (input) => ((end) => [...end.out, `invoices=${end.st.invoices.length}`, ...end.st.invoices.map((inv) => `invoice=${inv}`)])(input.messages.reduce(delivered(input.orders), { st: { done: [], invoices: [], ack: null }, out: [] }));

// ---- the checks written by hand ------------------------------------------------------------------------------------------

const paid = (id, order, restart = false) => ({ id, type: "order.paid", order, restart });
const other = (id, order) => ({ id, type: "order.shipped", order, restart: false });
const deliveries = (orders, messages) => ({ call: "deliveries", orders, messages });

const A = [{ qty: 1, unitMinor: 900 }];
const B = [{ qty: 4, unitMinor: 125 }];

const HAND = [
  ["one-invoice", deliveries([A], [paid("m-1", 1), paid("m-1", 1)]), ["1:ack=true", "2:ack=true", "invoices=1", "invoice=1:900"]],
  ["one-invoice", deliveries([A], [paid("m-1", 1), paid("m-1", 1), paid("m-1", 1), paid("m-1", 1)]), ["1:ack=true", "2:ack=true", "3:ack=true", "4:ack=true", "invoices=1", "invoice=1:900"]],
  ["acknowledged", deliveries([A, B], [paid("m-1", 1), paid("m-2", 2), paid("m-1", 1), paid("m-2", 2)]), ["1:ack=true", "2:ack=true", "3:ack=true", "4:ack=true", "invoices=2", "invoice=1:900", "invoice=2:500"]],
  ["after-restart", deliveries([A], [paid("m-1", 1), paid("m-1", 1, true)]), ["1:ack=true", "2:ack=true", "invoices=1", "invoice=1:900"]],
  ["after-restart", deliveries([A, B], [paid("m-2", 2, true), paid("m-1", 1, true), paid("m-2", 2, true), paid("m-1", 1)]), ["1:ack=true", "2:ack=true", "3:ack=true", "4:ack=true", "invoices=2", "invoice=2:500", "invoice=1:900"]],
  ["distinct", deliveries([A], [paid("m-1", 1), paid("m-2", 1)]), ["1:ack=true", "2:ack=true", "invoices=2", "invoice=1:900", "invoice=1:900"]],
  ["distinct", deliveries([A], [paid("m-1", 1), paid("m-2", 1), paid("m-1", 1), paid("m-2", 1, true)]), ["1:ack=true", "2:ack=true", "3:ack=true", "4:ack=true", "invoices=2", "invoice=1:900", "invoice=1:900"]],
  ["others", deliveries([A], [paid("m-1", 2), paid("m-1", 2)]), ["1:ack=false", "2:ack=false", "invoices=0"]],
  ["others", deliveries([A], [other("m-1", 1), other("m-1", 1), paid("m-2", 1)]), ["1:ack=true", "2:ack=true", "3:ack=true", "invoices=1", "invoice=1:900"]],
];

// The acknowledgement group judges the acknowledgements alone; every other group judges the whole answer.
const expectOf = (group, input) => ((all) => (group === "acknowledged" ? { has: all.filter((f) => f.includes(":ack=")) } : { exactly: all }))(answersOf(input));

const FIXED = HAND.map(([group, input]) => ({ group, input, expect: expectOf(group, input) }));

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

// A delivery: often one already sent (a redelivery, now and then after a restart), else a new payment or another kind.
const again = (r, sent) => ({ ...sent[int(r, sent.length)], restart: r() < 0.4 });

const fresh = (r, n, k) => (r() < 0.12 ? other(`m-${k}`, 1 + int(r, n)) : paid(`m-${k}`, 1 + int(r, n + (r() < 0.1 ? 1 : 0)), r() < 0.2));

const seededMessage = (r, n, sent) => (sent.length && r() < 0.45 ? again(r, sent) : fresh(r, n, sent.length + 1));

const seededInput = (r) => ((orders) => deliveries(orders, Array.from({ length: 3 + int(r, 7) }).reduce((sent) => [...sent, seededMessage(r, orders.length, sent)], [])))(Array.from({ length: 1 + int(r, 3) }, () => seededLines(r)));

const seeded = (r) => ((input) => ({ group: "seeded", input, expect: { exactly: answersOf(input) } }))(seededInput(r));

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  return numbered([...FIXED, ...Array.from({ length: Math.max(16, samples) }, () => seeded(r))]);
}

// ---- the reference model, held to what the goal says in words ------------------------------------------------------------

export const selfTest = () => HAND.filter(([, input, want]) => JSON.stringify(answersOf(input)) !== JSON.stringify(want)).map(([group, input]) => `the reference model disagrees with the goal on ${group}: ${input.messages.map((m) => `${m.type}:${m.id}->${m.order}${m.restart ? "!" : ""}`).join(" ")}`);
