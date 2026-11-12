// Renewing a loan, through the API.
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

// A copy of a title of a format, lent to Ana on 2026-03-02.
function lent(store, format) {
  const title = call(store, "POST", "/titles", { name: "Tide Tables", format }).body;
  const copy = call(store, "POST", "/copies", { title: title.id, replacementCents: 2000 }).body;
  return { title, loan: call(store, "POST", "/loans", { copy: copy.id, member: call(store, "POST", "/members", { name: "Ana" }).body.id }).body };
}

const renew = (store, loan, day) => call(store, "POST", `/loans/${loan.id}/renew`, {}, day);

test("a renewal moves the due date on by the title's loan period, counted from the due date it had", (t) => {
  const store = storeFor(t);
  const book = lent(store, "book").loan;
  const dvd = lent(store, "dvd").loan;
  assert.deepEqual([renew(store, book, "2026-03-10").status, renew(store, book, "2026-03-10").body.due], [200, "2026-05-04"]);
  assert.deepEqual([renew(store, dvd, "2026-03-04").body.due, call(store, "GET", `/loans/${dvd.id}`).body.renewals], ["2026-03-16", 1]);
});

test("a loan is renewed twice at most", (t) => {
  const store = storeFor(t);
  const { loan } = lent(store, "book");
  assert.deepEqual([renew(store, loan, "2026-03-05").body.renewals, renew(store, loan, "2026-03-05").body.renewals], [1, 2]);
  assert.deepEqual(renew(store, loan, "2026-03-05"), { status: 409, body: { error: "renewal-limit" } });
});

test("an overdue loan is not renewed, though one on its due date is", (t) => {
  const store = storeFor(t);
  const { loan } = lent(store, "dvd");
  assert.deepEqual(renew(store, loan, "2026-03-10"), { status: 409, body: { error: "overdue" } });
  assert.equal(renew(store, loan, "2026-03-09").status, 200);
});

test("a loan is not renewed while somebody waits for its title, nor once it is back", (t) => {
  const store = storeFor(t);
  const { title, loan } = lent(store, "book");
  call(store, "POST", "/holds", { title: title.id, member: call(store, "POST", "/members", { name: "Ben" }).body.id });
  assert.deepEqual(renew(store, loan, "2026-03-05"), { status: 409, body: { error: "hold-waiting" } });
  assert.deepEqual([call(store, "POST", `/loans/${loan.id}/return`, {}, "2026-03-06").status, renew(store, loan, "2026-03-06").body.error], [200, "returned"]);
});
