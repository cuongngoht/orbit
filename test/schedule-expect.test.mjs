import assert from "node:assert/strict";
import { test } from "node:test";
import { check, due, missed, occurrences, onOverlap } from "../skills/orbit-backend-test/schedule/expect.mjs";

const at = (text) => Date.parse(text);
const HOUR = 3600000;
const window = (from, to, limit) => ({ fromMs: at(from), toMs: at(to), ...(limit ? { limit } : {}) });
const ids = (list) => list.map((o) => o.occurrenceId);

// The document's example: billing-daily, 09:00 every day in Asia/Ho_Chi_Minh.
const BILLING = { dialect: "cron5", expression: "0 9 * * *", timezone: "Asia/Ho_Chi_Minh", revision: "sched-r1" };
const NY = (expression, dst) => ({ dialect: "cron5", expression, timezone: "America/New_York", revision: "r1", ...(dst ? { dst } : {}) });
const HOURLY = (extra = {}) => ({ dialect: "cron5", expression: "0 * * * *", timezone: "UTC", revision: "r1", ...extra });

test("the document's example: one occurrence for the period, named by schedule and scheduled time", () => {
  const r = occurrences(BILLING, window("2026-10-22T00:00:00+07:00", "2026-10-23T00:00:00+07:00"), "billing-daily");
  assert.deepEqual(ids(r.occurrences), ["billing-daily:2026-10-22T09:00:00+07:00"]);
  assert.equal(r.occurrences[0].instantMs, Date.UTC(2026, 9, 22, 2, 0, 0));
  assert.equal(r.occurrences[0].revision, "sched-r1");
  assert.deepEqual([r.truncated, r.unknowns, r.skipped], [false, [], []]);
});

test("before due, at due, after the deadline: due() says which, and what comes next", () => {
  const since = at("2026-10-22T00:00:00+07:00");
  const before = due(BILLING, at("2026-10-22T08:59:59+07:00"), { scheduleId: "billing-daily", sinceMs: since });
  assert.deepEqual(before.occurrences, []);
  assert.equal(before.next.occurrenceId, "billing-daily:2026-10-22T09:00:00+07:00");
  const atDue = due(BILLING, at("2026-10-22T09:00:00+07:00"), { scheduleId: "billing-daily", sinceMs: since });
  assert.deepEqual(atDue.occurrences.map((o) => [o.occurrenceId, o.state]), [["billing-daily:2026-10-22T09:00:00+07:00", "due"]]);
  assert.equal(atDue.next.occurrenceId, "billing-daily:2026-10-23T09:00:00+07:00");
  const late = due({ ...BILLING, deadlineMs: 15 * 60000 }, at("2026-10-22T09:20:00+07:00"), { scheduleId: "billing-daily", sinceMs: since });
  assert.equal(late.occurrences[0].state, "overdue");
});

test("a zone without DST never flags anything, and a DST zone keeps the wall time while the offset moves", () => {
  const hcm = occurrences(BILLING, window("2026-01-01T00:00:00+07:00", "2027-01-01T00:00:00+07:00"), "b");
  assert.equal(hcm.occurrences.length, 365);
  assert.ok(hcm.occurrences.every((o) => o.flags.length === 0 && o.scheduledFor.endsWith("T09:00:00+07:00")));
  const berlin = occurrences({ ...BILLING, timezone: "Europe/Berlin" }, window("2026-01-01T00:00:00+01:00", "2027-01-01T00:00:00+01:00"), "b");
  assert.equal(berlin.occurrences.length, 365);
  assert.ok(berlin.occurrences.every((o) => o.local.endsWith("T09:00:00") && o.flags.length === 0));
  assert.ok(berlin.occurrences[0].scheduledFor.endsWith("+01:00"));
  assert.ok(berlin.occurrences[200].scheduledFor.endsWith("+02:00"));
});

test("spring forward: a wall time that does not exist is skipped, shifted, or -- with no policy -- flagged and undecided", () => {
  const w = window("2026-03-08T00:00:00Z", "2026-03-08T12:00:00Z");
  const skip = occurrences(NY("30 2 * * *", { gap: "skip" }), w, "s");
  assert.deepEqual(skip.occurrences, []);
  assert.deepEqual(skip.skipped, [{ local: "2026-03-08T02:30:00", reason: "dst-gap" }]);
  const shift = occurrences(NY("30 2 * * *", { gap: "shift-forward" }), w, "s");
  assert.deepEqual(shift.occurrences.map((o) => [o.scheduledFor, o.flags]), [["2026-03-08T03:30:00-04:00", ["dst-gap-shifted"]]]);
  const unknown = occurrences(NY("30 2 * * *"), w, "s");
  assert.deepEqual(unknown.unknowns, ["dst policy"]);
  assert.deepEqual([unknown.occurrences[0].instantMs, unknown.occurrences[0].occurrenceId, unknown.occurrences[0].flags], [null, "s:2026-03-08T02:30:00", ["dst-gap", "dst-policy-unknown"]]);
  assert.deepEqual(unknown.occurrences[0].candidates.map((c) => c.scheduledFor), ["2026-03-08T03:30:00-04:00"]);
});

