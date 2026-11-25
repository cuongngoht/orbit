import assert from "node:assert/strict";
import { test } from "node:test";
import { RUNTIME_KINDS, type AccountResourceBudget, type BudgetAuthorization } from "@orbit-web/contracts";
import type { AppConfig } from "../../../config/config.js";
import { loadSandboxConfig, MODEL_PLANE_DEFAULTS } from "../../../config/sandbox-config.js";
import type { Db } from "../../../infra/db/db.js";
import { authorizationFrom, followAuthorization, ResourcesService, sameLimits } from "./resources.service.js";

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
  assert.equal(small.perEmployee.deskStorageMiB, 4579, "the 10 GiB pool: a desk of at most half of it");
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

// The service on its own: no provider (this process's host is measured), a database that keeps nothing.
const service = (env: Record<string, string>): ResourcesService => new ResourcesService({ sourceEnv: env, data: { root: "/nonexistent" } } as unknown as AppConfig, { query: () => Promise.resolve([]), one: () => Promise.resolve(null) } as unknown as Db, null);

test("a model plane's size has ONE reading: what admission counts is what the container is given, in the documented units", () => {
  const env = { ORBIT_WEB_MODEL_PLANE_CLAUDE_MEMORY: "2g", ORBIT_WEB_MODEL_PLANE_CLAUDE_CPU: "0.5", ORBIT_WEB_MODEL_PLANE_CODEX_MEMORY: "768m", ORBIT_WEB_MODEL_PLANE_AGY_CPU: "250m" };
  const s = service(env);
  assert.deepEqual(s.modelPlane("claude"), { cpuMillis: 500, memoryMiB: 2048 }, "2g is 2048 MiB, and 0.5 is half a vCPU -- never ignored, never 0");
  assert.deepEqual([s.modelPlane("codex").memoryMiB, s.modelPlane("agy").cpuMillis], [768, 250]);
  const sandbox = loadSandboxConfig(env);
  for (const runtime of RUNTIME_KINDS) assert.deepEqual(s.modelPlane(runtime), sandbox.modelPlane[runtime], runtime);
  assert.deepEqual(service({}).modelPlane("codex"), MODEL_PLANE_DEFAULTS.codex, "one table of starting values");
  assert.deepEqual(service({}).modelPlane("a runtime nobody named"), MODEL_PLANE_DEFAULTS.claude);
});

test("measured on this process's own host, the capacity settings are read in their units too, and a reserve not named keeps its default", async () => {
  const c = await service({ ORBIT_WEB_CAPACITY_CPU: "4", ORBIT_WEB_CAPACITY_MEMORY: "8g", ORBIT_WEB_CAPACITY_STORAGE: "20g", ORBIT_WEB_CAPACITY_RESERVE_CPU: "500m", ORBIT_WEB_CAPACITY_RESERVE_MEMORY: "10%" }).refreshCapacity();
  assert.equal(c.source, "configured");
  assert.deepEqual(c.total, { cpuMillis: 4000, memoryMiB: 8192, storageMiB: 20480 }, "4 is four vCPUs, 8g is 8192 MiB");
  assert.deepEqual([c.headroom.cpuMillis, c.headroom.memoryMiB, c.headroom.storageMiB], [500, 820, 10 * 1024]);
  assert.deepEqual(c.usable, { cpuMillis: 3500, memoryMiB: 7372, storageMiB: 10240 });
});
