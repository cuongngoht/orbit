// THE SPEC of ORBIT-E2E-001: what a discounted total must come to, written from the goal's own words -- half up to the
// nearest minor unit, exact when nothing is left over -- and never from the fixture's code. Kept beside the probe and
// handed to no runner; the controller imports a FROZEN copy of it, and it never imports the target.
//
// Every check expects exactly one answer. The fixed rows sit at the edges the goal names (exactly one half, just below
// it, just above it, nothing left over, no discount, a full discount), the seeded rows draw amounts and discounts with
// the run's seed, and the API rows send an order through `POST /orders` and read the total it stored and shows.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to a table written by hand from the goal
export const CASE = "ORBIT-E2E-001";

export const GROUPS = {
  "half-up": "a discounted amount whose fraction is exactly one half rounds up to the next minor unit",
  "above-half": "a discounted amount whose fraction is more than one half rounds up",
  "below-half": "a discounted amount whose fraction is less than one half rounds down",
  "exact": "a discount that leaves whole minor units is exact",
  "edges": "no discount leaves the subtotal, and a full discount leaves nothing",
  "order-total": "an order's total is its lines' subtotal after the discount, rounded the same way",
  "through-api": "an order created through the API is stored and shown with that total, formatted in dollars",
  "seeded": "seeded amounts and discounts round half up to the nearest minor unit",
};

// ---- the reference model, as the goal words it ---------------------------------------------------------------------------

// What a discount leaves of an amount: (minor x (100 - percent)) / 100, half up, in integers -- the fraction is the
// remainder over 100, and half is 50 of it.
export const discountedOf = (minor, percent) => ((n) => (n - (n % 100)) / 100 + (n % 100 >= 50 ? 1 : 0))(minor * (100 - percent));

const subtotalOf = (lines) => lines.reduce((sum, l) => sum + l.qty * l.unitMinor, 0);

export const totalOf = (lines, percent) => discountedOf(subtotalOf(lines), percent);

const dollars = (minor) => `$${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;

const remainderOf = (minor, percent) => (minor * (100 - percent)) % 100;

// ---- the checks written by hand ------------------------------------------------------------------------------------------

const discount = (minor, percent) => ({ call: "discount", minor, percent });

const HAND = [
  ["half-up", discount(1, 50), 1],
  ["half-up", discount(3, 50), 2],
  ["half-up", discount(5, 90), 1],
  ["half-up", discount(250, 1), 248],
  ["half-up", discount(150, 1), 149],
  ["half-up", discount(4150, 3), 4026],
  ["above-half", discount(7, 30), 5],
  ["above-half", discount(199, 67), 66],
  ["above-half", discount(101, 1), 100],
  ["above-half", discount(4321, 7), 4019],
  ["above-half", discount(3, 10), 3],
  ["below-half", discount(199, 33), 133],
  ["below-half", discount(999, 15), 849],
  ["below-half", discount(1999, 13), 1739],
  ["below-half", discount(87, 9), 79],
  ["below-half", discount(4321, 9), 3932],
  ["exact", discount(1000, 10), 900],
  ["exact", discount(2000, 25), 1500],
  ["exact", discount(100, 37), 63],
  ["edges", discount(12345, 0), 12345],
  ["edges", discount(12345, 100), 0],
  ["edges", discount(0, 25), 0],
  ["edges", discount(1, 0), 1],
];

const order = (call, lines, percent) => ({ call, lines, percent });

const ORDERS = [
  [[{ qty: 3, unitMinor: 333 }], 15],
  [[{ qty: 1, unitMinor: 1099 }, { qty: 2, unitMinor: 250 }], 5],
  [[{ qty: 7, unitMinor: 143 }], 50],
  [[{ qty: 2, unitMinor: 500 }], 10],
  [[{ qty: 1, unitMinor: 19 }], 50],
];

const FIXED = [...HAND.map(([group, input, minor]) => ({ group, input, expect: { exactly: [`minor=${minor}`] } })), ...ORDERS.map(([lines, percent]) => totalCheck(lines, percent)), ...ORDERS.map(([lines, percent]) => apiCheck(lines, percent))];

function totalCheck(lines, percent) {
  return { group: "order-total", input: order("total", lines, percent), expect: { exactly: [`minor=${totalOf(lines, percent)}`] } };
}

function apiCheck(lines, percent) {
  return { group: "through-api", input: order("api", lines, percent), expect: { exactly: ["status=201", `minor=${totalOf(lines, percent)}`, `total=${dollars(totalOf(lines, percent))}`] } };
}

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

const seededDiscount = (r) => ((minor, percent) => ({ group: "seeded", input: discount(minor, percent), expect: { exactly: [`minor=${discountedOf(minor, percent)}`] } }))(1 + int(r, 99999), int(r, 101));

const seededLines = (r) => Array.from({ length: 1 + int(r, 3) }, () => ({ qty: 1 + int(r, 9), unitMinor: 1 + int(r, 5000) }));

const seededOrder = (r) => ((lines, percent) => (r() < 0.5 ? totalCheck(lines, percent) : apiCheck(lines, percent)))(seededLines(r), int(r, 101));

// A seeded discount whose fraction is exactly one half: an odd amount at 50%.
const seededHalf = (r) => ((minor) => ({ group: "half-up", input: discount(minor, 50), expect: { exactly: [`minor=${discountedOf(minor, 50)}`] } }))(1 + 2 * int(r, 49999));

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  return numbered([...FIXED, ...Array.from({ length: Math.max(8, Math.floor(samples / 4)) }, () => seededHalf(r)), ...Array.from({ length: Math.max(16, samples) }, () => seededDiscount(r)), ...Array.from({ length: Math.max(8, Math.floor(samples / 3)) }, () => seededOrder(r))]);
}

// ---- the reference model, held to what the goal says in words ------------------------------------------------------------

const GROUP_OF_REMAINDER = [
  { group: "exact", when: (rem) => rem === 0 },
  { group: "half-up", when: (rem) => rem === 50 },
  { group: "above-half", when: (rem) => rem > 50 },
  { group: "below-half", when: (rem) => rem < 50 },
];

const misplaced = ([group, input]) => group !== "edges" && GROUP_OF_REMAINDER.find((g) => g.when(remainderOf(input.minor, input.percent))).group !== group;

export const selfTest = () => [...HAND.filter(([, input, minor]) => discountedOf(input.minor, input.percent) !== minor).map(([group, input]) => `the reference model disagrees with the goal on ${group}: ${input.minor} at ${input.percent}%`), ...HAND.filter(misplaced).map(([group, input]) => `${input.minor} at ${input.percent}% is not a ${group} row`), ...(dollars(896) === "$8.96" && dollars(5) === "$0.05" ? [] : ["dollars are formatted wrongly"])];