test("spring forward: a shifted time landing on one that exists anyway is ONE occurrence", () => {
  const r = occurrences(NY("30 2,3 * * *", { gap: "shift-forward" }), window("2026-03-08T00:00:00Z", "2026-03-08T12:00:00Z"), "s");
  assert.equal(r.occurrences.length, 1);
  assert.equal(r.occurrences[0].scheduledFor, "2026-03-08T03:30:00-04:00");
  assert.ok(r.occurrences[0].flags.includes("coincides"));
});

test("fall back: a wall time that happens twice fires once, twice, or -- with no policy -- stays undecided", () => {
  const w = window("2026-11-01T00:00:00Z", "2026-11-01T12:00:00Z");
  const first = occurrences(NY("30 1 * * *", { overlap: "first" }), w, "f");
  assert.deepEqual(first.occurrences.map((o) => o.scheduledFor), ["2026-11-01T01:30:00-04:00"]);
  const both = occurrences(NY("30 1 * * *", { overlap: "both" }), w, "f");
  assert.deepEqual(both.occurrences.map((o) => [o.scheduledFor, o.flags[0]]), [["2026-11-01T01:30:00-04:00", "dst-overlap-first"], ["2026-11-01T01:30:00-05:00", "dst-overlap-second"]]);
  assert.equal(new Set(ids(both.occurrences)).size, 2, "the offset keeps the two ids apart");
  const unknown = occurrences(NY("30 1 * * *"), w, "f");
  assert.deepEqual(unknown.unknowns, ["dst policy"]);
  assert.equal(unknown.occurrences.length, 1);
  assert.deepEqual(unknown.occurrences[0].candidates.map((c) => c.scheduledFor), ["2026-11-01T01:30:00-04:00", "2026-11-01T01:30:00-05:00"]);
  assert.equal(due(NY("30 1 * * *"), at("2026-11-01T12:00:00Z"), { scheduleId: "f" }).occurrences[0].state, "undecided");
});

test("missed occurrences: the declared misfire policy decides, the deadline skips, and no policy decides nothing", () => {
  const last = at("2026-10-22T00:00:00Z");
  const now = at("2026-10-22T05:30:00Z");
  const hours = (list) => list.map((o) => o.scheduledFor.slice(11, 13));
  assert.deepEqual(hours(missed(HOURLY({ misfire: "skip" }), last, now, { scheduleId: "h" }).skip), ["01", "02", "03", "04", "05"]);
  const once = missed(HOURLY({ misfire: "fire-once" }), last, now, { scheduleId: "h" });
  assert.deepEqual([hours(once.fire), once.skip.length, once.skip[0].reason], [["05"], 4, "misfire-coalesced"]);
  const latest = missed(HOURLY({ misfire: "fire-all", catchUpLimit: 2 }), last, now, { scheduleId: "h" });
  assert.deepEqual([hours(latest.fire), latest.skip.every((o) => o.reason === "catch-up-limit")], [["04", "05"], true]);
  assert.deepEqual(hours(missed(HOURLY({ misfire: "fire-all", catchUpLimit: 2, catchUpKeep: "earliest" }), last, now, { scheduleId: "h" }).fire), ["01", "02"]);
  const deadline = missed(HOURLY({ misfire: "fire-all", deadlineMs: 2 * HOUR }), last, now, { scheduleId: "h" });
  assert.deepEqual([hours(deadline.fire), deadline.skip.map((o) => o.reason)], [["04", "05"], ["deadline", "deadline", "deadline"]]);
  const undeclared = missed(HOURLY(), last, now, { scheduleId: "h" });
  assert.deepEqual([undeclared.fire, undeclared.undecided.length, undeclared.unknowns], [[], 5, ["misfire policy"]]);
});

test("work is bounded: a sparse expression is cut at the horizon, a dense one at the limit", () => {
  const leap = occurrences({ dialect: "cron5", expression: "0 0 29 2 *", timezone: "UTC" }, window("2026-03-01T00:00:00Z", "2046-03-01T00:00:00Z"), "leap");
  assert.deepEqual([leap.occurrences.map((o) => o.scheduledFor.slice(0, 10)), leap.truncated], [["2028-02-29", "2032-02-29"], true]);
  const never = { dialect: "cron5", expression: "0 0 30 2 *", timezone: "UTC" };
  assert.deepEqual([occurrences(never, window("2026-03-01T00:00:00Z", "2046-03-01T00:00:00Z"), "n").truncated, occurrences(never, window("2026-03-01T00:00:00Z", "2027-03-01T00:00:00Z"), "n").truncated], [true, false]);
  const dense = occurrences(HOURLY(), window("2026-10-22T00:00:00Z", "2026-10-23T00:00:00Z", 3), "h");
  assert.deepEqual([dense.occurrences.length, dense.truncated], [3, true]);
  assert.equal(due(never, at("2026-03-01T00:00:00Z"), { scheduleId: "n" }).next, null);
});

