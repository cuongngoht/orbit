// ORBIT-ORC-006: an id never moves a failure signature. Two runs of one failure whose failing lines differ only in
// the UUIDs they print sign the same -- wherever the UUID stands, in either case, one or several to a line -- and a
// different failure still signs differently.
import assert from "node:assert/strict";
import { test } from "node:test";
import { signatureOf } from "../src/orchestration/failure.mjs";

const run = (...lines) => ({ purpose: "test", command: "npm test", status: 1, lines });

test("two runs of one failure that print different UUIDs sign the same", () => {
  const a = run("not ok 1 - order 3f2b8c1e-9d4a-4e6f-8b2a-1c3d5e7f9a0b was not settled", "error: tenant={7A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9} refused");
  const b = run("not ok 1 - order 0a1b2c3d-4e5f-4a6b-9c8d-7e6f5a4b3c2d was not settled", "error: tenant={11111111-2222-3333-4444-555555555555} refused");
  assert.equal(signatureOf(a), signatureOf(b));
  const c = run("3f2b8c1e-9d4a-4e6f-8b2a-1c3d5e7f9a0b 9e8d7c6b-5a49-4382-a1b0-c9d8e7f6a5b4 failed");
  const d = run("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee 12345678-1234-1234-1234-123456789abc failed");
  assert.equal(signatureOf(c), signatureOf(d), "several to a line, at the start of it");
});

test("a different failure still signs differently, whatever ids it prints", () => {
  const a = run("not ok 1 - order 3f2b8c1e-9d4a-4e6f-8b2a-1c3d5e7f9a0b was not settled");
  const b = run("not ok 2 - refund 3f2b8c1e-9d4a-4e6f-8b2a-1c3d5e7f9a0b was not issued");
  assert.notEqual(signatureOf(a), signatureOf(b));
});
