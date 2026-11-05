// THE SPEC of the refund approval rule (ORBIT-ACT-005, its Vietnamese twin ORBIT-ACT-006, and ORBIT-ACT-008's outcome
// metric): what every request of a sequence must answer once refunds follow docs/refunds.md -- written from that
// document's own words, as a small state machine (orders open or shipped; refunds approved or pending) and never from the
// fixture's code. Kept beside the probe and handed to no runner; the controller imports a FROZEN copy of it, and it never
// imports the target.
//
// An input is a sequence of requests against one fresh store; `$k` in a path is the id the k-th order created in that
// sequence was given, and `$r<j>` the id the j-th refund it asked for was given. The answer is each request's status and,
// when its body names one, the state it names -- an order's, or a refund's -- in order.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to a table written by hand from the document
export const CASE = "ORBIT-ACT-005";

export const GROUPS = {
  "small-approved": "a refund of at most 5,000 minor units, asked for by a clerk or a manager, is approved at once",
  "large-pending": "a refund of more than 5,000 minor units waits for a manager, whoever asked",
  "manager-approves": "a manager approves a pending refund",
  "authorization": "only a clerk or a manager may ask for a refund, and only a manager may approve one: 403 otherwise, nothing changed",
  "shipped-only": "a refund is asked for only on a shipped order: 409 otherwise",
  "never-more": "a refund is never more than what is left of the order once its approved and pending refunds are counted, and never zero: 400",
  "approve-once": "a refund that is not pending is not approved again: 409",
  "unknown": "a refund on an order nobody has, or an approval of a refund nobody asked for, is 404",
  "other-routes": "creating, reading and shipping orders behave as before",
  "seeded": "seeded sequences of orders, refunds and approvals: every answer as the document has it",
};

// ---- the reference model, as the document words it ----------------------------------------------------------------------

export const AT_ONCE_MINOR = 5000;

const ASKERS = ["clerk", "manager"];

const known = (q, orders) => q.k >= 1 && q.k <= orders.length;

const refundsOf = (orders) => orders.flatMap((o, k) => o.refunds.map((r) => ({ ...r, k: k + 1 })));

const leftOf = (o) => o.total - o.refunds.filter((r) => r.state !== "refused").reduce((n, r) => n + r.amount, 0);

const withOrder = (orders, k, change) => orders.map((o, i) => (i === k - 1 ? change(o) : o));

const refundAt = (orders, j) => refundsOf(orders)[j - 1] ?? null;

const ownRefund = (q, orders) => Boolean(refundAt(orders, q.j)) && refundAt(orders, q.j).k === q.k;

const approvedAt = (orders, j) => orders.map((o, i) => ({ ...o, refunds: o.refunds.map((r) => (r.j === j ? { ...r, state: "approved" } : r)) }));

const added = (orders, q, state) => withOrder(orders, q.k, (o) => ({ ...o, refunds: [...o.refunds, { j: refundsOf(orders).length + 1, amount: q.amount, state }] }));

const fits = (q, orders) => Number.isInteger(q.amount) && q.amount > 0 && q.amount <= leftOf(orders[q.k - 1]);

const ANSWER = [
  { when: (q) => q.op === "create", run: (orders, q) => ["201:open", [...orders, { total: q.unit, state: "open", refunds: [] }]] },
  { when: (q, orders) => !known(q, orders), run: (orders) => ["404:-", orders] },
  { when: (q) => q.op === "get", run: (orders, q) => [`200:${orders[q.k - 1].state}`, orders] },
  { when: (q, orders) => q.op === "ship" && orders[q.k - 1].state !== "open", run: (orders) => ["409:-", orders] },
  { when: (q) => q.op === "ship", run: (orders, q) => ["200:shipped", withOrder(orders, q.k, (o) => ({ ...o, state: "shipped" }))] },
  { when: (q, orders) => q.op === "approve" && !ownRefund(q, orders), run: (orders) => ["404:-", orders] },
  { when: (q) => q.op === "approve" && q.role !== "manager", run: (orders) => ["403:-", orders] },
  { when: (q, orders) => q.op === "approve" && refundAt(orders, q.j).state !== "pending", run: (orders) => ["409:-", orders] },
  { when: (q) => q.op === "approve", run: (orders, q) => ["200:approved", approvedAt(orders, q.j)] },
  { when: (q) => !ASKERS.includes(q.role), run: (orders) => ["403:-", orders] },
  { when: (q, orders) => orders[q.k - 1].state !== "shipped", run: (orders) => ["409:-", orders] },
  { when: (q, orders) => !fits(q, orders), run: (orders) => ["400:-", orders] },
  { when: (q) => q.amount <= AT_ONCE_MINOR, run: (orders, q) => ["201:approved", added(orders, q, "approved")] },
  { when: () => true, run: (orders, q) => ["201:pending", added(orders, q, "pending")] },
];

