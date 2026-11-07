// What every request is held to before its route.
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

test("a request with no library system it signed in as is refused", (t) => {
  const store = storeFor(t);
  assert.deepEqual(handle(store, { method: "GET", path: "/titles", today: "2026-03-02" }), { status: 401, body: { error: "no-tenant" } });
  assert.deepEqual(handle(store, { method: "GET", path: "/titles", tenant: "Harbor Libraries", today: "2026-03-02" }), { status: 401, body: { error: "no-tenant" } });
});

test("a request on a day that is not a day of the calendar is refused", (t) => {
  const store = storeFor(t);
  assert.deepEqual(handle(store, { method: "GET", path: "/titles", tenant: "harbor", today: "2026-02-30" }), { status: 400, body: { error: "bad-day" } });
});

test("a route the service does not have is not found", (t) => {
  const store = storeFor(t);
  assert.deepEqual(handle(store, { method: "DELETE", path: "/titles", tenant: "harbor", today: "2026-03-02" }), { status: 404, body: { error: "no-route" } });
  assert.deepEqual(handle(store, { method: "GET", path: "/shelves", tenant: "harbor", today: "2026-03-02" }), { status: 404, body: { error: "no-route" } });
});
