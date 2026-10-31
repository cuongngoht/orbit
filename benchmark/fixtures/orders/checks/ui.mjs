import assert from "node:assert/strict";
import { test } from "node:test";
import { renderOrder } from "../src/ui.mjs";

test("an order is drawn with its customer escaped, its total and its state", () => {
  const html = renderOrder({ id: "ord-0001", customer: "Ada & <Bob>", totalMinor: 1000, currency: "USD", state: "open", note: "" });
  assert.match(html, /<h2>Ada &amp; &lt;Bob&gt;<\/h2>/);
  assert.match(html, /<p class="total">\$10\.00<\/p>/);
  assert.match(html, /<p class="state">open<\/p>/);
});
