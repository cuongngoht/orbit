// Calendar days.
import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, daysBetween, isDay } from "../src/dates.mjs";

test("a day is a day of the calendar, written YYYY-MM-DD", () => {
  assert.deepEqual(["2026-03-02", "2024-02-29"].map(isDay), [true, true]);
  assert.deepEqual(["2026-02-29", "2026-13-01", "2026-3-2", "", null, 20260302].map(isDay), [false, false, false, false, false, false]);
});

test("days are added across the end of a month and of a year", () => {
  assert.equal(addDays("2026-02-25", 7), "2026-03-04");
  assert.equal(addDays("2026-12-28", 21), "2027-01-18");
  assert.equal(addDays("2026-03-02", 0), "2026-03-02");
});

test("the days from one day to another", () => {
  assert.equal(daysBetween("2026-03-02", "2026-03-05"), 3);
  assert.equal(daysBetween("2026-03-05", "2026-03-02"), -3);
  assert.equal(daysBetween("2026-02-27", "2026-03-02"), 3);
});
