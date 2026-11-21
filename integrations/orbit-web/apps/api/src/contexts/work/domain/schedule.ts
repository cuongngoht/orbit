// RECURRING WORK, as time (pure: no clock is read here, every instant is given). A schedule's rule says WHEN in the
// schedule's own IANA time zone -- a local time of day, on a weekday, a day of the month, or the first month of a
// quarter -- and WHICH period the work covers: the one that just ended (`previous`: the quarterly report made on the first
// day of a quarter is about the quarter before) or the one that starts (`current`).
//
//   - A local time that does not exist (the hour a DST change skips) runs at the first instant after the gap; one that
//     happens twice (the hour a DST change repeats) runs at its first.
//   - A period has a KEY (2026-11-20 · 2026-W47 · 2026-10 · 2026-Q3) unique per schedule: an occurrence is made once per
//     period, whoever (and however many schedulers) asks.
import type { ScheduleRule, ScheduleRun } from "@orbit-web/contracts";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

interface Wall {
  y: number;
  m: number; // 1-12
  d: number;
  h: number;
  mi: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    formatters.set(zone, f);
  }
  return f;
}

// The wall clock of `zone` at an instant, as if it were UTC (milliseconds).
function wallAt(zone: string, utc: number): number {
  const parts = Object.fromEntries(formatter(zone).formatToParts(new Date(utc)).map((p) => [p.type, p.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
}

const offsetAt = (zone: string, utc: number): number => wallAt(zone, utc) - Math.floor(utc / 1000) * 1000;

// The instant a local wall-clock time happens in `zone` -- the first of two (a repeated hour), or the first instant after
// a skipped hour.
export function instantOf(zone: string, w: Wall): number {
  const wall = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi);
  const offsets = [...new Set([offsetAt(zone, wall - 2 * DAY), offsetAt(zone, wall), offsetAt(zone, wall + 2 * DAY)])];
  const valid = offsets.map((o) => wall - o).filter((u) => wallAt(zone, u) === wall);
  if (valid.length > 0) return Math.min(...valid);
  // A gap: the earliest instant whose wall clock is past the asked time (binary search to the second).
  let lo = wall - Math.max(...offsets);
  let hi = wall - Math.min(...offsets);
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2000) * 1000;
    if (wallAt(zone, mid) >= wall) hi = mid;
    else lo = mid;
  }
  return hi;
}

// The local calendar date of an instant in `zone`.
function dateIn(zone: string, utc: number): { y: number; m: number; d: number } {
  const w = new Date(wallAt(zone, utc));
  return { y: w.getUTCFullYear(), m: w.getUTCMonth() + 1, d: w.getUTCDate() };
}

const pad = (n: number, w = 2): string => String(n).padStart(w, "0");
const iso = (y: number, m: number, d: number): string => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
const addDays = (y: number, m: number, d: number, n: number): { y: number; m: number; d: number } => {
  const t = new Date(Date.UTC(y, m - 1, d) + n * DAY);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};
const lastDay = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();
// ISO weekday: 1 Monday .. 7 Sunday.
const weekday = (y: number, m: number, d: number): number => ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;

function isoWeek(y: number, m: number, d: number): { year: number; week: number } {
  const t = new Date(Date.UTC(y, m - 1, d));
  const thursday = new Date(t.getTime() + (4 - weekday(y, m, d)) * DAY);
  const year = thursday.getUTCFullYear();
  const week = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY / 7) + 1;
  return { year, week };
}

const [hourOf, minuteOf] = [(t: string) => Number(t.slice(0, 2)), (t: string) => Number(t.slice(3, 5))];

// Whether a local date is a day the rule runs on.
function runsOn(rule: ScheduleRule, y: number, m: number, d: number): boolean {
  if (rule.kind === "daily") return true;
  if (rule.kind === "weekly") return weekday(y, m, d) === rule.dayOfWeek;
  if (rule.kind === "monthly") return d === (rule.dayOfMonth ?? 1);
  return d === (rule.dayOfMonth ?? 1) && (m - 1) % 3 === 0;
}

