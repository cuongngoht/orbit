// THE SPEC of ORBIT-NEG-004: what the orders project must do once `qty` is renamed `quantity` in its source and its tests
// -- written from the prompt's own words and never from the fixture's code. A line's quantity is read from `quantity`;
// totals, the API and every other behaviour are what they were; and neither the source nor the tests name `qty` any
// more. Kept beside the probe and handed to no runner; the controller imports a FROZEN copy of it.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to a table written by hand
export const CASE = "ORBIT-NEG-004";

export const GROUPS = {
  "line-total": "a line's total is its quantity, read from `quantity`, times its unit price",
  "order-total": "an order's total is its lines' total after its discount, each line's quantity read from `quantity`",
  "through-api": "an order created through the API with `quantity` lines is stored and shown with that total",
  "renamed-in-src": "no source file names `qty` any more",
  "renamed-in-tests": "no test file names `qty` any more",
  "seeded": "seeded lines and orders: every total as it was, read from `quantity`",
};

// ---- the reference model --------------------------------------------------------------------------------------------------

const lineOf = (l) => l.quantity * l.unitMinor;

const subtotalOf = (lines) => lines.reduce((n, l) => n + lineOf(l), 0);

export const totalOf = (lines, percent) => Math.floor((subtotalOf(lines) * (100 - percent) + 50) / 100);

const dollars = (minor) => `$${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;

// ---- the checks written by hand ------------------------------------------------------------------------------------------

const line = (quantity, unitMinor) => ({ quantity, unitMinor });

const HAND_LINES = [[3, 250, 750], [1, 100, 100], [7, 143, 1001], [2, 0, 0]];

const HAND_ORDERS = [[[line(2, 500)], 0], [[line(2, 500)], 10], [[line(1, 1099), line(2, 250)], 5], [[line(3, 333)], 15]];

const lineCheck = ([quantity, unitMinor, minor]) => ({ group: "line-total", input: { call: "line", line: line(quantity, unitMinor) }, expect: { exactly: [`minor=${minor}`] } });

const totalCheck = (lines, percent, group = "order-total") => ({ group, input: { call: "total", lines, percent }, expect: { exactly: [`minor=${totalOf(lines, percent)}`] } });

const apiCheck = (lines, percent, group = "through-api") => ({ group, input: { call: "api", lines, percent }, expect: { exactly: ["status=201", `minor=${totalOf(lines, percent)}`, `total=${dollars(totalOf(lines, percent))}`] } });

const SOURCES = ["src/money.mjs", "src/orders.mjs", "src/api.mjs", "src/store.mjs", "src/worker.mjs", "src/ui.mjs"];

const TESTS = ["test/money.test.mjs", "test/orders.test.mjs", "test/cancel.test.mjs", "test/currency.test.mjs", "test/worker.test.mjs", "test/invoice.test.mjs", "test/dedupe.test.mjs", "test/ui.test.mjs", "test/note.test.mjs"];

const wordCheck = (group, files) => ({ group, input: { call: "names", files, word: "qty" }, expect: { exactly: [] } });

const FIXED = [...HAND_LINES.map(lineCheck), ...HAND_ORDERS.map(([lines, percent]) => totalCheck(lines, percent)), ...HAND_ORDERS.map(([lines, percent]) => apiCheck(lines, percent)), wordCheck("renamed-in-src", SOURCES), wordCheck("renamed-in-tests", TESTS)];

// ---- a seeded generator, the same inputs for the same seed ----------------------------------------------------------------

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

const seededLines = (r) => Array.from({ length: 1 + int(r, 3) }, () => line(1 + int(r, 9), int(r, 5000)));

const seeded = (r) => ((lines, percent) => (r() < 0.5 ? totalCheck(lines, percent, "seeded") : apiCheck(lines, percent, "seeded")))(seededLines(r), int(r, 101));

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  return numbered([...FIXED, ...Array.from({ length: Math.max(8, samples) }, () => seeded(r))]);
}

// ---- the reference model, held to a table written by hand ------------------------------------------------------------------

export const selfTest = () => [...HAND_LINES.filter(([quantity, unitMinor, minor]) => lineOf(line(quantity, unitMinor)) !== minor).map(([quantity, unitMinor]) => `a line of ${quantity} at ${unitMinor} is not what the table says`), ...(totalOf([line(2, 500)], 10) === 900 && dollars(900) === "$9.00" ? [] : ["an order's total is not what the table says"])];
