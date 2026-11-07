// The durable store.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { created, get, list, openStore, put } from "../src/store.mjs";

function dirFor(t) {
  const dir = mkdtempSync(join(tmpdir(), "lending-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("a record put is read back, and a store opened again finds it", (t) => {
  const dir = dirFor(t);
  put(openStore(dir), "titles", { id: "title-1", seq: 1, tenant: "harbor", name: "Tide Tables" });
  assert.deepEqual(get(openStore(dir), "titles", "title-1"), { id: "title-1", seq: 1, tenant: "harbor", name: "Tide Tables" });
});

test("every id comes from one counter, and a kind is listed in the order its records were made", (t) => {
  const store = openStore(dirFor(t));
  const made = [created(store, "titles", "title", { name: "A" }), created(store, "copies", "copy", { name: "B" }), created(store, "titles", "title", { name: "C" })];
  assert.deepEqual(made.map((r) => r.id), ["title-1", "copy-2", "title-3"]);
  assert.deepEqual(list(store, "titles").map((r) => r.name), ["A", "C"]);
});

test("an id that is not a key, or that nothing was put under, reads nothing", (t) => {
  const store = openStore(dirFor(t));
  assert.deepEqual([get(store, "titles", "title-9"), get(store, "titles", "../counter"), get(store, "titles", undefined)], [null, null, null]);
  assert.deepEqual(list(store, "holds"), []);
});