export const answersOf = (steps) => steps.reduce((acc, q) => ((r) => ({ out: [...acc.out, `${acc.out.length + 1}:${r[0]}`], orders: r[1] }))(ANSWER.find((a) => a.when(q, acc.orders)).run(acc.orders, q)), { out: [], orders: [] }).out;

// ---- requests, as the probe sends them -------------------------------------------------------------------------------------

const create = (unit) => ({ op: "create", unit });
const get = (k) => ({ op: "get", k });
const ship = (k) => ({ op: "ship", k });
const refund = (k, amount, role) => ({ op: "refund", k, amount, role });
const approve = (k, j, role) => ({ op: "approve", k, j, role });

const byOf = (role) => (role === null ? {} : { by: { role } });

const REQUEST = {
  create: (q) => ({ method: "POST", path: "/orders", body: { customer: "Ada", lines: [{ qty: 1, unitMinor: q.unit }] } }),
  get: (q) => ({ method: "GET", path: `/orders/$${q.k}` }),
  ship: (q) => ({ method: "POST", path: `/orders/$${q.k}/ship` }),
  refund: (q) => ({ method: "POST", path: `/orders/$${q.k}/refunds`, body: { amountMinor: q.amount, ...byOf(q.role) } }),
  approve: (q) => ({ method: "POST", path: `/orders/$${q.k}/refunds/$r${q.j}/approve`, body: byOf(q.role) }),
};

// An order or a refund nobody has is one the sequence never made: its number is past every one it made.
const unmade = (req, q, made) => ({ ...req, path: req.path.replace(q.k > made.orders ? `$${q.k}` : "\u0000", "ord-9999").replace(q.j > made.refunds ? `$r${q.j}` : "\u0000", "rfd-9999") });

const madeBefore = (steps, i) => ({ orders: steps.slice(0, i).filter((q) => q.op === "create").length, refunds: answersOf(steps.slice(0, i)).filter((a, n) => steps[n].op === "refund" && /:201:/.test(a)).length });

const inputOf = (steps) => ({ call: "ops", steps: steps.map((q, i) => unmade(REQUEST[q.op](q), q, madeBefore(steps, i))) });

const check = (group, steps) => ({ group, input: inputOf(steps), expect: { exactly: answersOf(steps) } });

// ---- the checks written by hand ------------------------------------------------------------------------------------------

const shipped = (unit) => [create(unit), ship(1)];

