import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { handle } from "../src/api.mjs";
import { openStore } from "../src/store.mjs";
import { renderOrder } from "../src/ui.mjs";

function fresh(t) {
  const dir = mkdtempSync(join(tmpdir(), "orders-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return openStore(dir);
}

test("an order keeps the note it was created with, and draws it escaped", (t) => {
  const store = fresh(t);
  const id = handle(store, { method: "POST", path: "/orders", body: { lines: [{ qty: 1, unitMinor: 100 }], note: "leave at <door>" } }).body.id;
  const order = handle(store, { method: "GET", path: `/orders/${id}` }).body;
  assert.equal(order.note, "leave at <door>");
  assert.match(renderOrder(order), /<p class="note">leave at &lt;door&gt;<\/p>/);
});
