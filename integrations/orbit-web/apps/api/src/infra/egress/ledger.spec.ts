// WHAT ONE RUN MAY USE OF THE PROXY: open connections (the installation's cap, always; the policy's when it names one),
// connections a minute, downloads per run and per account and UTC day, and a bandwidth its connections share.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_MAX_CONNECTIONS_PER_RUN, EgressLedger, TokenBucket, type Admission, type LedgerRun, type Meter } from "./ledger.js";

const clock = (start = Date.parse("2026-11-21T10:00:00.000Z")) => {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
};
const run = (limits: LedgerRun["limits"], id = "run-1", accountId = "acc-1"): LedgerRun => ({ id, accountId, limits });
const meterOf = (a: Admission): Meter => {
  assert.equal(a.ok, true, a.ok ? "" : a.reason);
  return (a as { ok: true; meter: Meter }).meter;
};
const refusalOf = (a: Admission): string => {
  assert.equal(a.ok, false);
  return (a as { ok: false; reason: string }).reason;
};

test("a token bucket lets one second's worth through at once, then makes whoever asks wait behind what was taken", () => {
  const c = clock();
  const b = new TokenBucket(1000, c.now);
  assert.deepEqual([b.take(600), b.take(400)], [0, 0]);
  assert.equal(b.take(500), 500, "half a second for 500 bytes at 1000 a second");
  assert.equal(b.take(500), 1000, "the next one waits behind it");
  c.advance(1000);
  assert.equal(b.take(0), 0, "a second later the debt is paid");
  c.advance(10_000);
  assert.equal(b.take(1000), 0);
  assert.equal(b.take(1), 1, "never more than a second's worth is saved up");
  b.setRate(10);
  c.advance(100);
  assert.equal(b.take(10), 1000, "a new rate applies from now on: the byte owed is paid in 100 ms, ten more take a second");
});

test("the installation's cap holds every run, the policy's only narrows it, and a released connection frees its place", () => {
  const ledger = new EgressLedger({ maxConnectionsPerRun: 2, now: clock().now });
  const a = meterOf(ledger.admit(run(null)));
  meterOf(ledger.admit(run(null)));
  assert.match(refusalOf(ledger.admit(run(null))), /holds 2 connections open: the installation allows at most 2 at once/);
  assert.equal(ledger.admit(run(null, "run-2")).ok, true, "another run has places of its own");
  a.release();
  a.release();
  assert.equal(ledger.admit(run(null)).ok, true, "a place given back once, however often it is said");
  assert.match(refusalOf(ledger.admit(run({ concurrentConnectionsPerRun: 5 }))), /the installation allows at most 2/, "a policy never widens the installation's cap");
  const strict = new EgressLedger({ maxConnectionsPerRun: 256, now: clock().now });
  meterOf(strict.admit(run({ concurrentConnectionsPerRun: 1 })));
  assert.match(refusalOf(strict.admit(run({ concurrentConnectionsPerRun: 1 }))), /its account's policy allows at most 1 at once/);
  assert.equal(strict.admit(run(null)).ok, true, "a connection decided under a revision without the limit is not held to it");
  assert.equal(DEFAULT_MAX_CONNECTIONS_PER_RUN, 256);
});

test("connections a minute: counted over the last sixty seconds", () => {
  const c = clock();
  const ledger = new EgressLedger({ maxConnectionsPerRun: 256, now: c.now });
  const limits = { connectionsPerMinutePerRun: 2 };
  meterOf(ledger.admit(run(limits))).release();
  c.advance(30_000);
  meterOf(ledger.admit(run(limits))).release();
  assert.match(refusalOf(ledger.admit(run(limits))), /opened 2 connections in the last minute: its account's policy allows 2 a minute/);
  c.advance(30_001);
  assert.equal(ledger.admit(run(limits)).ok, true, "the first one is more than a minute old now");
});

test("downloads: a run's bytes and the account's day are cut exactly at the limit, and the next connection is refused", () => {
  const c = clock();
  const ledger = new EgressLedger({ maxConnectionsPerRun: 256, now: c.now });
  const m = meterOf(ledger.admit(run({ downloadBytesPerRun: 1000 })));
  assert.deepEqual(m.down(600), { pass: 600, cut: null });
  const cut = m.down(600);
  assert.equal(cut.pass, 400);
  assert.match(cut.cut ?? "", /this run reached 1000 downloaded bytes/);
  m.up(42);
  assert.deepEqual([m.bytesIn, m.bytesOut], [1000, 42]);
  assert.match(refusalOf(ledger.admit(run({ downloadBytesPerRun: 1000 }))), /this run has downloaded 1000 bytes/);
  assert.equal(ledger.admit(run({ downloadBytesPerRun: 1000 }, "run-2")).ok, true, "another run has its own");

  const day = { downloadBytesPerDay: 1500 };
  const first = meterOf(ledger.admit(run(day, "run-3", "acc-2")));
  assert.deepEqual(first.down(1000), { pass: 1000, cut: null });
  const second = meterOf(ledger.admit(run(day, "run-4", "acc-2")));
  const over = second.down(1000);
  assert.equal(over.pass, 500);
  assert.match(over.cut ?? "", /this account's employees reached 1500 downloaded bytes today \(UTC\)/);
  assert.match(refusalOf(ledger.admit(run(day, "run-5", "acc-2"))), /downloaded 1500 bytes today \(UTC\): its policy allows 1500 bytes a day/);
  c.advance(24 * 60 * 60 * 1000);
  assert.equal(ledger.admit(run(day, "run-5", "acc-2")).ok, true, "a new UTC day starts from nothing");
});

test("an account's day is read back once from what was recorded, so a restart does not give it the day again", async () => {
  const ledger = new EgressLedger({ maxConnectionsPerRun: 256, now: clock().now });
  const reads: string[] = [];
  const read = async (since: string) => {
    reads.push(since);
    return 1200;
  };
  await Promise.all([ledger.seed("acc-1", read), ledger.seed("acc-1", read)]);
  await ledger.seed("acc-1", read);
  assert.deepEqual(reads, ["2026-11-21T00:00:00.000Z"], "read once, from the start of the UTC day");
  const m = meterOf(ledger.admit(run({ downloadBytesPerDay: 1500 })));
  assert.equal(m.down(1000).pass, 300);
  const failing = new EgressLedger({ maxConnectionsPerRun: 256, now: clock().now });
  await failing.seed("acc-1", () => Promise.reject(new Error("down")));
  let asked = 0;
  await failing.seed("acc-1", async () => ((asked += 1), 0));
  assert.equal(asked, 1, "a read that failed is asked again");
});

test("a bandwidth limit is the run's, shared by its connections; without one nothing waits", () => {
  const c = clock();
  const ledger = new EgressLedger({ maxConnectionsPerRun: 256, now: c.now });
  const limits = { bandwidthMbpsPerRun: 1 };
  const a = meterOf(ledger.admit(run(limits)));
  const b = meterOf(ledger.admit(run(limits)));
  assert.equal(a.delay(125_000), 0, "one second's worth at once");
  assert.equal(b.delay(125_000), 1000, "the other connection of the run waits behind it");
  const free = meterOf(ledger.admit(run(null, "run-2")));
  assert.equal(free.delay(10_000_000), 0);
  const unlimited = meterOf(ledger.admit(run(null)));
  assert.equal(unlimited.delay(10_000_000), 0, "a connection decided without the limit is not throttled");
});
