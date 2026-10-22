// The cron dialects' one engine. A field is a row (its range, its names), an expression is five or
// six of them, and a spec is the set of values each allows. Matching is on WALL time in the
// contract's zone: which instants a matching wall names is zone.mjs's question, and what happens at
// a DST gap or overlap is the contract's (resolve.mjs).
//
// Choices this dialect makes, stated so a reader never has to guess them:
//   - Day matching is Vixie cron's. When BOTH day-of-month and day-of-week are restricted -- their
//     text does not start with "*" -- a day matches if EITHER does; when one starts with "*", both
//     must. So "0 9 13 * FRI" fires every 13th AND every Friday, and "*/2" counts as unrestricted.
//   - "N/step" means N through the field's maximum, every step (robfig/cron and Quartz read it
//     so; classic Vixie refuses it). A range must run forwards; a step is at least 1.
//   - Day-of-week 7 is Sunday, as 0 is. Month and day names are English three-letter, any case.
//   - "?", "L", "W" and "#" belong to other cron dialects and are refused, never approximated.
import { DAY, HOUR, MINUTE, SECOND, dayOf, fieldsOf } from "../wall.mjs";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export const FIELD = {
  second: { key: "seconds", name: "second", min: 0, max: 59 },
  minute: { key: "minutes", name: "minute", min: 0, max: 59 },
  hour: { key: "hours", name: "hour", min: 0, max: 23 },
  dayOfMonth: { key: "dom", name: "day-of-month", min: 1, max: 31 },
  month: { key: "months", name: "month", min: 1, max: 12, names: MONTHS, base: 1 },
  dayOfWeek: { key: "dow", name: "day-of-week", min: 0, max: 7, names: DAYS, base: 0, fold: 7 },
};

export const MACROS = { "@yearly": "0 0 1 1 *", "@annually": "0 0 1 1 *", "@monthly": "0 0 1 * *", "@weekly": "0 0 * * 0", "@daily": "0 0 * * *", "@midnight": "0 0 * * *", "@hourly": "0 * * * *" };

const ITEM = /^(\*|[A-Za-z0-9]+)(?:-([A-Za-z0-9]+))?(?:\/(\d+))?$/;

// `prefix` is what a macro gains in front: "0 " for the dialect whose first field is the second.
export function parseCron(expression, fields, prefix = "") {
  const raw = String(expression ?? "").trim();
  const text = MACROS[raw.toLowerCase()] ? `${prefix}${MACROS[raw.toLowerCase()]}` : raw;
  const parts = text ? text.split(/\s+/) : [];
  if (parts.length !== fields.length) return { ok: false, error: `a ${fields.length}-field expression, and "${raw}" has ${parts.length}` };
  return specOf(parts.map((p, i) => parseField(p, fields[i])), fields);
}

function specOf(parsed, fields) {
  const bad = parsed.find((p) => p.error);
  if (bad) return { ok: false, error: bad.error };
  const values = Object.fromEntries(parsed.map((p, i) => [fields[i].key, p.values]));
  const star = Object.fromEntries(parsed.map((p, i) => [fields[i].key, p.star]));
  return { ok: true, spec: { seconds: values.seconds ?? [0], minutes: values.minutes, hours: values.hours, dom: new Set(values.dom), months: new Set(values.months), dow: new Set(values.dow), domStar: star.dom, dowStar: star.dow } };
}

function parseField(text, field) {
  if (text.includes("?")) return { error: `"?" belongs to another cron dialect; this one has none (${field.name})` };
  const items = text.split(",").map((item) => parseItem(item, field));
  const bad = items.find((i) => i.error);
  if (bad) return bad;
  return { values: [...new Set(items.flatMap((i) => i.values).map((v) => (field.fold ? v % field.fold : v)))].sort((a, b) => a - b), star: text.startsWith("*") };
}

function parseItem(item, field) {
  const m = ITEM.exec(item);
  if (!m) return { error: `"${item}" is not a ${field.name} value, range or step` };
  const bounds = boundsOf(m, field);
  if (bounds.error) return bounds;
  return stepped(bounds, m[3] === undefined ? 1 : Number(m[3]), item, field);
}

function boundsOf(m, field) {
  if (m[1] === "*") return m[2] === undefined ? { low: field.min, high: field.max } : { error: `"*-${m[2]}" is not a ${field.name} range` };
  const low = valueOf(m[1], field);
  const high = m[2] !== undefined ? valueOf(m[2], field) : m[3] !== undefined ? { value: field.max } : low;
  return [low, high].find((v) => v.error) ?? ordered(low.value, high.value, field);
}

const ordered = (low, high, field) => (low <= high ? { low, high } : { error: `${field.name} range ${low}-${high} runs backwards` });

function valueOf(token, field) {
  const named = field.names ? field.names.indexOf(token.toUpperCase()) : -1;
  const value = named >= 0 ? named + field.base : /^\d+$/.test(token) ? Number(token) : Number.NaN;
  return value >= field.min && value <= field.max ? { value } : { error: `"${token}" is not a ${field.name} (${field.min}-${field.max})` };
}

function stepped(b, step, item, field) {
  if (!(step >= 1)) return { error: `"${item}" steps by ${step}, and a ${field.name} step is at least 1` };
  return { values: Array.from({ length: Math.floor((b.high - b.low) / step) + 1 }, (_, i) => b.low + i * step) };
}

export function dayMatches(spec, day) {
  const f = fieldsOf(day);
  const dom = spec.dom.has(f.day);
  const dow = spec.dow.has(f.weekday);
  return spec.months.has(f.month) && (spec.domStar || spec.dowStar ? dom && dow : dom || dow);
}

// The matching wall times inside the range, in order. The range is already capped by the series'
// horizon, so a day that never matches (30 February) costs one check per day and ends there.
export function* cronWalls(spec, range) {
  for (let day = dayOf(range.fromWall); day <= range.toWall; day += DAY) if (dayMatches(spec, day)) yield* timesOf(spec, day, range);
}

function* timesOf(spec, day, range) {
  for (const h of spec.hours) for (const m of spec.minutes) yield* secondsOf(spec, day + h * HOUR + m * MINUTE, range);
}

function* secondsOf(spec, base, range) {
  for (const s of spec.seconds) if (inside(base + s * SECOND, range)) yield { wall: base + s * SECOND };
}

const inside = (wall, range) => wall >= range.fromWall && wall <= range.toWall;
