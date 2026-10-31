// Money in minor units (cents for USD and EUR, yen for JPY): a line's total, an order's total after a whole-percentage
// discount, and a total formatted for its currency.
export const CURRENCIES = { USD: { minor: 2, symbol: "$" }, EUR: { minor: 2, symbol: "€" }, JPY: { minor: 0, symbol: "¥" } };

export const lineTotal = (line) => line.qty * line.unitMinor;

export const subtotal = (lines) => lines.reduce((sum, line) => sum + lineTotal(line), 0);

// What a whole-percentage discount leaves of an amount, rounded half up to the minor unit, in integers only.
export const discounted = (minor, percent) => Math.floor((minor * (100 - percent) + 50) / 100);

export const orderTotal = (lines, percent = 0) => discounted(subtotal(lines), percent);

const currencyOf = (code) => CURRENCIES[code] ?? CURRENCIES.USD;

export const formatted = (minor, code = "USD") => ((c) => `${c.symbol}${(minor / 10 ** c.minor).toFixed(c.minor)}`)(currencyOf(code));
