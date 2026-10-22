// A ZONE answers two questions and nothing else: which wall time an instant shows there, and which
// instants a wall time names there -- none (a spring-forward gap), one, or two (a fall-back
// overlap). IANA names go through Intl.DateTimeFormat, the only time-zone data a zero-dependency
// engine has; a fixed offset ("Z", "UTC", "+07:00") is plain arithmetic. Nothing here decides
// what to DO at a gap or an overlap: that is a policy an accepted contract declares (resolve.mjs).
import { DAY, MINUTE, SECOND, floorTo, localText, pad, wallOf } from "./wall.mjs";

const OFFSET = /^([+-])(\d{2}):?(\d{2})$/;
const UTC = new Set(["Z", "UTC", "Etc/UTC", "GMT", "Etc/GMT"]);
const PARTS = new Set(["year", "month", "day", "hour", "minute", "second"]);
const ZONES = new Map();
const MEMO_LIMIT = 100000;

export function zoneOf(name) {
  if (typeof name !== "string" || !name.trim()) return { error: "no time zone" };
  if (UTC.has(name)) return fixed(name, 0);
  const m = OFFSET.exec(name);
  if (m) return fixed(name, (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * MINUTE);
  return remembered(ZONES, name, () => iana(name));
}

function fixed(id, offsetMs) {
  const offsetAt = () => offsetMs;
  return { id, offsetAt, wallAt: (ms) => floorTo(ms, SECOND) + offsetMs, instants: (wall) => [wall - offsetMs], gapShift: (wall) => wall - offsetMs };
}

function iana(id) {
  const format = created(id);
  if (!format) return { error: `"${id}" is not a time zone this runtime knows` };
  const offsetAt = memoOffsets(format);
  const wallAt = (ms) => floorTo(ms, SECOND) + offsetAt(ms);
  return { id, offsetAt, wallAt, instants: (wall) => instantsOf(wall, offsetAt, wallAt), gapShift: (wall) => wall - offsetAt(wall - DAY) };
}

function created(id) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: id, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
  } catch {
    return null;
  }
}

// An offset changes only on a whole minute in any zone a schedule meets, so one answer per minute
// is exact, and a series of thousands of occurrences asks Intl a handful of times per day.
function memoOffsets(format) {
  const seen = new Map();
  return (ms) => remembered(seen, Math.floor(ms / MINUTE), () => rawOffset(format, ms));
}

function remembered(seen, key, compute) {
  if (seen.size > MEMO_LIMIT) seen.clear();
  if (!seen.has(key)) seen.set(key, compute());
  return seen.get(key);
}

function rawOffset(format, ms) {
  const at = floorTo(ms, SECOND);
  return wallFromParts(format.formatToParts(new Date(at))) - at;
}

function wallFromParts(parts) {
  const f = Object.fromEntries(parts.filter((p) => PARTS.has(p.type)).map((p) => [p.type, Number(p.value)]));
  return wallOf({ ...f, hour: f.hour % 24 });
}

// The instants a wall time names: try the offsets in force a day either side of it, and keep the
// ones that come back to the same wall time. None is a gap, two an overlap, in ascending order.
function instantsOf(wall, offsetAt, wallAt) {
  const offsets = new Set([wall - DAY, wall, wall + DAY].map(offsetAt));
  return [...new Set([...offsets].map((o) => wall - o))].filter((t) => wallAt(t) === wall).sort((a, b) => a - b);
}

export const isoAt = (ms, zone) => `${localText(zone.wallAt(ms))}${offsetText(zone.offsetAt(ms))}`;

function offsetText(offsetMs) {
  const minutes = Math.round(Math.abs(offsetMs) / MINUTE);
  return `${offsetMs < 0 ? "-" : "+"}${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}
