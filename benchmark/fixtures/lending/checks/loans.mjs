// Lending, and checking a loan in at the desk, through the API.
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

// A copy of a new title of a format, lent to a new member on 2026-03-02.
function lentOne(store, format) {
  const title = call(store, "POST", "/titles", { name: "Tide Tables", format }).body;
  const copy = call(store, "POST", "/copies", { title: title.id, replacementCents: 2000 }).body;
  const member = call(store, "POST", "/members", { name: "Ana Reyes" }).body;
  return { title, copy, member, loan: call(store, "POST", "/loans", { copy: copy.id, member: member.id }) };
}

test("a copy is lent until its title's loan period is over: three weeks for a book, one week for a DVD", (t) => {
  const store = storeFor(t);
  const book = lentOne(store, "book").loan;
  const dvd = lentOne(store, "dvd").loan;
  assert.deepEqual([book.status, book.body.out, book.body.due, book.body.returned], [201, "2026-03-02", "2026-03-23", null]);
  assert.deepEqual([dvd.status, dvd.body.due], [201, "2026-03-09"]);
});

test("a lent copy is on loan, and nobody else may borrow it", (t) => {
  const store = storeFor(t);
  const { copy } = lentOne(store, "book");
  const ben = call(store, "POST", "/members", { name: "Ben Okafor" }).body;
  assert.equal(call(store, "GET", `/copies/${copy.id}`).body.status, "loan");
  assert.deepEqual(call(store, "POST", "/loans", { copy: copy.id, member: ben.id }), { status: 409, body: { error: "not-available" } });
});

test("a loan is read back as it was lent", (t) => {
  const store = storeFor(t);
  const { copy, member, loan } = lentOne(store, "book");
  const read = call(store, "GET", `/loans/${loan.body.id}`);
  assert.deepEqual([read.status, read.body.copy, read.body.member, read.body.due], [200, copy.id, member.id, "2026-03-23"]);
  assert.deepEqual(call(store, "GET", "/loans/loan-77"), { status: 404, body: { error: "no-loan" } });
});

test("a loan checked in at the desk is back on the day it came in, and its copy is back on the shelf", (t) => {
  const store = storeFor(t);
  const { copy, loan } = lentOne(store, "book");
  const back = call(store, "POST", `/loans/${loan.body.id}/return`, {}, "2026-03-10");
  assert.deepEqual([back.status, back.body.returned], [200, "2026-03-10"]);
  assert.equal(call(store, "GET", `/copies/${copy.id}`).body.status, "shelf");
});

test("a loan that is back already is not checked in again", (t) => {
  const store = storeFor(t);
  const { loan } = lentOne(store, "book");
  call(store, "POST", `/loans/${loan.body.id}/return`, {}, "2026-03-10");
  assert.deepEqual(call(store, "POST", `/loans/${loan.body.id}/return`, {}, "2026-03-11"), { status: 409, body: { error: "returned" } });
});

test("lending names a copy and a member the system has", (t) => {
  const store = storeFor(t);
  const { copy, member } = lentOne(store, "book");
  assert.deepEqual(call(store, "POST", "/loans", { copy: "copy-90", member: member.id }), { status: 404, body: { error: "no-copy" } });
  assert.deepEqual(call(store, "POST", "/loans", { copy: copy.id, member: "member-90" }), { status: 404, body: { error: "no-member" } });
});
