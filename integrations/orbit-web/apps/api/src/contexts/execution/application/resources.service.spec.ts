import assert from "node:assert/strict";
import { test } from "node:test";
import type { AccountResourceBudget, BudgetAuthorization } from "@orbit-web/contracts";
import { authorizationFrom, followAuthorization, sameLimits } from "./resources.service.js";

// The usable capacity of a 2-vCPU, 8 GiB host with a 10 GiB pool (what the first look made), and of the same host resized.
const small = authorizationFrom({ usable: { cpuMillis: 50, memoryMiB: 4047, storageMiB: 9158 } });
const large = authorizationFrom({ usable: { cpuMillis: 1850, memoryMiB: 11674, storageMiB: 18432 } });

const budgetAt = (a = small, over: Partial<AccountResourceBudget> = {}): AccountResourceBudget => ({
  cpuMillis: a.cpuMillis,
  memoryMiB: a.memoryMiB,
  storageMiB: a.storageMiB,
  maxConcurrent: a.maxConcurrent,
  perEmployee: { ...a.perEmployee },
  authorized: a,
  version: 1,
  updatedAt: "2026-11-22T01:00:00.000Z",
  ...over,
});

test("the capacity authorizes all of itself, and per employee half the storage for a desk and half for scratch", () => {
  assert.deepEqual(large, {
    cpuMillis: 1850,
    memoryMiB: 11674,
    storageMiB: 18432,
    maxConcurrent: 1,
    perEmployee: { cpuMillis: 1850, memoryMiB: 11674, deskStorageMiB: 9216, scratchStorageMiB: 9216, cacheStorageMiB: 4608 },
    source: "capacity",
  });
  assert.equal(small.perEmployee.deskStorageMiB, 4579, "the 10 GiB pool: a default desk of 5 GiB does not fit");
  assert.equal(authorizationFrom({ usable: { cpuMillis: 0, memoryMiB: 0, storageMiB: 0 } }).maxConcurrent, 1, "never below one attempt at a time");
});

test("a budget that stood at the old authorization follows the new one -- up when the host grew", () => {
  const after = followAuthorization(budgetAt(small), large);
  assert.deepEqual(after, { cpuMillis: 1850, memoryMiB: 11674, storageMiB: 18432, maxConcurrent: 1, perEmployee: large.perEmployee });
});

test("a value the owner lowered stays as the owner left it, and is never above the new authorization", () => {
  const lowered = budgetAt(large, { cpuMillis: 1000, perEmployee: { ...large.perEmployee, memoryMiB: 2048 } });
  const grown = authorizationFrom({ usable: { cpuMillis: 5600, memoryMiB: 26000, storageMiB: 18432 } });
  const up = followAuthorization(lowered, grown);
  assert.equal(up.cpuMillis, 1000, "the owner's lower CPU budget stays");
  assert.equal(up.perEmployee.memoryMiB, 2048, "the owner's lower per-employee memory stays");
  assert.equal(up.memoryMiB, 26000, "what stood at the authorization follows it");
  const down = followAuthorization(lowered, small);
  assert.equal(down.cpuMillis, 50, "a lowered value above a smaller authorization comes down to it");
  assert.equal(down.perEmployee.memoryMiB, 2048, "one already below it stays");
});

test("two authorizations allowing the same are the same, wherever each came from", () => {
  const operators: BudgetAuthorization = { ...large, source: "operator" };
  assert.equal(sameLimits(large, operators), true);
  assert.equal(sameLimits(large, small), false);
  assert.equal(sameLimits(large, { ...large, perEmployee: { ...large.perEmployee, cacheStorageMiB: 1 } }), false);
});
