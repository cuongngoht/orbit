// The drop box consumer: what a library's return box sends, checked in.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { handle } from "../src/api.mjs";
import { consume } from "../src/dropbox.mjs";
import { openStore } from "../src/store.mjs";

function storeFor(t) {
  const dir = mkdtempSync(join(tmpdir(), "lending-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return openStore(dir);
}

const call = (store, method, path, body) => handle(store, { method, path, tenant: "harbor", today: "2026-03-02", body });

// A copy of a book lent to a member on 2026-03-02.
function lentOne(store) {
  const title = call(store, "POST", "/titles", { name: "Tide Tables", format: "book" }).body;
  const copy = call(store, "POST", "/copies", { title: title.id, replacementCents: 2000 }).body;
  return { copy, loan: call(store, "POST", "/loans", { copy: copy.id, member: call(store, "POST", "/members", { name: "Ana" }).body.id }).body };
}

const scan = (id, copy, at = "2026-03-09") => ({ id, tenant: "harbor", copy, at });

test("a copy dropped in the box is checked in on the day the box scanned it, and goes back on the shelf", (t) => {
  const store = storeFor(t);
  const { copy, loan } = lentOne(store);
  assert.deepEqual(consume(store, scan("scan-1", copy.id)), { ack: true, outcome: "returned" });
  assert.deepEqual([call(store, "GET", `/loans/${loan.id}`).body.returned, call(store, "GET", `/copies/${copy.id}`).body.status], ["2026-03-09", "shelf"]);
});

test("a message delivered again is acknowledged and changes nothing", (t) => {
  const store = storeFor(t);
  const { copy } = lentOne(store);
  consume(store, scan("scan-1", copy.id));
  const again = call(store, "POST", "/loans", { copy: copy.id, member: call(store, "POST", "/members", { name: "Ben" }).body.id }).body;
  assert.deepEqual([consume(store, scan("scan-1", copy.id, "2026-03-10")), call(store, "GET", `/loans/${again.id}`).body.returned], [{ ack: true, outcome: "duplicate" }, null]);
});

test("a copy the system does not have, or one not on loan, is acknowledged and changes nothing", (t) => {
  const store = storeFor(t);
  const { copy } = lentOne(store);
  consume(store, scan("scan-1", copy.id));
  assert.deepEqual([consume(store, scan("scan-2", "copy-404")), consume(store, scan("scan-3", copy.id))], [{ ack: true, outcome: "unknown-copy" }, { ack: true, outcome: "not-on-loan" }]);
});

test("a message the consumer cannot read is acknowledged and rejected", (t) => {
  const store = storeFor(t);
  const bad = [null, { id: "scan-1", tenant: "harbor", copy: "copy-1" }, { id: "../scan", tenant: "harbor", copy: "copy-1", at: "2026-03-09" }, { id: "scan-1", tenant: "Harbor!", copy: "copy-1", at: "2026-03-09" }];
  assert.deepEqual(bad.map((m) => consume(store, m)), bad.map(() => ({ ack: true, outcome: "rejected" })));
});
