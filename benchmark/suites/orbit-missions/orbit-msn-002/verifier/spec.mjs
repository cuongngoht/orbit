// THE SPEC of ORBIT-MSN-002: what delivering an order must do, written from the goal's own words -- a shipped order is
// delivered once, anything else is refused with 409 (an unknown order 404), a delivered order is never shipped or
// cancelled, every other route keeps its contract -- and never from the fixture's code. Kept beside the probe and handed
// to no runner; the controller imports a FROZEN copy of it, and it never imports the target.
//
// Every check is a SEQUENCE of requests on a fresh store, and expects exactly one answer: each request's status, with
// the order's state when the answer carries one, numbered by its place in the sequence (the judge compares sets). The fixed rows walk every state the goal names; the seeded rows draw
// sequences with the run's seed, and a reference state machine says what each step must answer.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to a table written by hand from the goal
export const CASE = "ORBIT-MSN-002";

export const GROUPS = {
  "deliver-shipped": "a shipped order is delivered with 200, and read back delivered",
  "deliver-open": "an open order is refused with 409, and stays open",
  "deliver-cancelled": "a cancelled order is refused with 409, and stays cancelled",
  "deliver-twice": "a delivered order is refused with 409 when it is delivered again",
  "after-delivered": "a delivered order can no longer be shipped or cancelled",
  "unknown": "an order nobody created answers 404 when it is delivered",
  "contracts": "every other route keeps its contract: create, read, ship and cancel answer as before",
  "seeded": "seeded sequences of requests answer as the order's state says they must",
};

// ---- the reference model: an order's state, step by step -----------------------------------------------------------------

// What each request does to an order in each state: the status it answers and the state it leaves. A move nobody may make
// is 409 and leaves the state as it was; a request about an order nobody created is 404.
const MOVES = { ship: { open: "shipped" }, cancel: { open: "cancelled" }, deliver: { shipped: "delivered" } };

const moved = (op, state) => ((to) => (to ? { status: 200, state: to, shows: to } : { status: 409, state, shows: null }))(MOVES[op][state]);

const STEP = {
  create: (state) => ({ status: 201, state: "open", shows: "open" }),
  get: (state) => ({ status: 200, state, shows: state }),
  ship: (state) => moved("ship", state),
  cancel: (state) => moved("cancel", state),
  deliver: (state) => moved("deliver", state),
};

const answerOf = (op, r) => (r.shows ? `${op}=${r.status}:${r.shows}` : `${op}=${r.status}`);

// One step over the orders the sequence made so far: a step about an order not made (yet) is 404.
function stepped(states, s) {
  if (s.op === "create") return { states: [...states, "open"], said: answerOf("create", STEP.create()) };
  const at = s.order - 1;
  if (at < 0 || at >= states.length) return { states, said: `${s.op}=404` };
  const r = STEP[s.op](states[at]);
  return { states: states.map((x, i) => (i === at ? r.state : x)), said: answerOf(s.op, r) };
}

const numberedSaid = (said) => said.map((x, i) => `${i + 1}.${x}`);

export const answersOf = (ops) => numberedSaid(ops.reduce((acc, s) => ((r) => ({ states: r.states, said: [...acc.said, r.said] }))(stepped(acc.states, s)), { states: [], said: [] }).said);

const seq = (...ops) => ({ call: "sequence", ops });

const op = (name, order = 1) => ({ op: name, order });

// ---- the checks written by hand ------------------------------------------------------------------------------------------

const HAND = [
  ["deliver-shipped", seq(op("create"), op("ship"), op("deliver"), op("get"))],
  ["deliver-shipped", seq(op("create"), op("create"), op("ship", 2), op("deliver", 2), op("get", 1), op("get", 2))],
  ["deliver-open", seq(op("create"), op("deliver"), op("get"))],
  ["deliver-open", seq(op("create"), op("create"), op("ship", 1), op("deliver", 2), op("get", 2))],
  ["deliver-cancelled", seq(op("create"), op("cancel"), op("deliver"), op("get"))],
  ["deliver-twice", seq(op("create"), op("ship"), op("deliver"), op("deliver"), op("get"))],
  ["after-delivered", seq(op("create"), op("ship"), op("deliver"), op("ship"), op("get"))],
  ["after-delivered", seq(op("create"), op("ship"), op("deliver"), op("cancel"), op("get"))],
  ["unknown", seq(op("deliver", 1))],
  ["unknown", seq(op("create"), op("deliver", 9))],
  ["contracts", seq(op("create"), op("get"), op("ship"), op("ship"), op("cancel"), op("get"))],
  ["contracts", seq(op("create"), op("cancel"), op("cancel"), op("ship"), op("get"))],
  ["contracts", seq(op("get", 3), op("ship", 3), op("cancel", 3))],
];

const FIXED = HAND.map(([group, input]) => ({ group, input, expect: { exactly: answersOf(input.ops) } }));

// ---- a seeded generator, the same inputs for the same seed --------------------------------------------------------------

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

const OPS = ["ship", "cancel", "deliver", "deliver", "get"];

// A sequence over one to three orders: each made first, then a few steps about any of them (or one never made).
const seededOps = (r) => ((n) => [...Array.from({ length: n }, () => op("create")), ...Array.from({ length: 3 + int(r, 5) }, () => op(OPS[int(r, OPS.length)], 1 + int(r, n + 1)))])(1 + int(r, 3));

const seeded = (r) => ((ops) => ({ group: "seeded", input: seq(...ops), expect: { exactly: answersOf(ops) } }))(seededOps(r));

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  return numbered([...FIXED, ...Array.from({ length: Math.max(16, samples) }, () => seeded(r))]);
}

// ---- the reference model, held to what the goal says in words ------------------------------------------------------------

const WRITTEN = [
  [seq(op("create"), op("ship"), op("deliver"), op("get")), ["1.create=201:open", "2.ship=200:shipped", "3.deliver=200:delivered", "4.get=200:delivered"]],
  [seq(op("create"), op("deliver"), op("get")), ["1.create=201:open", "2.deliver=409", "3.get=200:open"]],
  [seq(op("create"), op("cancel"), op("deliver"), op("get")), ["1.create=201:open", "2.cancel=200:cancelled", "3.deliver=409", "4.get=200:cancelled"]],
  [seq(op("create"), op("ship"), op("deliver"), op("deliver"), op("cancel"), op("ship")), ["1.create=201:open", "2.ship=200:shipped", "3.deliver=200:delivered", "4.deliver=409", "5.cancel=409", "6.ship=409"]],
  [seq(op("deliver", 1), op("get", 1)), ["1.deliver=404", "2.get=404"]],
];

export const selfTest = () => WRITTEN.filter(([input, said]) => JSON.stringify(answersOf(input.ops)) !== JSON.stringify(said)).map(([input]) => `the reference model disagrees with the goal on ${JSON.stringify(input.ops)}`);
