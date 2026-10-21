// The support matrix is COMPUTED (doc §5.10; ADR 0035): from an adapter's declaration and the
// conformance receipts for THAT version, fingerprint and code, on a real system. An emulator, another
// fingerprint, other code or a failed scenario never makes anything supported, and an operation
// nothing exercised is unknown -- never read as supported.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fingerprintOf } from "../src/adapters/dispatch.mjs";
import { SUPPORT, supportMatrix } from "../src/adapters/matrix.mjs";
import { codeDigestOf, readReceipts } from "../src/adapters/receipts.mjs";
import { realIo } from "../src/store/io.mjs";

const adapter = (over = {}) => ({ id: "example.mq", version: "1.0.0", family: "messaging", transports: ["example-mq"], operations: { publish: {}, observe: {}, "observe.await": {} }, helper: { argv: ["mq/helper.mjs"] }, ...over });
const receipt = (a, results, over = {}) => ({ kit: "messaging", adapter: { id: a.id, version: a.version, fingerprint: fingerprintOf(a), code: "c".repeat(64), ...over.adapter }, system: { image: "example@sha256:abc", emulated: false, ...over.system }, results });
const level = (rows, op) => rows.find((r) => r.op === op).level;

test("the rows are ordered and the last always answers", () => {
  assert.deepEqual(SUPPORT.map((r) => r.id), ["CONTRACT_ONLY", "FAILED", "REAL", "EMULATED", "UNEXERCISED"]);
  assert.equal(SUPPORT.at(-1).when(adapter(), []), true);
});

test("a pass on a real system supports exactly the operations its scenarios exercised", () => {
  const a = adapter();
  const rows = supportMatrix([a], [receipt(a, [{ id: "publish-confirmed", ops: ["publish"], outcome: "passed" }])]);
  assert.deepEqual([level(rows, "publish"), level(rows, "observe"), level(rows, "observe.await")], ["supported", "unknown", "unknown"]);
});

test("another fingerprint, another version or other code counts for nothing", () => {
  const a = adapter();
  const pass = [{ id: "s", ops: ["publish"], outcome: "passed" }];
  const old = receipt(a, pass, { adapter: { fingerprint: "0".repeat(64) } });
  const rows = supportMatrix([a], [old]);
  assert.equal(level(rows, "publish"), "unknown");
  assert.match(rows.find((r) => r.op === "publish").why, /another version or fingerprint/);
  assert.equal(level(supportMatrix([a], [receipt(a, pass, { adapter: { version: "0.9.0" } })]), "publish"), "unknown");
  assert.equal(level(supportMatrix([a], [receipt(a, pass)], { codeOf: () => "d".repeat(64) }), "publish"), "unknown", "the helper's code moved since the receipt");
  assert.equal(level(supportMatrix([a], [receipt(a, pass)], { codeOf: () => "c".repeat(64) }), "publish"), "supported");
});

test("an emulator is partial at best, a failure is unsupported, and a contract-only family is never supported", () => {
  const a = adapter();
  assert.equal(level(supportMatrix([a], [receipt(a, [{ id: "s", ops: ["publish"], outcome: "passed" }], { system: { emulated: true } })]), "publish"), "partial");
  assert.equal(level(supportMatrix([a], [receipt(a, [{ id: "ok", ops: ["publish"], outcome: "passed" }, { id: "bad", ops: ["publish"], outcome: "failed" }])]), "publish"), "unsupported");
  const rpc = adapter({ id: "example.rpc", family: "rpc", operations: { call: {} } });
  assert.equal(level(supportMatrix([rpc], [receipt(rpc, [{ id: "s", ops: ["call"], outcome: "passed" }])]), "call"), "unsupported");
  assert.equal(level(supportMatrix([a], [receipt(a, [{ id: "n", ops: ["publish"], outcome: "not-applicable" }])]), "publish"), "unknown", "a scenario that did not apply proves nothing");
});

test("receipts are read from schema-1 files only, and a helper's code digest is its files' by path and content", () => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-receipts-"));
  writeFileSync(join(dir, "good.json"), JSON.stringify({ schema: 1, receipts: [{ kit: "messaging" }] }));
  writeFileSync(join(dir, "old.json"), JSON.stringify({ schema: 0, receipts: [{ kit: "x" }] }));
  writeFileSync(join(dir, "torn.json"), "{");
  assert.deepEqual(readReceipts(["good.json", "old.json", "torn.json", "missing.json"].map((f) => join(dir, f)), realIo()), [{ kit: "messaging" }]);
  mkdirSync(join(dir, "code", "sub"), { recursive: true });
  writeFileSync(join(dir, "code", "a.mjs"), "a");
  writeFileSync(join(dir, "code", "sub", "b.mjs"), "b");
  const before = codeDigestOf(join(dir, "code"), realIo());
  writeFileSync(join(dir, "code", "sub", "b.mjs"), "b2");
  assert.notEqual(codeDigestOf(join(dir, "code"), realIo()), before);
  rmSync(dir, { recursive: true, force: true });
});
