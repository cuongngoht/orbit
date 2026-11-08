// How many items a member may have out at once.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { handle } from "../src/api.mjs";
import { openStore } from "../src/store.mjs";

function storeFor(t) {
  const dir = mkdtempSync(join(tmpdir(), "lending-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return openStore(dir);
}

const call = (store, method, path, body, today = "2026-03-02") => handle(store, { method, path, tenant: "harbor", today, body });

// A member, and `n` copies of one title on the shelf.
function shelfOf(store, n) {
  const title = call(store, "POST", "/titles", { name: "Tide Tables", format: "book" }).body;
  const copies = Array.from({ length: n }, () => call(store, "POST", "/copies", { title: title.id, replacementCents: 2000 }).body);
  return { member: call(store, "POST", "/members", { name: "Ana Reyes" }).body, copies };
}

const borrowed = (store, member, copies) => copies.map((c) => call(store, "POST", "/loans", { copy: c.id, member: member.id }));

test("a member may have five items out at once, and the sixth is refused for the limit", (t) => {
  const store = storeFor(t);
  const { member, copies } = shelfOf(store, 6);
  const answers = borrowed(store, member, copies);
  assert.deepEqual(answers.map((a) => a.status), [201, 201, 201, 201, 201, 409]);
  assert.deepEqual(answers[5].body, { error: "limit" });
});

test("once one item comes back, the member may borrow another", (t) => {
  const store = storeFor(t);
  const { member, copies } = shelfOf(store, 6);
  const first = borrowed(store, member, copies.slice(0, 5))[0];
  call(store, "POST", `/loans/${first.body.id}/return`, {}, "2026-03-05");
  assert.equal(borrowed(store, member, copies.slice(5))[0].status, 201);
});
