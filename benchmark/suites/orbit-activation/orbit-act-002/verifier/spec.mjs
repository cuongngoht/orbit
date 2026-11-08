// THE SPEC of ORBIT-ACT-002: what every request of a sequence must answer once orders over 10,000 need a manager's
// approval before they are confirmed -- written from docs/approvals.md's own words, the rule the prompt names, as a small
// state machine (open, confirmed; approved or not) and never from the fixture's code. Kept beside the probe and handed to
// no runner; the controller imports a FROZEN copy of it, and it never imports the target.
//
// An input is a sequence of requests against one fresh store; `$k` in a path is the id the k-th order created in that
// sequence was given. The answer is each request's status and, when its body names one, the order's state, in order.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to a table written by hand from the rule
export const CASE = "ORBIT-ACT-002";

export const GROUPS = {
  "small-confirmed": "an order of 10,000.00 or less is confirmed at once, and reads back confirmed",
  "large-held": "an order over 10,000.00 is not confirmed without a manager's approval: 403, and it stays open",
  "manager-approves": "a manager's approval lets a large order be confirmed",
  "others-refused": "an approval by any other role, or none, is refused and approves nothing",
  "discounted-total": "the limit is held to the order's total after its discount",
  "confirm-once": "an order that is not open is not confirmed again: 409",
  "unknown": "confirming or approving an order nobody has is 404",
  "other-routes": "creating, reading and shipping orders behave as before",
  "seeded": "seeded sequences of creating, approving and confirming orders: every answer as the rule has it",
};

// ---- the reference model, as the rule words it ------------------------------------------------------------------------

export const LIMIT_MINOR = 1000000;

const totalOf = (q) => Math.floor((q.unit * (100 - (q.percent ?? 0)) + 50) / 100);

const known = (q, orders) => q.k >= 1 && q.k <= orders.length;

const at = (orders, k, change) => orders.map((o, i) => (i === k - 1 ? { ...o, ...change } : o));

const ANSWER = [
  { when: (q) => q.op === "create" && !q.valid, run: (orders) => ["400:-", orders] },
  { when: (q) => q.op === "create", run: (orders, q) => ["201:open", [...orders, { total: totalOf(q), state: "open", approved: false }]] },
  { when: (q, orders) => q.op === "nowhere" || !known(q, orders), run: (orders) => ["404:-", orders] },
  { when: (q) => q.op === "get", run: (orders, q) => [`200:${orders[q.k - 1].state}`, orders] },
  { when: (q) => q.op === "approve" && q.role !== "manager", run: (orders) => ["403:-", orders] },
  { when: (q) => q.op === "approve", run: (orders, q) => [`200:${orders[q.k - 1].state}`, at(orders, q.k, { approved: true })] },
  { when: (q, orders) => orders[q.k - 1].state !== "open", run: (orders) => ["409:-", orders] },
  { when: (q) => q.op === "ship", run: (orders, q) => ["200:shipped", at(orders, q.k, { state: "shipped" })] },
  { when: (q, orders) => orders[q.k - 1].total > LIMIT_MINOR && !orders[q.k - 1].approved, run: (orders) => ["403:-", orders] },
  { when: () => true, run: (orders, q) => ["200:confirmed", at(orders, q.k, { state: "confirmed" })] },
];

export const answersOf = (steps) => steps.reduce((acc, q) => ((r) => ({ out: [...acc.out, `${acc.out.length + 1}:${r[0]}`], orders: r[1] }))(ANSWER.find((a) => a.when(q, acc.orders)).run(acc.orders, q)), { out: [], orders: [] }).out;

// ---- requests, as the probe sends them -------------------------------------------------------------------------------------

const create = (unit, percent = 0) => ({ op: "create", valid: true, unit, percent });
const createBad = { op: "create", valid: false };
const get = (k) => ({ op: "get", k });
const confirm = (k) => ({ op: "confirm", k });
const approve = (k, role) => ({ op: "approve", k, role });
const ship = (k) => ({ op: "ship", k });

const pathOf = (q) => ({ get: `/orders/$${q.k}`, confirm: `/orders/$${q.k}/confirm`, approve: `/orders/$${q.k}/approve`, ship: `/orders/$${q.k}/ship` })[q.op];

const bodyOf = (q) => (q.role === null ? {} : { by: { role: q.role } });

const REQUEST = {
  create: (q) => ({ method: "POST", path: "/orders", body: q.valid ? { customer: "Ada", lines: [{ qty: 1, unitMinor: q.unit }], percent: q.percent } : { lines: [] } }),
  get: (q) => ({ method: "GET", path: pathOf(q) }),
  confirm: (q) => ({ method: "POST", path: pathOf(q) }),
  approve: (q) => ({ method: "POST", path: pathOf(q), body: bodyOf(q) }),
  ship: (q) => ({ method: "POST", path: pathOf(q) }),
};

