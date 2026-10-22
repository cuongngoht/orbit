// This application's OWN schedule arithmetic: a five-field cron expression evaluated on a zone's
// wall clock, with Intl as the only source of offsets. It is deliberately independent of anything
// that tests it -- a scheduler checked by the code that computes its expectations proves nothing.
//
// A wall time a DST gap skips does not occur; one a DST overlap repeats occurs once, at the
// earlier instant. Times are whole seconds.

const DAY = 86400000;
const FIELDS = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day of week", min: 0, max: 7 },
];

function range(part, f) {
  const [body, stepText] = part.split("/");
  const step = stepText === undefined ? 1 : Number(stepText);
  if (!Number.isInteger(step) || step < 1) throw new Error(`cron ${f.name}: bad step "${part}"`);
  const [lo, hi] = body === "*" ? [f.min, f.max] : body.includes("-") ? body.split("-").map(Number) : [Number(body), stepText === undefined ? Number(body) : f.max];
  if (![lo, hi].every(Number.isInteger) || lo < f.min || hi > f.max || lo > hi) throw new Error(`cron ${f.name}: "${part}" is outside ${f.min}-${f.max}`);
  const out = [];
  for (let v = lo; v <= hi; v += step) out.push(v);
  return out;
}

function field(text, f) {
  const values = new Set(text.split(",").flatMap((part) => range(part, f)));
  return { values, star: text === "*" };
}

export function parseCron(expression) {
  const parts = String(expression).trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`a cron5 expression has five fields, not ${parts.length}`);
  const [minute, hour, dom, month, dow] = parts.map((p, i) => field(p, FIELDS[i]));
  if (dow.values.has(7)) dow.values.add(0);
  return { minutes: [...minute.values].sort((a, b) => a - b), hours: [...hour.values].sort((a, b) => a - b), dom, month, dow };
}

// Vixie cron: when both day fields are restricted, a day matches either; otherwise both.
function dayMatches(spec, y, m, d) {
  if (!spec.month.values.has(m)) return false;
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const byDom = spec.dom.values.has(d);
  const byDow = spec.dow.values.has(weekday);
  return !spec.dom.star && !spec.dow.star ? byDom || byDow : byDom && byDow;
}

// ---- a zone's wall clock ----------------------------------------------------------------------

const formats = new Map();

function formatOf(zone) {
  if (!formats.has(zone)) formats.set(zone, new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }));
  return formats.get(zone);
}

export function wallAt(ms, zone) {
  const parts = Object.fromEntries(formatOf(zone).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), h: Number(parts.hour), mi: Number(parts.minute), s: Number(parts.second) };
}

export function offsetMinutesAt(ms, zone) {
  const w = wallAt(ms, zone);
  return Math.round((Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - Math.floor(ms / 1000) * 1000) / 60000);
}

const two = (n) => String(n).padStart(2, "0");

export function isoAt(ms, zone) {
  const w = wallAt(ms, zone);
  const off = offsetMinutesAt(ms, zone);
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  return `${String(w.y).padStart(4, "0")}-${two(w.m)}-${two(w.d)}T${two(w.h)}:${two(w.mi)}:${two(w.s)}${sign}${two(Math.floor(abs / 60))}:${two(abs % 60)}`;
}

// The instant a wall time names in a zone: null in a gap, the earlier one in an overlap.
export function instantOf(y, m, d, h, mi, zone) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const offsets = new Set([guess - DAY, guess, guess + DAY].map((t) => offsetMinutesAt(t, zone)));
  const hits = [...offsets].map((off) => guess - off * 60000).filter((t) => sameWall(wallAt(t, zone), y, m, d, h, mi));
  return hits.length ? Math.min(...hits) : null;
}

const sameWall = (w, y, m, d, h, mi) => w.y === y && w.m === m && w.d === d && w.h === h && w.mi === mi && w.s === 0;

// ---- occurrences ------------------------------------------------------------------------------

// Every occurrence in (fromMs, toMs], oldest first, at most `limit`.
export function occurrencesBetween(spec, zone, fromMs, toMs, limit = 1000) {
  const out = [];
  if (toMs <= fromMs) return out;
  const first = wallAt(fromMs - DAY, zone);
  const last = wallAt(toMs + DAY, zone);
  const end = Date.UTC(last.y, last.m - 1, last.d);
  for (let day = Date.UTC(first.y, first.m - 1, first.d); day <= end && out.length < limit; day += DAY) {
    const c = new Date(day);
    const [y, m, d] = [c.getUTCFullYear(), c.getUTCMonth() + 1, c.getUTCDate()];
    if (!dayMatches(spec, y, m, d)) continue;
    for (const h of spec.hours) for (const mi of spec.minutes) {
      const t = instantOf(y, m, d, h, mi, zone);
      if (t !== null && t > fromMs && t <= toMs) out.push(t);
    }
  }
  return out.sort((a, b) => a - b).slice(0, limit);
}

// The first occurrence strictly after `afterMs`, looked for up to five years ahead.
export function nextAfter(spec, zone, afterMs) {
  for (const span of [2 * DAY, 32 * DAY, 367 * DAY, 1830 * DAY]) {
    const found = occurrencesBetween(spec, zone, afterMs, afterMs + span, 1)[0];
    if (found !== undefined) return found;
  }
  return null;
}

// Whether an instant is itself an occurrence.
export const isOccurrence = (spec, zone, ms) => occurrencesBetween(spec, zone, ms - 1, ms, 1)[0] === ms;
