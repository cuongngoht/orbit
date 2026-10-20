// WHICH period a project report is about, and where its calendar's days,
// weeks and months begin -- decided ONCE, here, in the project's time zone.
//
// Pure: `now` and the zone are handed in, and every answer is a function of
// them, so the same request gives the same bytes on any machine in any TZ.
// Intl carries the IANA database on every platform Node runs on, Windows
// included, which is why the calendar is computed here and handed to the Python
// parts as a table rather than asked of Python's zoneinfo (which needs a tzdata
// package on Windows).
//
// The rules, as the product owner decided them:
//
//   default     the last N COMPLETE calendar months (N = 2 unless settings or
//               the request say otherwise), and the CUT-OFF is the end of the
//               last of them -- so what was open is also read at that moment,
//               and the current month appears only when asked for
//   --as-of=D   the cut-off is the end of day D: the window is the N complete
//               months up to it, and the backlog is read at D
//   --from/--to an explicit range of days; --months with --to counts back from
//               the month of `to`, so `--months=2 --to=<today>` is "last month
//               and this one, to date"
//   --all       everything up to the cut-off; where it starts is only known
//               once the source has been read (calendarBetween)
//
// A month is counted from its FIRST DAY, never by subtracting days, so the end
// of a month and a leap day are ordinary. A day starts at its own local
// midnight, found as an instant, so a 23- or 25-hour day around a DST change is
// exactly as long as it was.
import { Refused } from "../errors.mjs";

export const DEFAULT_MONTHS = 2;
export const MAX_MONTHS = 60;
const DAY_MS = 86400000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// request: { months?, from?, to?, asOf?, all? } · now: epoch ms · tz: IANA zone
export function periodOf(request = {}, { now, tz, months = DEFAULT_MONTHS } = {}) {
  const zone = zoneOf(tz);
  const asked = checked(request, months);
  const today = localDate(now, zone);
  return shapeOf(asked, today, now, zone);
}

function checked(request, months) {
  const n = request.months ?? months;
  if (!Number.isInteger(n) || n < 1 || n > MAX_MONTHS) throw new Refused(`--months takes a whole number from 1 to ${MAX_MONTHS}`);
  for (const k of ["from", "to", "asOf"]) if (request[k] !== undefined && !isDate(request[k])) throw new Refused(`--${k === "asOf" ? "as-of" : k} takes a date as YYYY-MM-DD, e.g. 2026-08-31`);
  if (request.from && !request.to) throw new Refused("--from needs --to: a range has both ends");
  return { ...request, months: n };
}

// The first mode that matches the request decides, and the last always does.
const MODES = [
  { when: (r) => r.all === true, shape: (r, today, now, zone) => allOf(r, today, now, zone) },
  { when: (r) => Boolean(r.from), shape: (r, today, now, zone) => rangeOf(r.from, r.to, r, today, now, zone) },
  { when: (r) => Boolean(r.to), shape: (r, today, now, zone) => rangeOf(monthsBack(r.to, r.months), r.to, r, today, now, zone) },
  { when: () => true, shape: (r, today, now, zone) => completeMonths(r, today, now, zone) },
];

const shapeOf = (r, today, now, zone) => MODES.find((m) => m.when(r)).shape(r, today, now, zone);

// N whole months that END at or before the cut-off. A cut-off at the end of a
// month's last day completes that month; one in the middle of a month leaves it
// out -- and the backlog is still read at the cut-off.
function completeMonths(r, today, now, zone) {
  const cutoffDay = cutoffDayOf(r, today, now, zone);
  const end = monthStartAfter(cutoffDay);
  return described({ mode: "months", months: r.months, from: addMonths(end, -r.months), to: addDays(end, -1), cutoff: cutoffDay }, now, zone);
}

// The default cut-off is the last day of the last COMPLETE month: run on the
// 25th, it is the end of last month; run on the 1st, the end of the month
// just finished.
function cutoffDayOf(r, today, now, zone) {
  if (r.asOf) return notFuture(r.asOf, today, "--as-of");
  return addDays(firstOfMonth(today), -1);
}

function rangeOf(from, to, r, today, now, zone) {
  if (from > to) throw new Refused(`the range starts ${from}, after it ends ${to}`);
  const cutoff = r.asOf ? notFuture(r.asOf, today, "--as-of") : minDate(to, today);
  if (cutoff < from) throw new Refused(`the cut-off ${cutoff} is before the range starts ${from}`);
  return described({ mode: "range", months: r.to && !r.from ? r.months : null, from, to, cutoff }, now, zone);
}

function allOf(r, today, now, zone) {
  const cutoff = r.asOf ? notFuture(r.asOf, today, "--as-of") : today;
  return described({ mode: "all", months: null, from: null, to: cutoff, cutoff }, now, zone);
}