const HAND = [
  ["small-approved", [...shipped(20000), refund(1, 5000, "clerk")], ["1:201:open", "2:200:shipped", "3:201:approved"]],
  ["small-approved", [...shipped(20000), refund(1, 1, "manager"), refund(1, 4999, "clerk")], ["1:201:open", "2:200:shipped", "3:201:approved", "4:201:approved"]],
  ["large-pending", [...shipped(20000), refund(1, 5001, "clerk")], ["1:201:open", "2:200:shipped", "3:201:pending"]],
  ["large-pending", [...shipped(20000), refund(1, 9000, "manager")], ["1:201:open", "2:200:shipped", "3:201:pending"]],
  ["manager-approves", [...shipped(20000), refund(1, 8000, "clerk"), approve(1, 1, "manager")], ["1:201:open", "2:200:shipped", "3:201:pending", "4:200:approved"]],
  ["authorization", [...shipped(20000), refund(1, 8000, "clerk"), approve(1, 1, "clerk"), approve(1, 1, null)], ["1:201:open", "2:200:shipped", "3:201:pending", "4:403:-", "5:403:-"]],
  ["authorization", [...shipped(20000), refund(1, 100, "customer"), refund(1, 100, null)], ["1:201:open", "2:200:shipped", "3:403:-", "4:403:-"]],
  ["authorization", [...shipped(20000), refund(1, 8000, "clerk"), approve(1, 1, "clerk"), approve(1, 1, "manager")], ["1:201:open", "2:200:shipped", "3:201:pending", "4:403:-", "5:200:approved"]],
  ["shipped-only", [create(20000), refund(1, 100, "clerk"), get(1)], ["1:201:open", "2:409:-", "3:200:open"]],
  ["never-more", [...shipped(10000), refund(1, 10001, "manager")], ["1:201:open", "2:200:shipped", "3:400:-"]],
  ["never-more", [...shipped(10000), refund(1, 6000, "clerk"), refund(1, 4001, "clerk"), refund(1, 4000, "clerk")], ["1:201:open", "2:200:shipped", "3:201:pending", "4:400:-", "5:201:approved"]],
  ["never-more", [...shipped(10000), refund(1, 0, "clerk")], ["1:201:open", "2:200:shipped", "3:400:-"]],
  ["approve-once", [...shipped(20000), refund(1, 8000, "clerk"), approve(1, 1, "manager"), approve(1, 1, "manager")], ["1:201:open", "2:200:shipped", "3:201:pending", "4:200:approved", "5:409:-"]],
  ["approve-once", [...shipped(20000), refund(1, 100, "clerk"), approve(1, 1, "manager")], ["1:201:open", "2:200:shipped", "3:201:approved", "4:409:-"]],
  ["unknown", [refund(1, 100, "clerk")], ["1:404:-"]],
  ["unknown", [...shipped(20000), approve(1, 1, "manager")], ["1:201:open", "2:200:shipped", "3:404:-"]],
  ["other-routes", [create(1000), ship(1), ship(1), get(1)], ["1:201:open", "2:200:shipped", "3:409:-", "4:200:shipped"]],
];

const FIXED = HAND.map(([group, steps]) => check(group, steps));

// ---- a seeded generator, the same sequences for the same seed ------------------------------------------------------------

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

const amountNear = (r) => [AT_ONCE_MINOR, AT_ONCE_MINOR + 1, 1 + int(r, AT_ONCE_MINOR), AT_ONCE_MINOR + 1 + int(r, 20000), 0][int(r, 5)];

const ROLES = ["clerk", "manager", "clerk", "manager", "customer", null];

const orderIn = (r, made) => 1 + int(r, Math.max(1, made));

const refundIn = (r, asked) => 1 + int(r, asked + (r() < 0.1 ? 1 : 0));

const counts = (steps) => ({ orders: steps.filter((q) => q.op === "create").length, refunds: steps.filter((q) => q.op === "refund").length });

const seededStep = (r, c) => [() => refund(orderIn(r, c.orders), amountNear(r), ROLES[int(r, 6)]), () => refund(orderIn(r, c.orders), amountNear(r), ROLES[int(r, 4)]), () => approve(orderIn(r, c.orders), refundIn(r, c.refunds), ROLES[int(r, 6)]), () => ship(orderIn(r, c.orders)), () => get(orderIn(r, c.orders))][int(r, 5)]();

const grown = (r, steps) => [...steps, seededStep(r, counts(steps))];

const seededSteps = (r) => Array.from({ length: 3 + int(r, 7) }).reduce((steps) => grown(r, steps), [create(5000 + int(r, 30000)), ...(r() < 0.8 ? [ship(1)] : [])]);

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  return numbered([...FIXED, ...Array.from({ length: Math.max(16, samples) }, () => check("seeded", seededSteps(r)))]);
}

// ---- the reference model, held to what the document says in words --------------------------------------------------------

export const selfTest = () => HAND.filter(([, steps, want]) => JSON.stringify(answersOf(steps)) !== JSON.stringify(want)).map(([group, steps]) => `the reference model disagrees with the document on ${group}: ${steps.map((q) => q.op + (q.k ?? "")).join(" ")}`);