// The period a run on local date (y, m, d) covers.
export function periodOf(rule: ScheduleRule, y: number, m: number, d: number): { key: string; start: string; end: string } {
  const previous = rule.period === "previous";
  if (rule.kind === "daily") {
    const p = previous ? addDays(y, m, d, -1) : { y, m, d };
    const day = iso(p.y, p.m, p.d);
    return { key: day, start: day, end: day };
  }
  if (rule.kind === "weekly") {
    const anchor = previous ? addDays(y, m, d, -7) : { y, m, d };
    const monday = addDays(anchor.y, anchor.m, anchor.d, 1 - weekday(anchor.y, anchor.m, anchor.d));
    const sunday = addDays(monday.y, monday.m, monday.d, 6);
    const w = isoWeek(monday.y, monday.m, monday.d);
    return { key: `${w.year}-W${pad(w.week)}`, start: iso(monday.y, monday.m, monday.d), end: iso(sunday.y, sunday.m, sunday.d) };
  }
  if (rule.kind === "monthly") {
    const p = previous ? (m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 }) : { y, m };
    return { key: `${pad(p.y, 4)}-${pad(p.m)}`, start: iso(p.y, p.m, 1), end: iso(p.y, p.m, lastDay(p.y, p.m)) };
  }
  const q = Math.floor((m - 1) / 3);
  const pq = previous ? (q === 0 ? { y: y - 1, q: 3 } : { y, q: q - 1 }) : { y, q };
  const first = pq.q * 3 + 1;
  return { key: `${pad(pq.y, 4)}-Q${pq.q + 1}`, start: iso(pq.y, first, 1), end: iso(pq.y, first + 2, lastDay(pq.y, first + 2)) };
}

// The runs due strictly after `after`, in order (at most `count`, looking at most ~13 months ahead).
export function runsAfter(rule: ScheduleRule, after: number, count: number): ScheduleRun[] {
  const out: ScheduleRun[] = [];
  let day = addDays(...(Object.values(dateIn(rule.timezone, after)) as [number, number, number]), -1);
  for (let i = 0; i < 400 && out.length < count; i += 1, day = addDays(day.y, day.m, day.d, 1)) {
    if (!runsOn(rule, day.y, day.m, day.d)) continue;
    const due = instantOf(rule.timezone, { ...day, h: hourOf(rule.localTime), mi: minuteOf(rule.localTime) });
    if (due <= after) continue;
    const p = periodOf(rule, day.y, day.m, day.d);
    out.push({ dueAt: new Date(due).toISOString(), local: `${iso(day.y, day.m, day.d)}T${rule.localTime}`, periodKey: p.key, periodStart: p.start, periodEnd: p.end });
  }
  return out;
}

// Every run due in (after, until], oldest first -- what a scheduler that was away finds owed (bounded).
export function runsBetween(rule: ScheduleRule, after: number, until: number, limit = 100): ScheduleRun[] {
  const out: ScheduleRun[] = [];
  let from = after;
  while (out.length < limit) {
    const [next] = runsAfter(rule, from, 1);
    if (next === undefined || Date.parse(next.dueAt) > until) break;
    out.push(next);
    from = Date.parse(next.dueAt);
  }
  return out;
}

export type MissedDecision = { run: ScheduleRun; make: boolean; reason: string | null };

// What to do with the runs a scheduler finds due (oldest first): make each, the newest only, or skip what was missed.
// `graceMs`: a run due longer ago than this is "missed" (it was not made when it was due).
export function decideMissed(runs: readonly ScheduleRun[], policy: "catch_up_latest" | "catch_up_each" | "skip", catchUpLimit: number, now: number, graceMs: number): MissedDecision[] {
  const missed = (r: ScheduleRun) => now - Date.parse(r.dueAt) > graceMs;
  if (policy === "catch_up_each") {
    const keep = new Set(runs.slice(-catchUpLimit).map((r) => r.periodKey));
    return runs.map((run) => (keep.has(run.periodKey) ? { run, make: true, reason: null } : { run, make: false, reason: `Missed, and more than ${catchUpLimit} periods behind: not made.` }));
  }
  if (policy === "catch_up_latest") return runs.map((run, i) => (i === runs.length - 1 ? { run, make: true, reason: null } : { run, make: false, reason: "Missed: a later period was made instead." }));
  return runs.map((run) => (missed(run) ? { run, make: false, reason: "Missed while the scheduler was away: skipped, as the schedule says." } : { run, make: true, reason: null }));
}
