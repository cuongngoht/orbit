// Which period a project report is about: two COMPLETE calendar months by
// default, in the project's zone, cut at the end of the last one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Refused } from "../src/errors.mjs";
import { calendarBetween, dayStart, localDate, periodOf } from "../src/project-report/window.mjs";

const HCM = "Asia/Ho_Chi_Minh";
const at = (isoText) => Date.parse(isoText);
const span = (w) => [w.from, w.to, w.cutoff];

test("run on 25 September: July and August, cut at the end of 31 August -- September does not appear", () => {
  const w = periodOf({}, { now: at("2026-09-25T03:00:00Z"), tz: HCM });
  assert.deepEqual(span(w), ["2026-07-01", "2026-08-31", "2026-08-31"]);
  assert.deepEqual([w.mode, w.months, w.partial], ["months", 2, false]);
  assert.deepEqual([w.fromUtc, w.toUtc, w.cutoffUtc], ["2026-06-30T17:00:00.000Z", "2026-08-31T17:00:00.000Z", "2026-08-31T17:00:00.000Z"]);
});

test("the end of a month: 30 September at 14:00 is still Jul–Aug; --as-of=2026-09-30 completes September; 1 October is Aug–Sep", () => {
  assert.deepEqual(span(periodOf({}, { now: at("2026-09-30T07:00:00Z"), tz: HCM })), ["2026-07-01", "2026-08-31", "2026-08-31"]);
  assert.deepEqual(span(periodOf({ asOf: "2026-09-30" }, { now: at("2026-10-05T00:00:00Z"), tz: HCM })), ["2026-08-01", "2026-09-30", "2026-09-30"]);
  assert.deepEqual(span(periodOf({}, { now: at("2026-10-01T02:00:00Z"), tz: HCM })), ["2026-08-01", "2026-09-30", "2026-09-30"]);
});

test("--as-of in the middle of a month keeps the complete months and reads the backlog at the cut-off", () => {
  const w = periodOf({ asOf: "2026-09-25" }, { now: at("2026-09-26T05:00:00Z"), tz: HCM });
  assert.deepEqual(span(w), ["2026-07-01", "2026-08-31", "2026-09-25"]);
  assert.equal(w.cutoffUtc, "2026-09-25T17:00:00.000Z");
  assert.ok(w.toUtc < w.cutoffUtc, "the window ends before the cut-off");
});

test("across a year, a leap day and --months", () => {
  assert.deepEqual(span(periodOf({}, { now: at("2027-01-15T00:00:00Z"), tz: HCM })), ["2026-11-01", "2026-12-31", "2026-12-31"]);
  assert.deepEqual(span(periodOf({ asOf: "2028-02-29" }, { now: at("2028-03-10T00:00:00Z"), tz: HCM })), ["2028-01-01", "2028-02-29", "2028-02-29"]);
  assert.deepEqual(span(periodOf({ months: 3 }, { now: at("2026-09-25T00:00:00Z"), tz: HCM })), ["2026-06-01", "2026-08-31", "2026-08-31"]);
});

test("--months=2 --to=<today> is last month and this one, TO DATE -- only because it was asked for", () => {
  const now = at("2026-09-25T03:00:00Z");
  const w = periodOf({ months: 2, to: "2026-09-25" }, { now, tz: HCM });
  assert.deepEqual([w.from, w.to, w.cutoff, w.partial, w.cutoffUtc], ["2026-08-01", "2026-09-25", "2026-09-25", true, new Date(now).toISOString()]);
});

test("an explicit range, --all, and the refusals", () => {
  const now = at("2026-09-25T03:00:00Z");
  assert.deepEqual(span(periodOf({ from: "2026-03-10", to: "2026-04-20" }, { now, tz: HCM })), ["2026-03-10", "2026-04-20", "2026-04-20"]);
  const all = periodOf({ all: true }, { now, tz: HCM });
  assert.deepEqual([all.mode, all.from, all.fromUtc, all.to], ["all", null, null, "2026-09-25"]);
  for (const bad of [{ asOf: "2026-10-01" }, { from: "2026-05-01", to: "2026-04-01" }, { from: "2026-05-01" }, { months: 0 }, { asOf: "2026-02-30" }]) assert.throws(() => periodOf(bad, { now, tz: HCM }), Refused, JSON.stringify(bad));
  assert.throws(() => periodOf({}, { now, tz: "Mars/Olympus" }), Refused);
});

test("a day starts at its OWN local midnight, so the DST days are 23 and 25 hours long", () => {
  const ny = "America/New_York";
  const hours = (a, b) => (dayStart(b, ny) - dayStart(a, ny)) / 3600000;
  assert.deepEqual([hours("2026-03-08", "2026-03-09"), hours("2026-11-01", "2026-11-02"), hours("2026-07-01", "2026-07-02")], [23, 25, 24]);
  assert.equal(localDate(Date.parse("2026-08-31T20:00:00-04:00"), ny), "2026-08-31");
  assert.equal(localDate(Date.parse("2026-08-31T20:00:00-04:00"), "UTC"), "2026-09-01", "the same merge is August in New York and September in UTC");
});

test("the calendar lists every day, the Mondays and the first of every month, each with the instant it starts", () => {
  const cal = calendarBetween("2026-07-01", "2026-08-31", HCM);
  assert.equal(cal.days.length, 62);
  assert.deepEqual(cal.days[0], ["2026-07-01", "2026-06-30T17:00:00.000Z"]);
  assert.equal(cal.end, "2026-08-31T17:00:00.000Z");
  assert.deepEqual(cal.months.map((m) => m.month), ["2026-07", "2026-08"]);
  assert.deepEqual(cal.weeks.slice(0, 2).map((w) => w.start), ["2026-07-01", "2026-07-06"]);
});

test("the answer does not depend on the machine's own TZ", () => {
  const before = process.env.TZ;
  const run = () => JSON.stringify([periodOf({}, { now: at("2026-09-25T03:00:00Z"), tz: HCM }), calendarBetween("2026-07-01", "2026-07-03", HCM)]);
  process.env.TZ = "Pacific/Kiritimati";
  const far = run();
  process.env.TZ = "America/Los_Angeles";
  const near = run();
  process.env.TZ = before;
  assert.equal(far, near);
});