// The instants every consumer uses: a window is [fromUtc, toUtc), and nothing
// that happened at or after cutoffUtc exists for this report. A cut-off of
// TODAY is "now", because the rest of today has not happened yet.
function described(w, now, zone) {
  const cutoffUtc = Math.min(dayStart(addDays(w.cutoff, 1), zone), now);
  const toUtc = Math.min(dayStart(addDays(w.to, 1), zone), cutoffUtc);
  return { ...w, tz: zone, fromUtc: w.from ? iso(dayStart(w.from, zone)) : null, toUtc: iso(toUtc), cutoffUtc: iso(cutoffUtc), partial: toUtc < dayStart(addDays(w.to, 1), zone) };
}

function notFuture(day, today, flag) {
  if (day > today) throw new Refused(`${flag} ${day} is in the future; a report can only be cut at a day that has begun`);
  return day;
}

// ---- the calendar handed to every part --------------------------------------

// Every local day, ISO week (Monday first) and month between two days
// inclusive, each with the instant it starts -- enough for a part to put any
// timestamp in its day, week or month by a binary search, with no zone rules.
export function calendarBetween(from, to, tz) {
  const zone = zoneOf(tz);
  const days = daysBetween(from, to).map((date) => [date, iso(dayStart(date, zone))]);
  return { tz: zone, days, end: iso(dayStart(addDays(to, 1), zone)), weeks: weeksOf(days), months: monthsOf(days) };
}

export const calendarOf = (window, earliest) => calendarBetween(window.from ?? earliest ?? window.to, window.to, window.tz);

const weeksOf = (days) => days.filter(([date], i) => i === 0 || weekday(date) === 1).map(([date, startUtc]) => ({ start: date, startUtc }));

const monthsOf = (days) => days.filter(([date], i) => i === 0 || date.endsWith("-01")).map(([date, startUtc]) => ({ month: date.slice(0, 7), start: date, startUtc }));

function daysBetween(from, to) {
  const n = Math.round((utc(to) - utc(from)) / DAY_MS);
  if (n < 0 || n > 366 * 30) throw new Refused(`a calendar from ${from} to ${to} is not one this engine can draw`);
  return Array.from({ length: n + 1 }, (_, i) => addDays(from, i));
}

// ---- local time from Intl ---------------------------------------------------

// The zone as the project NAMED it, once Intl has accepted it. Not Intl's
// canonical spelling: two Node versions canonicalise an alias differently, and
// the name a report prints must not change with the runtime that printed it.
export function zoneOf(tz) {
  if (typeof tz !== "string" || !tz) throw new Refused("the project's time zone is not set — an IANA name such as Asia/Ho_Chi_Minh");
  try { return (new Intl.DateTimeFormat("en-US", { timeZone: tz }), tz); }
  catch { throw new Refused(`${tz} is not a time zone this machine knows — use an IANA name such as Asia/Ho_Chi_Minh`); }
}

const FORMATS = new Map();

function formatter(zone) {
  if (!FORMATS.has(zone)) FORMATS.set(zone, new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }));
  return FORMATS.get(zone);
}

// The local calendar day an instant falls on, as YYYY-MM-DD.
export function localDate(ms, zone) {
  const p = Object.fromEntries(formatter(zone).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

// The first instant (to the minute) whose local date is `date`: a binary search
// over three days around UTC midnight, which is where every zone's midnight is.
export function dayStart(date, zone) {
  const guess = utc(date);
  return searched(guess - 1.5 * DAY_MS, guess + 1.5 * DAY_MS, date, zone);
}

function searched(lo, hi, date, zone) {
  if (hi - lo <= 60000) return hi;
  const mid = lo + Math.floor((hi - lo) / 120000) * 60000;
  return localDate(mid, zone) >= date ? searched(lo, mid, date, zone) : searched(mid, hi, date, zone);
}

// ---- plain calendar arithmetic, in UTC where no zone can move it -------------

export const isDate = (s) => typeof s === "string" && DATE.test(s) && ymd(new Date(utc(s))) === s;

const utc = (date) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));

const ymd = (d) => d.toISOString().slice(0, 10);

export const addDays = (date, n) => ymd(new Date(utc(date) + n * DAY_MS));

export function addMonths(firstOfAMonth, n) {
  const d = new Date(utc(firstOfAMonth));
  return ymd(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)));
}

const firstOfMonth = (date) => `${date.slice(0, 7)}-01`;

// The first day of the month AFTER the one `day` completes -- or of the month
// `day` is in, when `day` is not its month's last day.
const monthStartAfter = (day) => (addDays(day, 1).endsWith("-01") ? addDays(day, 1) : firstOfMonth(day));

const monthsBack = (to, months) => addMonths(firstOfMonth(to), 1 - months);

const minDate = (a, b) => (a < b ? a : b);

const weekday = (date) => new Date(utc(date)).getUTCDay();

const iso = (ms) => new Date(ms).toISOString();
