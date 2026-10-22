// ISO 8601 repeating intervals: R[n]/<start>/<duration>, or <start>/<duration> for ONE occurrence
// (ISO repeats only with R). "R" alone repeats without end; "Rn" is n occurrences, so R0 is none.
//
// A start with an offset ("Z", "+07:00") is an instant; one without is a wall time in the
// contract's zone. Years, months, weeks and days are CALENDAR steps taken on the wall time --
// 09:00 stays 09:00 across a DST change, 31 January + P1M is the last day of February, and the
// k-th occurrence is always counted from the start, so a series never drifts. Hours, minutes and
// seconds are EXACT durations. A start with an offset and only exact steps needs no zone at all; a
// start with an offset and calendar steps takes them in the contract's zone, or in the start's own
// offset when the contract names none. Weeks are seven days and may be combined with the other
// components. Fractions, an end-anchored interval (<duration>/<end>) and the basic format
// (20261022T0900) are refused.
import { withNext } from "../series.mjs";
import { DAY, addMonths, fieldsOf, wallOf } from "../wall.mjs";

const REPEAT = /^R(\d*)$/;
const DURATION = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?=\d)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;
const START = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?$/;
const OFFSET = /^([+-])(\d{2}):?(\d{2})$/;
const MEAN_MONTH = 30.436875 * DAY;
const FIELDS = ["year", "month", "day", "hour", "minute", "second"];

const SHAPES = [
  { when: (p) => p.length === 3 && REPEAT.test(p[0]), read: (p) => built(p[1], p[2], countOf(p[0])) },
  { when: (p) => p.length === 2 && !p[0].startsWith("P"), read: (p) => built(p[0], p[1], 1) },
];

function parse(expression) {
  const parts = String(expression ?? "").trim().split("/");
  const shape = SHAPES.find((s) => s.when(parts));
  return shape ? shape.read(parts) : { ok: false, error: `"${expression}" is neither R[n]/<start>/<duration> nor <start>/<duration>` };
}

const countOf = (r) => (r === "R" ? Infinity : Number(r.slice(1)));

function built(startText, durationText, count) {
  const start = startOf(startText);
  const duration = durationOf(durationText);
  const bad = [start, duration].find((x) => x.error);
  return bad ? { ok: false, error: bad.error } : { ok: true, spec: { start, duration, count } };
}

function durationOf(text) {
  const m = DURATION.exec(text ?? "");
  const n = (i) => Number(m[i] ?? 0);
  const d = m ? { months: n(1) * 12 + n(2), days: n(3) * 7 + n(4), timeMs: (n(5) * 3600 + n(6) * 60 + n(7)) * 1000 } : null;
  return d && d.months + d.days + d.timeMs > 0 ? d : { error: `"${text}" is not a non-zero duration like P1D or PT15M (whole numbers, no fractions)` };
}

function startOf(text) {
  const m = START.exec(text ?? "");
  if (!m) return { error: `"${text}" is not a start like 2026-10-22T09:00:00+07:00` };
  const f = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hour: Number(m[4]), minute: Number(m[5]), second: Number(m[6] ?? 0) };
  const real = f.hour < 24 && FIELDS.every((k) => fieldsOf(wallOf(f))[k] === f[k]);
  return real ? { wall: wallOf(f), offset: m[7] ?? null, offsetMs: offsetMsOf(m[7]) } : { error: `"${text}" names no real date and time` };
}

function offsetMsOf(text) {
  const m = OFFSET.exec(text ?? "");
  return text === undefined ? null : text === "Z" ? 0 : (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60000;
}

const exact = (spec) => spec.start.offsetMs !== null && !spec.duration.months && !spec.duration.days;
const startInstant = (spec) => spec.start.wall - spec.start.offsetMs;
const startWall = (spec, zone) => (spec.start.offsetMs === null ? spec.start.wall : zone.wallAt(startInstant(spec)));
const period = (d) => d.months * MEAN_MONTH + d.days * DAY + d.timeMs;

function candidateAt(spec, k, zone) {
  if (exact(spec)) return { instant: startInstant(spec) + k * spec.duration.timeMs };
  return { wall: addMonths(startWall(spec, zone), k * spec.duration.months) + k * spec.duration.days * DAY, plusMs: k * spec.duration.timeMs };
}

const beyond = (c, range) => (c.instant !== undefined ? c.instant >= range.toMs : c.wall + c.plusMs > range.toWall);

// The first k worth trying: an estimate from the mean period, two periods early, so the window's
// own filter decides and a long series is never walked from its start.
function firstK(spec, range) {
  const from = exact(spec) ? range.fromMs - startInstant(spec) : range.fromWall - startWall(spec, range.zone);
  return Math.max(0, Math.floor(from / period(spec.duration)) - 2);
}

function* candidates(spec, range) {
  for (let k = firstK(spec, range); k < spec.count && !beyond(candidateAt(spec, k, range.zone), range); k++) yield candidateAt(spec, k, range.zone);
}

export const iso8601Interval = withNext({
  id: "iso8601-interval",
  doc: "ISO 8601 repeating interval R[n]/<start>/<duration> (or <start>/<duration> once): calendar steps on the wall time, exact steps as durations",
  needsZone: (spec) => spec.start.offsetMs === null,
  defaultZone: (spec) => spec.start.offset ?? undefined,
  parse,
  candidates,
});
