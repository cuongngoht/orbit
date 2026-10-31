import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { consume } from "../src/worker.mjs";
import { openStore } from "../src/store.mjs";

function fresh(t) {
  const dir = mkdtempSync(join(tmpdir(), "orders-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return openStore(dir);
}

test("a message that is not a payment is acknowledged and skipped", (t) => {
  assert.deepEqual(consume(fresh(t), { id: "m-1", type: "order.shipped", orderId: "ord-0001" }), { ack: true, skipped: "not a payment" });
});

test("a payment for an order nobody has is not acknowledged, so it is delivered again", (t) => {
  assert.equal(consume(fresh(t), { id: "m-1", type: "order.paid", orderId: "ord-0009" }).ack, false);
});
