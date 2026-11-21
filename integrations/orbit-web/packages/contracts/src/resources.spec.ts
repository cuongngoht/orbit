// WHAT AN EMPLOYEE MAY USE, as the API holds every request body to it: a resource profile within its bounds, an
// account's per-employee ceiling, and a change of the account's budget.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ceilingProblems, checkResourceProfile, checkUpdateBudget, DEFAULT_PRESETS, RESOURCE_BOUNDS, type PerEmployeeCeiling, type ResourceProfile } from "./resources.js";
import type { Checked } from "./validate.js";

const errorsOf = <T>(c: Checked<T>): string[] => (c.ok ? [] : c.errors);
const LIGHT = (DEFAULT_PRESETS[0] as { profile: ResourceProfile }).profile;

test("every preset is a valid profile, and the presets are suggestions of growing size", () => {
  assert.deepEqual(DEFAULT_PRESETS.map((p) => p.id), ["lightweight", "research", "developer", "build-test"]);
  for (const p of DEFAULT_PRESETS) {
    assert.deepEqual(checkResourceProfile(p.profile), { ok: true, value: p.profile }, p.id);
    assert.equal(p.profile.presetId, p.id);
  }
});

test("a resource profile: every limit a whole number within its bounds, a preset's id or none, nothing else", () => {
  const { presetId: _preset, ...custom } = LIGHT;
  assert.deepEqual(checkResourceProfile(custom), { ok: true, value: { ...custom, presetId: null } }, "custom values name no preset");
  assert.deepEqual(checkResourceProfile({ ...LIGHT, presetId: null }), { ok: true, value: { ...LIGHT, presetId: null } });
  for (const [key, b] of Object.entries(RESOURCE_BOUNDS)) {
    assert.equal(checkResourceProfile({ ...LIGHT, [key]: b.min }).ok, true, `${key} at its minimum`);
    assert.equal(checkResourceProfile({ ...LIGHT, [key]: b.max }).ok, true, `${key} at its maximum`);
    for (const bad of [b.min - 1, b.max + 1, b.min + 0.5, String(b.min), null, undefined]) {
      assert.deepEqual(errorsOf(checkResourceProfile({ ...LIGHT, [key]: bad })), [`resources.${key} must be a whole number from ${b.min} to ${b.max}`], `${key} = ${String(bad)}`);
    }
  }
  assert.deepEqual(errorsOf(checkResourceProfile({ ...LIGHT, presetId: "Big One" })), ["resources.presetId must be a preset's id or null"]);
  assert.deepEqual(errorsOf(checkResourceProfile({ ...LIGHT, gpus: 1 })), ["resources.gpus is not a field of this request"]);
  assert.deepEqual(checkResourceProfile("lightweight"), { ok: false, errors: ["resources must be an object"] });
});

test("a profile is held to the account's per-employee ceiling: equal is within it, each excess named", () => {
  const developer = (DEFAULT_PRESETS[2] as { profile: ResourceProfile }).profile;
  const ceiling: PerEmployeeCeiling = { cpuMillis: 2000, memoryMiB: 4096, deskStorageMiB: 20480, scratchStorageMiB: 10240, cacheStorageMiB: 5120 };
  assert.deepEqual(ceilingProblems(developer, ceiling), []);
  assert.deepEqual(ceilingProblems(developer, { cpuMillis: 1000, memoryMiB: 2048, deskStorageMiB: 10240, scratchStorageMiB: 5120, cacheStorageMiB: 1024 }), [
    "CPU 2 vCPU is above the per-employee limit of 1 vCPU",
    "memory 4096 MiB is above the per-employee limit of 2048 MiB",
    "desk storage 20480 MiB is above the per-employee limit of 10240 MiB",
    "scratch storage 10240 MiB is above the per-employee limit of 5120 MiB",
    "cache 5120 MiB is above the per-employee limit of 1024 MiB",
  ]);
  assert.deepEqual(ceilingProblems({ ...developer, cpuMillis: 2500 }, ceiling), ["CPU 2.5 vCPU is above the per-employee limit of 2 vCPU"]);
});

test("a change of the budget names what changes: whole numbers, never below zero, known per-employee limits", () => {
  assert.deepEqual(checkUpdateBudget({ cpuMillis: 8000, maxConcurrent: 0, perEmployee: { memoryMiB: 4096 } }), { ok: true, value: { cpuMillis: 8000, maxConcurrent: 0, perEmployee: { memoryMiB: 4096 } } });
  assert.deepEqual(errorsOf(checkUpdateBudget({})), ["nothing to change"]);
  assert.deepEqual(errorsOf(checkUpdateBudget({ cpuMillis: -1, memoryMiB: 1.5, storageMiB: "10", maxConcurrent: null, authorized: {} })), [
    "authorized is not a field of this request",
    "cpuMillis must be a whole number of at least 0",
    "memoryMiB must be a whole number of at least 0",
    "storageMiB must be a whole number of at least 0",
    "maxConcurrent must be a whole number of at least 0",
  ]);
  assert.deepEqual(errorsOf(checkUpdateBudget({ perEmployee: { gpus: 1, cpuMillis: -5 } })), ["perEmployee.gpus must be a known limit and a whole number", "perEmployee.cpuMillis must be a known limit and a whole number"]);
  assert.deepEqual(errorsOf(checkUpdateBudget({ perEmployee: [] })), ["perEmployee must be an object"]);
  assert.deepEqual(checkUpdateBudget("all"), { ok: false, errors: ["the body must be a JSON object"] });
});
