// THE SPEC of ORBIT-E2E-003: what an order in a currency must look like everywhere it is shown, written from the goal's
// own words -- the three codes, their symbols and minor units, USD when none is given, 400 for anything else -- and
// never from the fixture's code. Kept beside the probe and handed to no runner; the controller imports a FROZEN copy of
// it, and it never imports the target.
//
// The answers name what came back field by field (`status=`, `currency=`, `total=`, `stored=`), and each group judges
// the fields its sentence is about, so a change that keeps the currency but still formats in dollars, or formats but
// never refuses, fails the checks it gets wrong and no other.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to a table written by hand from the goal
export const CASE = "ORBIT-E2E-003";

export const GROUPS = {
  "keeps": "an order keeps the currency it was created in -- USD, EUR or JPY -- and USD when none is given",
  "api-format": "the API shows an order's total in its own currency: dollars and euros with two decimals, yen with none",
  "view-format": "the HTML view draws an order's total in its own currency",
  "invoice": "a paid order's invoice carries the order's currency",
  "refused": "a currency nobody keeps is refused with 400, and no order is stored",
  "unchanged": "an order with no currency is what it always was: its total in dollars, its discount rounded as before",
  "seeded": "seeded orders in every currency, through the API, the view and the payments consumer",
};

// ---- the reference model, as the goal words it ---------------------------------------------------------------------------

export const KEPT = { USD: { symbol: "$", minor: 2 }, EUR: { symbol: "€", minor: 2 }, JPY: { symbol: "¥", minor: 0 } };

const withDecimals = (minor) => `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;

export const formattedIn = (minor, code) => `${KEPT[code].symbol}${KEPT[code].minor ? withDecimals(minor) : String(minor)}`;

// Half up to the nearest minor unit, in integers, as the project already computes a discount.
const totalOf = (lines, percent = 0) => ((n) => (n - (n % 100)) / 100 + (n % 100 >= 50 ? 1 : 0))(lines.reduce((sum, l) => sum + l.qty * l.unitMinor, 0) * (100 - percent));

const codeOf = (i) => i.currency ?? "USD";

const EXPECT = {
  create: (i) => ["status=201", `currency=${codeOf(i)}`, `total=${formattedIn(totalOf(i.lines, i.percent), codeOf(i))}`, "stored=1"],
  view: (i) => [`total=${formattedIn(totalOf(i.lines, i.percent), codeOf(i))}`],
  invoice: (i) => ["ack=true", `currency=${codeOf(i)}`, `amount=${totalOf(i.lines, i.percent)}`],
  refused: () => ["status=400", "stored=0"],
};

// ---- the checks written by hand ------------------------------------------------------------------------------------------

const LINES = [{ qty: 1, unitMinor: 1234 }];

const asked = (call, currency, lines = LINES, percent = undefined) => ({ call, lines, ...(percent === undefined ? {} : { percent }), ...(currency === undefined ? {} : { currency }) });

const HAND = [
  ["keeps", asked("create", "EUR"), ["status=201", "currency=EUR", "total=€12.34", "stored=1"]],
  ["keeps", asked("create", "JPY"), ["status=201", "currency=JPY", "total=¥1234", "stored=1"]],
  ["keeps", asked("create", undefined), ["status=201", "currency=USD", "total=$12.34", "stored=1"]],
  ["keeps", asked("create", "USD", [{ qty: 3, unitMinor: 5 }]), ["status=201", "currency=USD", "total=$0.15", "stored=1"]],
  ["api-format", asked("create", "EUR", [{ qty: 2, unitMinor: 1005 }], 10), ["status=201", "currency=EUR", "total=€18.09", "stored=1"]],
  ["api-format", asked("create", "JPY", [{ qty: 4, unitMinor: 250 }]), ["status=201", "currency=JPY", "total=¥1000", "stored=1"]],
  ["api-format", asked("create", "JPY", [{ qty: 1, unitMinor: 7 }]), ["status=201", "currency=JPY", "total=¥7", "stored=1"]],
  ["api-format", asked("create", "EUR", [{ qty: 1, unitMinor: 5 }]), ["status=201", "currency=EUR", "total=€0.05", "stored=1"]],
  ["view-format", asked("view", "EUR", [{ qty: 1, unitMinor: 99900 }]), ["total=€999.00"]],
  ["view-format", asked("view", "JPY", [{ qty: 3, unitMinor: 333 }]), ["total=¥999"]],
  ["view-format", asked("view", "USD", [{ qty: 1, unitMinor: 1 }]), ["total=$0.01"]],
  ["invoice", asked("invoice", "JPY", [{ qty: 2, unitMinor: 600 }]), ["ack=true", "currency=JPY", "amount=1200"]],
  ["invoice", asked("invoice", "EUR"), ["ack=true", "currency=EUR", "amount=1234"]],
  ["invoice", asked("invoice", undefined), ["ack=true", "currency=USD", "amount=1234"]],
  ["refused", asked("refused", "GBP"), ["status=400", "stored=0"]],
  ["refused", asked("refused", "usd"), ["status=400", "stored=0"]],
  ["refused", asked("refused", "YEN"), ["status=400", "stored=0"]],
  ["refused", asked("refused", ""), ["status=400", "stored=0"]],
  ["unchanged", asked("create", undefined, [{ qty: 2, unitMinor: 500 }], 15), ["status=201", "currency=USD", "total=$8.50", "stored=1"]],
  ["unchanged", asked("view", undefined, [{ qty: 7, unitMinor: 143 }], 50), ["total=$5.01"]],
];

// What each group judges of an answer: the fields its sentence is about -- so a change that keeps a currency but still
// formats in dollars fails the formatting checks and holds the keeping ones. A seeded check judges every field.
const FIELDS = { keeps: ["status=", "currency=", "stored="], "api-format": ["total="], unchanged: ["status=", "total=", "stored="] };

const expectOf = (group, input) => ((all) => (FIELDS[group] ? { has: all.filter((f) => FIELDS[group].some((p) => f.startsWith(p))) } : { exactly: all }))(EXPECT[input.call](input));

const FIXED = HAND.map(([group, input]) => ({ group, input, expect: expectOf(group, input) }));

// ---- a seeded generator, the same orders for the same seed ----------------------------------------------------------------

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

const pick = (r, list) => list[int(r, list.length)];

const UNKNOWN = ["CHF", "GBP", "eur", "Jpy", "US", "USDX", "XXX", "BTC", "€"];

const seededLines = (r) => Array.from({ length: 1 + int(r, 3) }, () => ({ qty: 1 + int(r, 9), unitMinor: 1 + int(r, 20000) }));

const seededKept = (r) => ((call) => asked(call, pick(r, ["USD", "EUR", "JPY", undefined]), seededLines(r), r() < 0.4 ? int(r, 101) : undefined))(pick(r, ["create", "create", "view", "invoice"]));

const seededInput = (r) => (r() < 0.2 ? asked("refused", pick(r, UNKNOWN)) : seededKept(r));

const seeded = (r) => ((input) => ({ group: "seeded", input, expect: { exactly: EXPECT[input.call](input) } }))(seededInput(r));

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  return numbered([...FIXED, ...Array.from({ length: Math.max(16, samples) }, () => seeded(r))]);
}

// ---- the reference model, held to what the goal says in words ------------------------------------------------------------

export const selfTest = () => HAND.filter(([, input, want]) => JSON.stringify(EXPECT[input.call](input)) !== JSON.stringify(want)).map(([group, input]) => `the reference model disagrees with the goal on ${group}: ${input.call} ${input.currency ?? "(none)"} ${JSON.stringify(input.lines)}`);
