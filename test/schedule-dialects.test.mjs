import assert from "node:assert/strict";
import { test } from "node:test";
import { DIALECTS, dialectOf } from "../skills/orbit-backend-test/schedule/index.mjs";

const cron5 = dialectOf("cron5");
const cron6 = dialectOf("cron6");
const iso = dialectOf("iso8601-interval");
const at = (text) => Date.parse(text);
const text = (ms) => (ms === null ? null : new Date(ms).toISOString());

function spec(dialect, expression) {
  const parsed = dialect.parse(expression);
  assert.equal(parsed.ok, true, parsed.error);
  return parsed.spec;
}

function refused(dialect, expression, pattern) {
  const parsed = dialect.parse(expression);
  assert.equal(parsed.ok, false, `${expression} should be refused`);
  assert.match(parsed.error, pattern);
}

function series(dialect, expression, fromIso, n, zone = "UTC") {
  const s = spec(dialect, expression);
  const out = [];
  let from = at(fromIso);
  for (let i = 0; i < n; i++) {
    from = from === null ? null : dialect.next(s, from, zone);
    out.push(text(from));
  }
  return out;
}

test("the dialects are a table, and a dialect nobody registered is a gap, not a guess", () => {
  assert.deepEqual(DIALECTS.map((d) => d.id), ["cron5", "cron6", "iso8601-interval"]);
  for (const d of DIALECTS) for (const k of ["doc", "parse", "next", "candidates", "needsZone"]) assert.ok(d[k], `${d.id}.${k}`);
  assert.deepEqual(dialectOf("quartz"), { gap: "dialect", id: "quartz" });
});

test("cron5: ranges, lists, steps and names become the values each field allows", () => {
  const s = spec(cron5, "*/15 9-17 * * MON-FRI");
  assert.deepEqual(s.minutes, [0, 15, 30, 45]);
  assert.deepEqual(s.hours, [9, 10, 11, 12, 13, 14, 15, 16, 17]);
  assert.deepEqual([...s.dow], [1, 2, 3, 4, 5]);
  assert.equal(s.domStar, true);
  assert.equal(s.dowStar, false);
  assert.deepEqual([...spec(cron5, "0 0 1 JAN,jul *").months], [1, 7], "month names, any case");
  assert.deepEqual(spec(cron5, "10-20/5 * * * *").minutes, [10, 15, 20]);
  assert.deepEqual(spec(cron5, "5/20 * * * *").minutes, [5, 25, 45], "N/step runs from N to the field's maximum");
  assert.deepEqual([...spec(cron5, "0 0 * * 7").dow], [0], "7 is Sunday, as 0 is");
  assert.deepEqual([...spec(cron5, "0 0 * * 5-7").dow], [0, 5, 6]);
  assert.deepEqual(spec(cron5, "@daily"), spec(cron5, "0 0 * * *"));
  assert.deepEqual(spec(cron5, "@weekly"), spec(cron5, "0 0 * * 0"));
});

test("cron5: what belongs to another dialect, or reads backwards, is refused, never approximated", () => {
  refused(cron5, "0 9 ? * MON", /"\?" belongs to another cron dialect/);
  refused(cron5, "0 9 L * *", /"L" is not a day-of-month/);
  refused(cron5, "0 9 15W * *", /"15W" is not a day-of-month/);
  refused(cron5, "0 9 * * 5#3", /"5#3" is not a day-of-week value/);
  refused(cron5, "0 9 * *", /5-field expression, and "0 9 \* \*" has 4/);
  refused(cron5, "", /has 0/);
  refused(cron5, "0 17-9 * * *", /hour range 17-9 runs backwards/);
  refused(cron5, "60 * * * *", /"60" is not a minute \(0-59\)/);
  refused(cron5, "*/0 * * * *", /step is at least 1/);
  refused(cron5, "*-5 * * * *", /"\*-5" is not a minute range/);
  refused(cron5, "0 0 1 FOO *", /"FOO" is not a month/);
});

test("cron5: next is strictly after, on the zone's wall time", () => {
  const s = spec(cron5, "0 9 * * *");
  assert.equal(text(cron5.next(s, at("2026-10-21T10:00:00+07:00"), "Asia/Ho_Chi_Minh")), "2026-10-22T02:00:00.000Z");
  assert.equal(text(cron5.next(s, at("2026-10-22T09:00:00+07:00"), "Asia/Ho_Chi_Minh")), "2026-10-23T02:00:00.000Z", "an occurrence AT fromMs is not after it");
  assert.equal(text(cron5.next(s, at("2026-10-22T08:59:59+07:00"), "Asia/Ho_Chi_Minh")), "2026-10-22T02:00:00.000Z");
});

