// Fines for late returns, and what a member owes.
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

// A copy of a title of a format, lent on 2026-03-02 to a member (a new one unless named).
function lentTo(store, format, replacementCents, member = call(store, "POST", "/members", { name: "Ana Reyes" }).body) {
  const title = call(store, "POST", "/titles", { name: "Tide Tables", format }).body;
  const copy = call(store, "POST", "/copies", { title: title.id, replacementCents }).body;
  return { member, copy, loan: call(store, "POST", "/loans", { copy: copy.id, member: member.id }).body };
}

const backOn = (store, loan, day) => call(store, "POST", `/loans/${loan.id}/return`, {}, day).body;

test("a book back on its due date owes nothing", (t) => {
  const store = storeFor(t);
  const { member, loan } = lentTo(store, "book", 2000);
  assert.equal(backOn(store, loan, "2026-03-23").fineCents, 0);
  assert.equal(call(store, "GET", `/members/${member.id}`).body.balanceCents, 0);
});

test("a book back three days late is fined 75 cents, and its member owes them", (t) => {
  const store = storeFor(t);
  const { member, loan } = lentTo(store, "book", 2000);
  assert.equal(backOn(store, loan, "2026-03-26").fineCents, 75);
  assert.equal(call(store, "GET", `/members/${member.id}`).body.balanceCents, 75);
});

test("a DVD is fined a dollar a day", (t) => {
  const store = storeFor(t);
  const { loan } = lentTo(store, "dvd", 2500);
  assert.equal(backOn(store, loan, "2026-03-13").fineCents, 400);
});

test("a fine never goes above what the copy would cost to replace", (t) => {
  const store = storeFor(t);
  const { loan } = lentTo(store, "dvd", 1250);
  assert.equal(backOn(store, loan, "2026-04-30").fineCents, 1250);
});

test("a late copy dropped in the drop box is fined as one checked in at the desk, and a member owes every fine", (t) => {
  const store = storeFor(t);
  const first = lentTo(store, "book", 2000);
  const second = lentTo(store, "book", 2000, first.member);
  consume(store, { id: "scan-1", tenant: "harbor", copy: first.copy.id, at: "2026-03-25" });
  assert.deepEqual([call(store, "GET", `/loans/${first.loan.id}`).body.fineCents, backOn(store, second.loan, "2026-03-24").fineCents, call(store, "GET", `/members/${first.member.id}`).body.balanceCents], [50, 25, 75]);
});
