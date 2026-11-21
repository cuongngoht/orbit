import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScheduleRule } from "@orbit-web/contracts";
import { decideMissed, instantOf, periodOf, runsAfter, runsBetween } from "./schedule.js";

const at = (s: string): number => Date.parse(s);
const rule = (r: Partial<ScheduleRule>): ScheduleRule => ({ kind: "daily", timezone: "Asia/Ho_Chi_Minh", localTime: "08:00", period: "previous", ...r });

test("a daily run happens at the local time of the schedule's own zone", () => {
  const [next] = runsAfter(rule({}), at("2026-11-21T00:30:00Z"), 1);
  assert.equal(next?.dueAt, "2026-11-21T01:00:00.000Z");
  assert.equal(next?.local, "2026-11-21T08:00");
  assert.equal(next?.periodKey, "2026-11-20");
});

test("a quarterly run on the first day of a quarter reports on the quarter before", () => {
  const q = rule({ kind: "quarterly", dayOfMonth: 1, timezone: "Asia/Ho_Chi_Minh" });
  const [next, after] = runsAfter(q, at("2026-09-15T00:00:00Z"), 2);
  assert.equal(next?.local, "2026-10-01T08:00");
  assert.equal(next?.periodKey, "2026-Q3");
  assert.equal(next?.periodStart, "2026-07-01");
  assert.equal(next?.periodEnd, "2026-09-30");
  assert.equal(after?.periodKey, "2026-Q4");
  const jan = periodOf(q, 2027, 1, 1);
  assert.deepEqual(jan, { key: "2026-Q4", start: "2026-10-01", end: "2026-12-31" });
});

test("weekly and monthly periods: ISO weeks and calendar months, the current one when asked", () => {
  const weekly = rule({ kind: "weekly", dayOfWeek: 1 });
  assert.deepEqual(periodOf(weekly, 2026, 11, 23), { key: "2026-W47", start: "2026-11-16", end: "2026-11-22" });
  assert.deepEqual(periodOf({ ...weekly, period: "current" }, 2026, 11, 23), { key: "2026-W48", start: "2026-11-23", end: "2026-11-29" });
  assert.deepEqual(periodOf(rule({ kind: "monthly", dayOfMonth: 1 }), 2026, 1, 1), { key: "2025-12", start: "2025-12-01", end: "2025-12-31" });
  assert.deepEqual(periodOf(rule({ kind: "monthly", dayOfMonth: 1, period: "current" }), 2028, 2, 1), { key: "2028-02", start: "2028-02-01", end: "2028-02-29" });
});

test("a local time a DST change skips runs at the first instant after the gap; a repeated one at its first", () => {
  // New York, 2026-03-08: 02:00-03:00 does not exist; 2026-11-01: 01:00-02:00 happens twice.
  assert.equal(new Date(instantOf("America/New_York", { y: 2026, m: 3, d: 8, h: 2, mi: 30 })).toISOString(), "2026-03-08T07:00:00.000Z");
  assert.equal(new Date(instantOf("America/New_York", { y: 2026, m: 11, d: 1, h: 1, mi: 30 })).toISOString(), "2026-11-01T05:30:00.000Z");
  const nightly = rule({ timezone: "America/New_York", localTime: "02:30" });
  const runs = runsAfter(nightly, at("2026-03-07T12:00:00Z"), 3);
  assert.deepEqual(runs.map((r) => r.dueAt), ["2026-03-08T07:00:00.000Z", "2026-03-09T06:30:00.000Z", "2026-03-10T06:30:00.000Z"]);
  assert.deepEqual(runs.map((r) => r.periodKey), ["2026-03-07", "2026-03-08", "2026-03-09"]);
});

test("a scheduler that was away finds each period owed once, and the missed-period policy decides what is made", () => {
  const owed = runsBetween(rule({}), at("2026-11-17T02:00:00Z"), at("2026-11-21T03:00:00Z"));
  assert.deepEqual(owed.map((r) => r.periodKey), ["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]);
  const now = at("2026-11-21T03:00:00Z");
  const grace = 15 * 60_000;
  assert.deepEqual(decideMissed(owed, "catch_up_each", 2, now, grace).map((d) => d.make), [false, false, true, true]);
  assert.deepEqual(decideMissed(owed, "catch_up_latest", 4, now, grace).map((d) => d.make), [false, false, false, true]);
  assert.deepEqual(decideMissed(owed, "skip", 4, now, grace).map((d) => d.make), [false, false, false, false]);
  const onTime = runsBetween(rule({}), at("2026-11-21T00:59:00Z"), at("2026-11-21T01:05:00Z"));
  assert.deepEqual(decideMissed(onTime, "skip", 4, at("2026-11-21T01:05:00Z"), grace).map((d) => d.make), [true]);
});
