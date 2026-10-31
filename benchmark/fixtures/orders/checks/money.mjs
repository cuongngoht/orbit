import assert from "node:assert/strict";
import { test } from "node:test";
import { formatted, lineTotal, orderTotal, subtotal } from "../src/money.mjs";

test("a line's total is its quantity times its unit price, in minor units", () => {
  assert.equal(lineTotal({ qty: 3, unitMinor: 250 }), 750);
  assert.equal(subtotal([{ qty: 1, unitMinor: 100 }, { qty: 2, unitMinor: 5 }]), 110);
});

test("an order with no discount costs its subtotal, and a round discount is exact", () => {
  assert.equal(orderTotal([{ qty: 2, unitMinor: 500 }]), 1000);
  assert.equal(orderTotal([{ qty: 2, unitMinor: 500 }], 10), 900);
});

test("a total is formatted in dollars by default", () => {
  assert.equal(formatted(1234), "$12.34");
});