test("cron5: Vixie day matching -- both days restricted means EITHER; a field starting with * means both", () => {
  const days = (iso) => iso.slice(0, 10);
  assert.deepEqual(series(cron5, "0 0 13 * FRI", "2026-10-01T00:00:00Z", 4).map(days), ["2026-10-02", "2026-10-09", "2026-10-13", "2026-10-16"]);
  assert.equal(new Date("2026-10-13T00:00:00Z").getUTCDay(), 2, "the 13th is a Tuesday: it fires because day-of-month matched");
  assert.deepEqual(series(cron5, "0 0 */2 * MON", "2026-10-01T00:00:00Z", 2).map(days), ["2026-10-05", "2026-10-19"], "*/2 counts as unrestricted: odd days that are Mondays");
});

test("cron5: an expression that never matches answers null at the horizon, quickly", () => {
  const started = Date.now();
  assert.equal(cron5.next(spec(cron5, "0 0 30 2 *"), at("2026-03-01T00:00:00Z"), "UTC"), null);
  assert.ok(Date.now() - started < 5000);
  assert.equal(text(cron5.next(spec(cron5, "0 0 29 2 *"), at("2026-03-01T00:00:00Z"), "UTC")), "2028-02-29T00:00:00.000Z");
});

test("a dialect's next refuses a zone the runtime does not know", () => {
  assert.throws(() => cron5.next(spec(cron5, "0 9 * * *"), at("2026-10-22T00:00:00Z"), "Mars/Olympus_Mons"), RangeError);
});

test("cron6: a leading second, and a macro at second 0", () => {
  assert.equal(text(cron6.next(spec(cron6, "*/30 * * * * *"), at("2026-10-22T00:00:10Z"), "UTC")), "2026-10-22T00:00:30.000Z");
  const hourly = spec(cron6, "@hourly");
  assert.deepEqual([hourly.seconds, hourly.minutes], [[0], [0]]);
  refused(cron6, "0 9 * * *", /6-field expression/);
  refused(cron6, "61 * * * * *", /"61" is not a second/);
});

test("iso8601-interval: Rn is n occurrences from the start, then nothing", () => {
  assert.deepEqual(series(iso, "R3/2026-10-22T09:00:00+07:00/P1D", "2026-10-21T00:00:00Z", 4), ["2026-10-22T02:00:00.000Z", "2026-10-23T02:00:00.000Z", "2026-10-24T02:00:00.000Z", null]);
  assert.deepEqual(series(iso, "2026-10-22T09:00:00Z/PT1H", "2026-10-22T00:00:00Z", 2), ["2026-10-22T09:00:00.000Z", null], "<start>/<duration> is one occurrence");
  assert.deepEqual(series(iso, "R0/2026-10-22T09:00:00Z/PT1H", "2026-10-22T00:00:00Z", 1), [null]);
});

test("iso8601-interval: calendar months are counted from the start and clamped, so a series never drifts", () => {
  assert.deepEqual(series(iso, "R/2026-01-31T09:00:00Z/P1M", "2026-01-01T00:00:00Z", 4).map((t) => t.slice(0, 10)), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  assert.deepEqual(series(iso, "R/2026-10-22T09:00:00Z/P1W", "2026-10-22T09:00:00Z", 1), ["2026-10-29T09:00:00.000Z"]);
});

test("iso8601-interval: a start with an offset needs no zone; one without needs the contract's", () => {
  assert.equal(iso.needsZone(spec(iso, "R/2026-10-22T09:00:00+07:00/PT1H")), false);
  assert.equal(iso.needsZone(spec(iso, "R/2026-10-22T09:00:00/PT1H")), true);
  assert.equal(text(iso.next(spec(iso, "R/2026-10-22T09:00:00/P1D"), at("2026-10-21T00:00:00Z"), "Asia/Ho_Chi_Minh")), "2026-10-22T02:00:00.000Z");
});

test("iso8601-interval: a fraction, a zero step, an impossible date, an end-anchored interval or the basic format is refused", () => {
  refused(iso, "R3/2026-02-30T09:00:00Z/P1D", /names no real date and time/);
  refused(iso, "R3/2026-10-22T24:00:00Z/P1D", /names no real date and time/);
  refused(iso, "R/2026-10-22T09:00:00Z/P0D", /not a non-zero duration/);
  refused(iso, "R/2026-10-22T09:00:00Z/PT0.5S", /no fractions/);
  refused(iso, "R/2026-10-22T09:00:00Z/PT", /not a non-zero duration/);
  refused(iso, "P1D/2026-10-22T09:00:00Z", /neither R\[n\]/);
  refused(iso, "R3/20261022T0900/P1D", /is not a start like/);
  refused(iso, "every day", /neither R\[n\]/);
});
