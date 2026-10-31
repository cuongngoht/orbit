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

const order = (store, currency) => handle(store, { method: "POST", path: "/orders", body: { lines: [{ qty: 1, unitMinor: 1234 }], currency } });

test("an order keeps its currency, and its total is formatted in it", (t) => {
  const store = fresh(t);
  assert.deepEqual([order(store, "JPY").body.total, order(store, "EUR").body.total], ["¥1234", "€12.34"]);
});

test("a currency nobody keeps is refused", (t) => {
  assert.equal(order(fresh(t), "XXX").status, 400);
});
