import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { handle } from "../src/api.mjs";
import { openStore } from "../src/store.mjs";

function fresh(t) {
  const dir = mkdtempSync(join(tmpdir(), "orders-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return openStore(dir);
}

const LINES = [{ qty: 2, unitMinor: 500 }];

test("an order is created open, read back, and shipped once", (t) => {
  const store = fresh(t);
  const made = handle(store, { method: "POST", path: "/orders", body: { customer: "Ada", lines: LINES } });
  assert.deepEqual([made.status, made.body.state, made.body.total], [201, "open", "$10.00"]);
  assert.equal(handle(store, { method: "POST", path: `/orders/${made.body.id}/ship` }).body.state, "shipped");
  assert.equal(handle(store, { method: "POST", path: `/orders/${made.body.id}/ship` }).status, 409);
});

test("an unknown order and an unknown route are 404, and an order with no lines is refused", (t) => {
  const store = fresh(t);
  assert.equal(handle(store, { method: "GET", path: "/orders/ord-0001" }).status, 404);
  assert.equal(handle(store, { method: "DELETE", path: "/orders" }).status, 404);
  assert.equal(handle(store, { method: "POST", path: "/orders", body: { lines: [] } }).status, 400);
});
