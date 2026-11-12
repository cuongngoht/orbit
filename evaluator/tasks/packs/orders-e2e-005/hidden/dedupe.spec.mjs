import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createOrder } from "../src/orders.mjs";
import { consume } from "../src/worker.mjs";
import { openStore } from "../src/store.mjs";

function fresh(t) {
  const dir = mkdtempSync(join(tmpdir(), "orders-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return openStore(dir);
}

test("a payment delivered twice writes one invoice", (t) => {
  const store = fresh(t);
  const message = { id: "m-1", type: "order.paid", orderId: createOrder(store, { lines: [{ qty: 1, unitMinor: 900 }] }).id };
  assert.deepEqual([consume(store, message).ack, consume(store, message).ack], [true, true]);
  assert.equal(store.list("invoices").length, 1);
});
