#!/usr/bin/env node
// The application's pure logic, checked with no container, no database and no broker:
// the cron arithmetic and its zones, the schedule's identities, the scheduler's fire-once and
// deadline classification, the worker's payload rule, and the SQL literal every value passes.
//
//   node acceptance/projects/_shared/selfcheck.mjs
//
// (Deliberately not a *.test.mjs: Node's default test globs would pull it into the engine's suite.)
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { isoAt, nextAfter, occurrencesBetween, parseCron } from "./app/cron.mjs";
import { lit, raw, sql } from "./app/db.mjs";
import { businessKeyOf, loadSchedule, messageIdOf, occurrenceFromId, occurrenceIdOf } from "./app/schedule.mjs";

const schedule = loadSchedule(fileURLToPath(new URL("./contracts/schedule.json", import.meta.url)));
const at = (iso) => Date.parse(iso);
const isoList = (list, zone) => list.map((t) => isoAt(t, zone));
const checks = [];
const check = (name, fn) => checks.push([name, fn]);

check("the pinned period is the one occurrence in (08:00, 09:00] and none in (08:00, 08:59:59]", () => {
  assert.deepEqual(isoList(occurrencesBetween(schedule.spec, schedule.zone, at("2026-10-22T08:00:00+07:00"), at("2026-10-22T09:00:00+07:00")), schedule.zone), ["2026-10-22T09:00:00+07:00"]);
  assert.deepEqual(occurrencesBetween(schedule.spec, schedule.zone, at("2026-10-22T08:00:00+07:00"), at("2026-10-22T08:59:59+07:00")), []);
  assert.equal(isoAt(nextAfter(schedule.spec, schedule.zone, at("2026-10-22T09:00:00+07:00")), schedule.zone), "2026-10-23T09:00:00+07:00");
});

check("an occurrence id is canonical and real, or it is refused", () => {
  assert.equal(occurrenceIdOf(schedule, at("2026-10-22T02:00:00Z")), "billing-daily:2026-10-22T09:00:00+07:00");
  assert.equal(occurrenceFromId(schedule, "billing-daily:2026-10-22T09:00:00+07:00").ms, at("2026-10-22T02:00:00Z"));
  for (const bad of ["billing-daily:2026-10-22T02:00:00Z", "billing-daily:2026-10-22T09:30:00+07:00", "other:2026-10-22T09:00:00+07:00", 42]) assert.equal(occurrenceFromId(schedule, bad).error, "not-an-occurrence");
});

check("the business key and the message id never change for one period", () => {
  const bk = businessKeyOf("tenant-a", "inv-a", "billing-daily:2026-10-22T09:00:00+07:00");
  assert.equal(bk, "tenant-a|inv-a|billing-daily:2026-10-22T09:00:00+07:00");
  assert.equal(messageIdOf(bk), messageIdOf(`${bk}`));
  assert.match(messageIdOf(bk), /^msg-[0-9a-f]{32}$/);
});

check("a DST gap skips a wall time, and an overlap fires it once, at the earlier instant", () => {
  const gap = occurrencesBetween(parseCron("30 2 * * *"), "America/New_York", at("2026-03-07T12:00:00Z"), at("2026-03-10T12:00:00Z"));
  assert.deepEqual(isoList(gap, "America/New_York"), ["2026-03-09T02:30:00-04:00", "2026-03-10T02:30:00-04:00"]);
  const overlap = occurrencesBetween(parseCron("30 1 * * *"), "America/New_York", at("2026-10-31T12:00:00Z"), at("2026-11-02T12:00:00Z"));
  assert.deepEqual(isoList(overlap, "America/New_York"), ["2026-11-01T01:30:00-04:00", "2026-11-02T01:30:00-05:00"]);
});

check("cron fields: steps, ranges, lists, and a restricted day of month OR a restricted weekday", () => {
  assert.equal(occurrencesBetween(parseCron("*/15 9-10 * * 1-5"), "UTC", at("2026-10-23T00:00:00Z"), at("2026-10-26T23:59:00Z")).length, 16);
  const days = occurrencesBetween(parseCron("0 0 1 * 1"), "UTC", at("2026-10-31T00:00:00Z"), at("2026-11-10T00:00:00Z")).map((t) => new Date(t).toISOString().slice(0, 10));
  assert.deepEqual(days, ["2026-11-01", "2026-11-02", "2026-11-09"]);
  assert.throws(() => parseCron("0 9 * *"), /five fields/);
  assert.throws(() => parseCron("61 9 * * *"), /outside/);
});

check("fire-once: the latest occurrence within its deadline runs, earlier ones are coalesced, late ones missed", async () => {
  const { classify } = await import("./app/scheduler.mjs");
  const d1 = at("2026-10-22T09:00:00+07:00");
  const d2 = at("2026-10-23T09:00:00+07:00");
  assert.deepEqual(classify(schedule, [d1], d1).map((d) => d.fire ?? d.decision), [true]);
  assert.deepEqual(classify(schedule, [d1, d2], d2 + 60000).map((d) => [d.decision ?? "fire", d.reason ?? null]), [["missed", "deadline"], ["fire", null]]);
  assert.deepEqual(classify(schedule, [d1, d1 + 60000], d1 + 90000).map((d) => [d.decision ?? "fire", d.reason ?? null]), [["missed", "coalesced"], ["fire", null]]);
  assert.deepEqual(classify(schedule, [d1], d1 + schedule.deadlineMs + 1000).map((d) => d.reason), ["deadline"]);
});

check("the worker's payload rule is the contract's ReminderRequested", async () => {
  const { validated } = await import("./app/worker.mjs");
  const occ = "billing-daily:2026-10-22T09:00:00+07:00";
  const ok = { messageId: `msg-${"a".repeat(32)}`, invoiceId: "inv-a", tenantId: "tenant-a", occurrenceId: occ, businessKey: `tenant-a|inv-a|${occ}` };
  assert.deepEqual(validated(Buffer.from(JSON.stringify(ok)), "billing-daily"), ok);
  for (const bad of ["{not json", "[]", JSON.stringify({ ...ok, extra: 1 }), JSON.stringify({ ...ok, businessKey: "tenant-b|inv-a|x" }), JSON.stringify({ ...ok, messageId: "m1" }), JSON.stringify({ ...ok, occurrenceId: "other:x", businessKey: "tenant-a|inv-a|other:x" })]) assert.equal(validated(Buffer.from(bad), "billing-daily"), null, bad);
});

check("every value reaches SQL as a literal", () => {
  assert.equal(sql`SELECT ${"it's"}, ${null}, ${true}, ${12.5}, ${{ a: "b'c" }}, ${raw("now()")}`, "SELECT 'it''s', NULL, TRUE, 12.5, '{\"a\":\"b''c\"}'::jsonb, now()");
  assert.throws(() => lit("a\u0000b"), /NUL/);
  assert.throws(() => lit(Number.NaN), /finite/);
});

let failed = 0;
for (const [name, fn] of checks) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`FAIL  ${name}\n      ${e.message.split("\n").join("\n      ")}`);
  }
}
console.log(`${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
