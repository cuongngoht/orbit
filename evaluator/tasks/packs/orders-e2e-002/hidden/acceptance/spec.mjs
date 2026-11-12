// THE SPEC of ORBIT-E2E-002: what every request of a sequence must answer once orders can be cancelled, written from the
// goal's own words as a small state machine -- open, shipped, cancelled -- and never from the fixture's code. Kept beside
// the probe and handed to no runner; the controller imports a FROZEN copy of it, and it never imports the target.
//
// An input is a sequence of requests against one fresh store; `$k` in a path is the id the k-th order created in that
// sequence was given. The answer is each request's status and, when its body names one, the order's state, in order.
// Every check expects exactly that list, so a route that answers the wrong status once fails it.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to a table written by hand from the goal
export const CASE = "ORBIT-E2E-002";

export const GROUPS = {
  "cancels-open": "an open order is cancelled, and reads back cancelled",
  "cancelled-never-ships": "a cancelled order is never shipped, and stays cancelled",
  "shipped-stays": "a shipped order cannot be cancelled, and stays shipped",
  "cancel-once": "an order already cancelled cannot be cancelled again",
  "unknown": "cancelling an order nobody has is 404",
  "other-routes": "creating, reading and shipping orders, and a route nobody serves, behave as before",
  "seeded": "seeded sequences of creating, reading, shipping and cancelling orders: every answer as the goal has it",
};

// ---- the reference model, as the goal words it ---------------------------------------------------------------------------

const VALID = [{ qty: 1, unitMinor: 500 }];

const MOVES = {
  ship: { from: "open", to: "shipped" },
  cancel: { from: "open", to: "cancelled" },
};

// One request against the orders the sequence has made so far: its answer, and the orders after it.
const ANSWER = [
  { when: (q) => q.op === "create" && !q.valid, run: (orders) => ["400:-", orders] },
  { when: (q) => q.op === "create", run: (orders) => ["201:open", [...orders, "open"]] },
  { when: (q, orders) => q.op === "nowhere" || !(q.k >= 1 && q.k <= orders.length), run: (orders) => ["404:-", orders] },
  { when: (q) => q.op === "get", run: (orders, q) => [`200:${orders[q.k - 1]}`, orders] },
  { when: (q, orders) => orders[q.k - 1] !== MOVES[q.op].from, run: (orders) => ["409:-", orders] },
  { when: () => true, run: (orders, q) => [`200:${MOVES[q.op].to}`, orders.map((s, i) => (i === q.k - 1 ? MOVES[q.op].to : s))] },
];

export const answersOf = (steps) => steps.reduce((acc, q) => ((r) => ({ out: [...acc.out, `${acc.out.length + 1}:${r[0]}`], orders: r[1] }))(ANSWER.find((a) => a.when(q, acc.orders)).run(acc.orders, q)), { out: [], orders: [] }).out;

// ---- requests, as the probe sends them ------------------------------------------------------------------------------------

const create = { op: "create", valid: true };
const createBad = { op: "create", valid: false };
const get = (k) => ({ op: "get", k });
const ship = (k) => ({ op: "ship", k });
const cancel = (k) => ({ op: "cancel", k });
const nowhere = { op: "nowhere" };

const pathOf = (q) => ({ get: `/orders/$${q.k}`, ship: `/orders/$${q.k}/ship`, cancel: `/orders/$${q.k}/cancel` })[q.op];

const REQUEST = {
  create: (q) => ({ method: "POST", path: "/orders", body: q.valid ? { customer: "Ada", lines: VALID } : { lines: [] } }),
  nowhere: () => ({ method: "DELETE", path: "/orders" }),
  get: (q) => ({ method: "GET", path: pathOf(q) }),
  ship: (q) => ({ method: "POST", path: pathOf(q) }),
  cancel: (q) => ({ method: "POST", path: pathOf(q) }),
};

// An order nobody has is one the sequence never made: its number is past every order it made.
const requestOf = (q, made) => (q.k > made ? { ...REQUEST[q.op](q), path: REQUEST[q.op](q).path.replace(`$${q.k}`, "ord-9999") } : REQUEST[q.op](q));

const madeBefore = (steps, i) => steps.slice(0, i).filter((q) => q.op === "create" && q.valid).length;

const inputOf = (steps) => ({ call: "ops", steps: steps.map((q, i) => requestOf(q, madeBefore(steps, i))) });

const check = (group, steps) => ({ group, input: inputOf(steps), expect: { exactly: answersOf(steps) } });

// ---- the checks written by hand ------------------------------------------------------------------------------------------

const HAND = [
  ["cancels-open", [create, cancel(1), get(1)], ["1:201:open", "2:200:cancelled", "3:200:cancelled"]],
  ["cancels-open", [create, create, cancel(2), get(1), get(2)], ["1:201:open", "2:201:open", "3:200:cancelled", "4:200:open", "5:200:cancelled"]],
  ["cancelled-never-ships", [create, cancel(1), ship(1), get(1)], ["1:201:open", "2:200:cancelled", "3:409:-", "4:200:cancelled"]],
  ["shipped-stays", [create, ship(1), cancel(1), get(1)], ["1:201:open", "2:200:shipped", "3:409:-", "4:200:shipped"]],
  ["cancel-once", [create, cancel(1), cancel(1), get(1)], ["1:201:open", "2:200:cancelled", "3:409:-", "4:200:cancelled"]],
  ["unknown", [cancel(1)], ["1:404:-"]],
  ["unknown", [create, cancel(2), get(1)], ["1:201:open", "2:404:-", "3:200:open"]],
  ["other-routes", [create, ship(1), ship(1), get(1)], ["1:201:open", "2:200:shipped", "3:409:-", "4:200:shipped"]],
  ["other-routes", [createBad, get(1), nowhere], ["1:400:-", "2:404:-", "3:404:-"]],
  ["other-routes", [create, get(1), get(2)], ["1:201:open", "2:200:open", "3:404:-"]],
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

// An order a seeded step names: one the sequence made, and now and then the next one, which it has not made.
const orderIn = (r, made) => 1 + int(r, made + (r() < 0.15 ? 1 : 0));

// A step of a seeded sequence: mostly moves on orders it made, some creations, a read.
const seededStep = (r, made) => [() => create, () => cancel(orderIn(r, made)), () => ship(orderIn(r, made)), () => get(orderIn(r, made)), () => cancel(orderIn(r, made))][int(r, 5)]();

const grown = (r, steps) => [...steps, seededStep(r, steps.filter((q) => q.op === "create").length)];

const seededSteps = (r) => Array.from({ length: 3 + int(r, 7) }).reduce((steps) => grown(r, steps), [create]);

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  return numbered([...FIXED, ...Array.from({ length: Math.max(16, samples) }, () => check("seeded", seededSteps(r)))]);
}

// ---- the reference model, held to what the goal says in words ------------------------------------------------------------

export const selfTest = () => HAND.filter(([, steps, want]) => JSON.stringify(answersOf(steps)) !== JSON.stringify(want)).map(([group, steps]) => `the reference model disagrees with the goal on ${group}: ${steps.map((q) => q.op + (q.k ?? "")).join(" ")}`);
