// THE SPEC of ORBIT-MSN-001: which order lines POST /orders must refuse and which it must keep, written from the goal's
// own words -- a quantity is a whole number of at least 1, a unit price a whole number of minor units of at least 0 --
// and never from the fixture's code. Kept beside the probe and handed to no runner; the controller imports a FROZEN copy
// of it, and it never imports the target.
//
// Every check expects exactly one answer: a refused order answers 400 and leaves the store empty; a kept one answers 201,
// leaves one order and carries its total. The fixed rows sit at the edges the goal names (zero, one, a fraction just
// above a whole, a free item, a bad line beside good ones), and the seeded rows draw lines -- some valid, some not --
// with the run's seed.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to a table written by hand from the goal
export const CASE = "ORBIT-MSN-001";

export const GROUPS = {
  "zero-quantity": "a line whose quantity is zero is refused with 400, and nothing is stored",
  "negative-quantity": "a line whose quantity is below zero is refused with 400, and nothing is stored",
  "fractional-quantity": "a line whose quantity is not a whole number is refused with 400, and nothing is stored",
  "negative-price": "a line whose unit price is below zero is refused with 400, and nothing is stored",
  "fractional-price": "a line whose unit price is not a whole number of minor units is refused with 400, and nothing is stored",
  "beside-valid": "one bad line refuses the whole order, whatever its other lines are, and nothing is stored",
  "valid": "an order whose every line has a whole quantity of at least 1 and a whole price of at least 0 is created as before, with its total",
  "seeded": "seeded orders are refused or kept by the same rule",
};

// ---- the reference model, as the goal words it ---------------------------------------------------------------------------

const whole = (n) => typeof n === "number" && Number.isInteger(n);

export const validLine = (l) => whole(l.qty) && l.qty >= 1 && whole(l.unitMinor) && l.unitMinor >= 0;

// What a whole-percentage discount leaves of a subtotal, half up -- the order's total, as the fixture already keeps it.
const totalOf = (lines, percent) => ((n) => Math.floor((n * (100 - percent) + 50) / 100))(lines.reduce((sum, l) => sum + l.qty * l.unitMinor, 0));

export const answerOf = (lines, percent = 0) => (lines.length && lines.every(validLine) ? ["status=201", "stored=1", `total=${totalOf(lines, percent)}`] : ["status=400", "stored=0", "total=-"]);

const order = (lines, percent = 0) => ({ call: "create", lines, percent });

const line = (qty, unitMinor) => ({ qty, unitMinor });

// ---- the checks written by hand ------------------------------------------------------------------------------------------

const HAND = [
  ["zero-quantity", [line(0, 500)]],
  ["zero-quantity", [line(0, 0)]],
  ["negative-quantity", [line(-1, 500)]],
  ["negative-quantity", [line(-12, 99)]],
  ["fractional-quantity", [line(1.5, 200)]],
  ["fractional-quantity", [line(0.5, 1000)]],
  ["fractional-quantity", [line(2.25, 4)]],
  ["negative-price", [line(1, -1)]],
  ["negative-price", [line(3, -250)]],
  ["fractional-price", [line(1, 9.99)]],
  ["fractional-price", [line(2, 0.5)]],
  ["beside-valid", [line(2, 500), line(0, 300)]],
  ["beside-valid", [line(1, 100), line(1, -100)]],
  ["beside-valid", [line(1.5, 100), line(4, 25)]],
  ["valid", [line(1, 0)]],
  ["valid", [line(3, 250)]],
  ["valid", [line(1, 1099), line(2, 250)]],
  ["valid", [line(100, 1)]],
];

const HAND_DISCOUNTED = [["valid", [line(3, 333)], 15], ["valid", [line(1, 0), line(2, 995)], 10]];

const checkOf = (group, lines, percent = 0) => ({ group, input: order(lines, percent), expect: { exactly: answerOf(lines, percent) } });

const FIXED = [...HAND.map(([group, lines]) => checkOf(group, lines)), ...HAND_DISCOUNTED.map(([group, lines, percent]) => checkOf(group, lines, percent))];

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

// A quantity or a price as a seeded draw: most whole and in range, some zero, below zero or a fraction.
const QUANTITIES = [(r) => 1 + int(r, 9), (r) => 1 + int(r, 9), (r) => 1 + int(r, 9), () => 0, (r) => -(1 + int(r, 5)), (r) => 1 + int(r, 5) + 0.5];

const PRICES = [(r) => int(r, 5000), (r) => int(r, 5000), (r) => int(r, 5000), (r) => -(1 + int(r, 500)), (r) => int(r, 500) + 0.25];

const pick = (r, list) => list[int(r, list.length)](r);

const seededLines = (r) => Array.from({ length: 1 + int(r, 3) }, () => line(pick(r, QUANTITIES), pick(r, PRICES)));

const seededOrder = (r) => ((lines, percent) => checkOf("seeded", lines, percent))(seededLines(r), int(r, 4) * 10);

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  return numbered([...FIXED, ...Array.from({ length: Math.max(16, samples) }, () => seededOrder(r))]);
}

// ---- the reference model, held to what the goal says in words ------------------------------------------------------------

// What the goal says each fixed row is: refused unless every line is whole, at least 1 and priced at a whole 0 or more.
const REFUSED_GROUPS = ["zero-quantity", "negative-quantity", "fractional-quantity", "negative-price", "fractional-price", "beside-valid"];

const misjudged = ([group, lines]) => REFUSED_GROUPS.includes(group) === (answerOf(lines)[0] === "status=201");

export const selfTest = () => [...HAND.filter(misjudged).map(([group, lines]) => `the reference model disagrees with the goal on ${group}: ${JSON.stringify(lines)}`), ...(answerOf([line(3, 333)], 15)[2] === "total=849" ? [] : ["a discounted total is not the fixture's half-up total"]), ...(answerOf([])[0] === "status=400" ? [] : ["an order with no lines is not refused"])];