test("ISO intervals: calendar steps keep the wall time across DST, exact steps keep the duration", () => {
  const w = window("2026-10-30T00:00:00Z", "2026-11-03T00:00:00Z");
  const calendar = occurrences({ dialect: "iso8601-interval", expression: "R/2026-10-30T09:00:00/P1D", timezone: "America/New_York" }, w, "c");
  assert.deepEqual(calendar.occurrences.map((o) => o.scheduledFor), ["2026-10-30T09:00:00-04:00", "2026-10-31T09:00:00-04:00", "2026-11-01T09:00:00-05:00", "2026-11-02T09:00:00-05:00"]);
  const exact = occurrences({ dialect: "iso8601-interval", expression: "R/2026-10-30T09:00:00-04:00/PT24H", timezone: "America/New_York" }, w, "e");
  assert.deepEqual(exact.occurrences.map((o) => o.scheduledFor), ["2026-10-30T09:00:00-04:00", "2026-10-31T09:00:00-04:00", "2026-11-01T08:00:00-05:00", "2026-11-02T08:00:00-05:00"]);
  const offsetOnly = occurrences({ dialect: "iso8601-interval", expression: "R2/2026-10-22T09:00:00+07:00/PT12H" }, window("2026-10-22T00:00:00Z", "2026-10-24T00:00:00Z"), "o");
  assert.deepEqual([offsetOnly.occurrences.map((o) => o.scheduledFor), offsetOnly.unknowns], [["2026-10-22T09:00:00+07:00", "2026-10-22T21:00:00+07:00"], []]);
});

test("a calendar rule is read on the local date, and what the contract does not explain is an unknown", () => {
  const w = window("2026-10-22T00:00:00+07:00", "2026-10-27T00:00:00+07:00");
  const r = occurrences({ ...BILLING, calendar: { exclude: ["2026-10-24"], weekdays: [1, 2, 3, 4, 5] } }, w, "b");
  assert.deepEqual(r.occurrences.map((o) => o.local.slice(0, 10)), ["2026-10-22", "2026-10-23", "2026-10-26"]);
  assert.deepEqual(r.skipped.map((s) => [s.local.slice(0, 10), s.reason]), [["2026-10-24", "calendar"], ["2026-10-25", "calendar"]]);
  assert.deepEqual(occurrences({ ...BILLING, jitter: "5m", calendar: { holidays: "VN" } }, w, "b").unknowns, ["contract.jitter", "calendar.holidays"]);
});

test("no dialect, no zone, a zone nobody knows, or a policy outside its words: a gap, an unknown or an error -- never a guess", () => {
  const w = window("2026-10-22T00:00:00Z", "2026-10-23T00:00:00Z");
  const gap = occurrences({ ...BILLING, dialect: "quartz" }, w, "b");
  assert.deepEqual([gap.gap, gap.occurrences], ["dialect", []]);
  assert.deepEqual(occurrences({ ...BILLING, timezone: undefined }, w, "b").unknowns, ["timezone"]);
  assert.match(occurrences({ ...BILLING, timezone: "Mars/Olympus_Mons" }, w, "b").error, /not a time zone this runtime knows/);
  assert.match(occurrences({ ...BILLING, misfire: "sometimes" }, w, "b").error, /misfire is one of skip, fire-once, fire-all/);
  assert.match(occurrences({ ...BILLING, expression: "0 9 ? * *" }, w, "b").error, /"\?" belongs to another cron dialect/);
  assert.match(missed({ ...BILLING, dialect: "quartz" }, 0, 1, { scheduleId: "b" }).error, /no schedule dialect "quartz"/);
  assert.deepEqual(check({ ...BILLING, dst: { gap: "later" }, catchUpLimit: -1 }).problems, ["catchUpLimit is a whole number, 0 or more", "dst.gap is one of skip, shift-forward"]);
});

test("overlap: the contract's word decides what a run in progress means for the next occurrence", () => {
  assert.deepEqual(onOverlap({ overlap: "allow" }), { decision: "start-alongside", unknowns: [] });
  assert.deepEqual(onOverlap({ overlap: "forbid" }), { decision: "skip-new", unknowns: [] });
  assert.deepEqual(onOverlap({ overlap: "replace" }), { decision: "replace-running", unknowns: [] });
  assert.deepEqual(onOverlap({}), { decision: null, unknowns: ["overlap policy"] });
});