// An order nobody has is one the sequence never made: its number is past every order it made.
const requestOf = (q, made) => (q.k > made ? { ...REQUEST[q.op](q), path: REQUEST[q.op](q).path.replace(`$${q.k}`, "ord-9999") } : REQUEST[q.op](q));

const madeBefore = (steps, i) => steps.slice(0, i).filter((q) => q.op === "create" && q.valid).length;

const inputOf = (steps) => ({ call: "ops", steps: steps.map((q, i) => requestOf(q, madeBefore(steps, i))) });

const check = (group, steps) => ({ group, input: inputOf(steps), expect: { exactly: answersOf(steps) } });

// ---- the checks written by hand ------------------------------------------------------------------------------------------

const HAND = [
  ["small-confirmed", [create(1000), confirm(1), get(1)], ["1:201:open", "2:200:confirmed", "3:200:confirmed"]],
  ["small-confirmed", [create(LIMIT_MINOR), confirm(1), get(1)], ["1:201:open", "2:200:confirmed", "3:200:confirmed"]],
  ["large-held", [create(LIMIT_MINOR + 1), confirm(1), get(1)], ["1:201:open", "2:403:-", "3:200:open"]],
  ["large-held", [create(5000000), confirm(1), confirm(1), get(1)], ["1:201:open", "2:403:-", "3:403:-", "4:200:open"]],
  ["manager-approves", [create(2000000), approve(1, "manager"), confirm(1), get(1)], ["1:201:open", "2:200:open", "3:200:confirmed", "4:200:confirmed"]],
  ["manager-approves", [create(2000000), confirm(1), approve(1, "manager"), confirm(1)], ["1:201:open", "2:403:-", "3:200:open", "4:200:confirmed"]],
  ["others-refused", [create(2000000), approve(1, "clerk"), confirm(1), get(1)], ["1:201:open", "2:403:-", "3:403:-", "4:200:open"]],
  ["others-refused", [create(2000000), approve(1, null), confirm(1)], ["1:201:open", "2:403:-", "3:403:-"]],
  ["discounted-total", [create(1100000, 10), confirm(1)], ["1:201:open", "2:200:confirmed"]],
  ["discounted-total", [create(1200000, 10), confirm(1)], ["1:201:open", "2:403:-"]],
  ["confirm-once", [create(1000), confirm(1), confirm(1), get(1)], ["1:201:open", "2:200:confirmed", "3:409:-", "4:200:confirmed"]],
  ["confirm-once", [create(1000), ship(1), confirm(1), get(1)], ["1:201:open", "2:200:shipped", "3:409:-", "4:200:shipped"]],
  ["unknown", [confirm(1)], ["1:404:-"]],
  ["unknown", [create(1000), approve(2, "manager"), get(1)], ["1:201:open", "2:404:-", "3:200:open"]],
  ["other-routes", [create(1000), ship(1), ship(1), get(1)], ["1:201:open", "2:200:shipped", "3:409:-", "4:200:shipped"]],
  ["other-routes", [createBad, get(1)], ["1:400:-", "2:404:-"]],
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

// A total near the limit, on either side of it, and now and then far from it.
const unitNear = (r) => [LIMIT_MINOR - 1 - int(r, 1000), LIMIT_MINOR, LIMIT_MINOR + 1 + int(r, 1000), 1 + int(r, 50000), 3000000 + int(r, 100000)][int(r, 5)];

const orderIn = (r, made) => 1 + int(r, made + (r() < 0.1 ? 1 : 0));

const ROLES = ["manager", "clerk", "manager", null];

const seededStep = (r, made) => [() => create(unitNear(r), int(r, 4) === 0 ? 10 : 0), () => confirm(orderIn(r, made)), () => approve(orderIn(r, made), ROLES[int(r, 4)]), () => get(orderIn(r, made)), () => confirm(orderIn(r, made))][int(r, 5)]();

const grown = (r, steps) => [...steps, seededStep(r, steps.filter((q) => q.op === "create").length)];

const seededSteps = (r) => Array.from({ length: 3 + int(r, 7) }).reduce((steps) => grown(r, steps), [create(unitNear(r))]);

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  return numbered([...FIXED, ...Array.from({ length: Math.max(16, samples) }, () => check("seeded", seededSteps(r)))]);
}

// ---- the reference model, held to what the rule says in words ------------------------------------------------------------

export const selfTest = () => HAND.filter(([, steps, want]) => JSON.stringify(answersOf(steps)) !== JSON.stringify(want)).map(([group, steps]) => `the reference model disagrees with the rule on ${group}: ${steps.map((q) => q.op + (q.k ?? "")).join(" ")}`);
