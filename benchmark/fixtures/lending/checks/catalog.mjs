// The catalogue: titles and copies, through the API.
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

const call = (store, method, path, body) => handle(store, { method, path, tenant: "harbor", today: "2026-03-02", body });

test("a title is added with its format, and says how long a copy of it may be out", (t) => {
  const store = storeFor(t);
  const book = call(store, "POST", "/titles", { name: "Tide Tables", format: "book" });
  const dvd = call(store, "POST", "/titles", { name: "Harbour Lights", format: "dvd" });
  assert.deepEqual([book.status, book.body.loanDays, dvd.status, dvd.body.loanDays], [201, 21, 201, 7]);
  assert.deepEqual(call(store, "GET", `/titles/${book.body.id}`), { status: 200, body: { id: book.body.id, name: "Tide Tables", format: "book", loanDays: 21 } });
});

test("a title needs a name, and a format of book or dvd", (t) => {
  const store = storeFor(t);
  const bad = [{ format: "book" }, { name: " ", format: "book" }, { name: "Tide Tables" }, { name: "Tide Tables", format: "vinyl" }];
  assert.deepEqual(bad.map((body) => call(store, "POST", "/titles", body).body.error), ["bad-title", "bad-title", "bad-title", "bad-title"]);
});

test("a copy of a title is added on the shelf, with what it would cost to replace", (t) => {
  const store = storeFor(t);
  const title = call(store, "POST", "/titles", { name: "Tide Tables", format: "book" }).body;
  const copy = call(store, "POST", "/copies", { title: title.id, replacementCents: 1899 });
  assert.equal(copy.status, 201);
  assert.deepEqual(call(store, "GET", `/copies/${copy.body.id}`).body, { id: copy.body.id, title: title.id, replacementCents: 1899, status: "shelf" });
});

test("a copy needs a title the system has, and a replacement cost in whole cents", (t) => {
  const store = storeFor(t);
  const title = call(store, "POST", "/titles", { name: "Tide Tables", format: "book" }).body;
  assert.deepEqual([{ title: title.id }, { title: title.id, replacementCents: 12.5 }, { title: title.id, replacementCents: -1 }].map((b) => call(store, "POST", "/copies", b).body.error), ["bad-copy", "bad-copy", "bad-copy"]);
  assert.deepEqual(call(store, "POST", "/copies", { title: "title-99", replacementCents: 100 }), { status: 404, body: { error: "no-title" } });
  assert.deepEqual(call(store, "GET", "/copies/copy-99"), { status: 404, body: { error: "no-copy" } });
});

test("the system's titles are listed in the order they were added", (t) => {
  const store = storeFor(t);
  for (const name of ["Tide Tables", "Salt Roads", "Harbour Lights"]) call(store, "POST", "/titles", { name, format: "book" });
  assert.deepEqual(call(store, "GET", "/titles").body.titles.map((x) => x.name), ["Tide Tables", "Salt Roads", "Harbour Lights"]);
});
