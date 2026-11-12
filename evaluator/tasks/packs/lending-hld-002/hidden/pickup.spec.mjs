// A copy that comes back serves the members waiting for its title, first come, first served.
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

const call = (store, method, path, body, today = "2026-03-02") => handle(store, { method, path, tenant: "harbor", today, body });

const memberNamed = (store, name) => call(store, "POST", "/members", { name }).body;

// One copy of a book, lent to Ana; Ben, then Cy, wait for the title.
function waitedFor(store) {
  const title = call(store, "POST", "/titles", { name: "Tide Tables", format: "book" }).body;
  const copy = call(store, "POST", "/copies", { title: title.id, replacementCents: 2000 }).body;
  const loan = call(store, "POST", "/loans", { copy: copy.id, member: memberNamed(store, "Ana").id }).body;
  const [ben, cy] = [memberNamed(store, "Ben"), memberNamed(store, "Cy")];
  return { copy, loan, ben, cy, holds: [ben, cy].map((m) => call(store, "POST", "/holds", { title: title.id, member: m.id }, "2026-03-03").body) };
}

test("a copy checked in is set aside for the member who has waited longest, and the others keep waiting", (t) => {
  const store = storeFor(t);
  const w = waitedFor(store);
  call(store, "POST", `/loans/${w.loan.id}/return`, {}, "2026-03-12");
  assert.deepEqual(w.holds.map((h) => call(store, "GET", `/holds/${h.id}`).body.state), ["ready", "waiting"]);
  assert.equal(call(store, "GET", `/copies/${w.copy.id}`).body.status, "held");
});

test("the hold that is ready names the copy and gives a week to collect it, and its member is sent a notice", (t) => {
  const store = storeFor(t);
  const w = waitedFor(store);
  call(store, "POST", `/loans/${w.loan.id}/return`, {}, "2026-03-12");
  assert.deepEqual([call(store, "GET", `/holds/${w.holds[0].id}`).body.copy, call(store, "GET", `/holds/${w.holds[0].id}`).body.pickupBy], [w.copy.id, "2026-03-19"]);
  assert.deepEqual(call(store, "GET", `/members/${w.ben.id}/notices`).body.notices.map((n) => [n.kind, n.hold, n.copy, n.pickupBy]), [["hold-ready", w.holds[0].id, w.copy.id, "2026-03-19"]]);
});

test("only the member a copy is set aside for may borrow it, and their hold is collected when they do", (t) => {
  const store = storeFor(t);
  const w = waitedFor(store);
  call(store, "POST", `/loans/${w.loan.id}/return`, {}, "2026-03-12");
  assert.deepEqual(call(store, "POST", "/loans", { copy: w.copy.id, member: w.cy.id }, "2026-03-13"), { status: 409, body: { error: "held-for-another" } });
  assert.deepEqual([call(store, "POST", "/loans", { copy: w.copy.id, member: w.ben.id }, "2026-03-13").status, call(store, "GET", `/holds/${w.holds[0].id}`).body.state], [201, "collected"]);
});

test("a copy dropped in the drop box serves the holds as one checked in at the desk does", (t) => {
  const store = storeFor(t);
  const w = waitedFor(store);
  consume(store, { id: "scan-1", tenant: "harbor", copy: w.copy.id, at: "2026-03-12" });
  assert.deepEqual(w.holds.map((h) => call(store, "GET", `/holds/${h.id}`).body.state), ["ready", "waiting"]);
});
