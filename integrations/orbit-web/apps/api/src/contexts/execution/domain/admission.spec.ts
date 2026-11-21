import assert from "node:assert/strict";
import { test } from "node:test";
import { agedPriority, decideAdmissions, type AccountState, type Candidate, type HostState, type Verdict } from "./admission.js";

const NOW = Date.parse("2026-11-21T12:00:00Z");
const ago = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString();
const policy = { now: NOW, agingMinutes: 30, guardMinutes: 60 };

const account = (o: Partial<AccountState> = {}): AccountState => ({ cpuMillis: 4000, memoryMiB: 8192, storageMiB: 100_000, maxConcurrent: 4, reservedCpu: 0, reservedMemory: 0, running: 0, committedStorage: 0, ...o });
const host = (o: Partial<HostState> = {}): HostState => ({ usableCpu: 8000, usableMemory: 16_384, reservedCpu: 0, reservedMemory: 0, ...o });
const codeOf = (v: Verdict | undefined): string | null => (v === undefined || v.kind === "admit" ? null : v.code);
const reasonOf = (v: Verdict | undefined): string => (v === undefined || v.kind === "admit" ? "" : v.reason);
const want = (runId: string, orbitId: string, cpuMillis: number, memoryMiB: number, waitedMinutes = 1, priority = 5): Candidate => ({ runId, orbitId, priority, waitingSince: ago(waitedMinutes), demand: { cpuMillis, memoryMiB, scratchMiB: 0 } });

test("an attempt above the account's budget can never start as configured, and says so with the numbers", () => {
  const [v] = decideAdmissions([want("r1", "A", 1000, 8192)], new Map([["A", account({ memoryMiB: 6144 })]]), host(), policy);
  assert.equal(v?.kind, "unschedulable");
  assert.equal(codeOf(v), "above_budget_memory");
  assert.match(reasonOf(v), /8192 MiB.*6144 MiB/);
});

test("an attempt above the host's usable capacity can never start either (whatever the account's budget)", () => {
  const [v] = decideAdmissions([want("r1", "A", 6000, 1024)], new Map([["A", account({ cpuMillis: 16_000 })]]), host({ usableCpu: 4000 }), policy);
  assert.ok(v?.kind === "unschedulable" && v.code === "above_capacity_cpu");
});

test("an attempt that fits as configured but not now waits, with the reason -- nothing fails", () => {
  const [v] = decideAdmissions([want("r1", "A", 1000, 4096)], new Map([["A", account({ reservedMemory: 6144, running: 1 })]]), host(), policy);
  assert.ok(v?.kind === "wait" && v.code === "budget_memory");
  const [c] = decideAdmissions([want("r2", "A", 500, 512)], new Map([["A", account({ maxConcurrent: 1, running: 1 })]]), host(), policy);
  assert.ok(c?.kind === "wait" && c.code === "concurrency");
});

test("what is admitted is counted at once: the last capacity goes to exactly one attempt", () => {
  const verdicts = decideAdmissions([want("r1", "A", 2000, 1024), want("r2", "A", 2000, 1024)], new Map([["A", account()]]), host({ usableCpu: 3000 }), policy);
  assert.deepEqual(verdicts.map((v) => v.kind), ["admit", "wait"]);
  assert.ok(verdicts[1]?.kind === "wait" && verdicts[1].code === "host_cpu");
});

test("across accounts the less-served one goes first (dominant-resource fairness)", () => {
  const accounts = new Map([
    ["busy", account({ reservedCpu: 2000, running: 1 })],
    ["quiet", account()],
  ]);
  const verdicts = decideAdmissions([want("b1", "busy", 1000, 512, 30), want("q1", "quiet", 1000, 512, 1)], accounts, host({ usableCpu: 4000, reservedCpu: 2000 }), policy);
  assert.equal(verdicts[0]?.runId, "q1");
  assert.equal(verdicts[0]?.kind, "admit");
  assert.ok(verdicts[1]?.runId === "b1" && verdicts[1].kind === "admit");
});

test("within an account an older attempt's priority grows with its wait (aging)", () => {
  const old = want("old", "A", 1000, 512, 120, 3);
  const fresh = want("fresh", "A", 1000, 512, 0, 5);
  assert.equal(agedPriority(old, policy), 7);
  assert.equal(agedPriority(fresh, policy), 5);
  const verdicts = decideAdmissions([fresh, old], new Map([["A", account({ maxConcurrent: 1 })]]), host(), policy);
  assert.equal(verdicts[0]?.runId, "old");
  assert.equal(verdicts[0]?.kind, "admit");
});

test("a smaller attempt may pass a larger one that does not fit -- until the larger has waited past the guard", () => {
  const big = (waited: number) => want("big", "A", 3000, 1024, waited, 9);
  const small = want("small", "A", 500, 256, 0, 1);
  const before = decideAdmissions([big(10), small], new Map([["A", account()]]), host({ usableCpu: 4000, reservedCpu: 2000 }), policy);
  assert.deepEqual(before.map((v) => `${v.runId}:${v.kind}`), ["big:wait", "small:admit"]);
  const after = decideAdmissions([big(90), small], new Map([["A", account()]]), host({ usableCpu: 4000, reservedCpu: 2000 }), policy);
  assert.deepEqual(after.map((v) => `${v.runId}:${v.kind}`), ["big:wait", "small:wait"]);
  assert.ok(after[1]?.kind === "wait" && after[1].code === "held_for_older");
});

test("a budget lowered below what runs now refuses nothing that runs: new attempts wait", () => {
  const lowered = account({ cpuMillis: 1000, reservedCpu: 3000, running: 3 });
  const [v] = decideAdmissions([want("r1", "A", 500, 256)], new Map([["A", lowered]]), host(), policy);
  assert.ok(v?.kind === "wait" && v.code === "budget_cpu");
});
