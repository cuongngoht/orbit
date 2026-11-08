// Members, through the API.
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

test("a member is added and read back by id", (t) => {
  const store = storeFor(t);
  const ana = call(store, "POST", "/members", { name: "Ana Reyes" });
  assert.equal(ana.status, 201);
  assert.deepEqual([call(store, "GET", `/members/${ana.body.id}`).status, call(store, "GET", `/members/${ana.body.id}`).body.name], [200, "Ana Reyes"]);
});

test("a member needs a name", (t) => {
  const store = storeFor(t);
  assert.deepEqual([{}, { name: "" }, { name: 7 }].map((body) => call(store, "POST", "/members", body)), [0, 1, 2].map(() => ({ status: 400, body: { error: "bad-member" } })));
});

test("a member nobody added is not found, and has no notices to read", (t) => {
  const store = storeFor(t);
  assert.deepEqual(call(store, "GET", "/members/member-4"), { status: 404, body: { error: "no-member" } });
  assert.deepEqual(call(store, "GET", "/members/member-4/notices"), { status: 404, body: { error: "no-member" } });
});

test("a member who was sent nothing has no notices", (t) => {
  const store = storeFor(t);
  const ana = call(store, "POST", "/members", { name: "Ana Reyes" }).body;
  assert.deepEqual(call(store, "GET", `/members/${ana.id}/notices`), { status: 200, body: { notices: [] } });
});
