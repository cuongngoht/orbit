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

const made = (store) => handle(store, { method: "POST", path: "/orders", body: { lines: [{ qty: 1, unitMinor: 700 }] } }).body.id;

test("an open order can be cancelled, and a cancelled order is never shipped", (t) => {
  const store = fresh(t);
  const id = made(store);
  assert.equal(handle(store, { method: "POST", path: `/orders/${id}/cancel` }).body.state, "cancelled");
  assert.equal(handle(store, { method: "POST", path: `/orders/${id}/ship` }).status, 409);
});

test("a shipped order cannot be cancelled", (t) => {
  const store = fresh(t);
  const id = made(store);
  handle(store, { method: "POST", path: `/orders/${id}/ship` });
  assert.equal(handle(store, { method: "POST", path: `/orders/${id}/cancel` }).status, 409);
});
