// Placing a hold on a title, through the API.
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

const titleAndMember = (store) => ({ title: call(store, "POST", "/titles", { name: "Tide Tables", format: "book" }).body, member: call(store, "POST", "/members", { name: "Ana Reyes" }).body });

test("a hold is placed on a title on the day it is asked, and waits", (t) => {
  const store = storeFor(t);
  const { title, member } = titleAndMember(store);
  const hold = call(store, "POST", "/holds", { title: title.id, member: member.id });
  assert.deepEqual([hold.status, hold.body.title, hold.body.member, hold.body.placed, hold.body.state], [201, title.id, member.id, "2026-03-02", "waiting"]);
  assert.deepEqual(call(store, "GET", `/holds/${hold.body.id}`).body, hold.body);
});

test("a member holds a title once at a time", (t) => {
  const store = storeFor(t);
  const { title, member } = titleAndMember(store);
  call(store, "POST", "/holds", { title: title.id, member: member.id });
  assert.deepEqual(call(store, "POST", "/holds", { title: title.id, member: member.id }), { status: 409, body: { error: "duplicate-hold" } });
});

test("a hold names a title and a member the system has", (t) => {
  const store = storeFor(t);
  const { title, member } = titleAndMember(store);
  assert.deepEqual(call(store, "POST", "/holds", { title: "title-80", member: member.id }), { status: 404, body: { error: "no-title" } });
  assert.deepEqual(call(store, "POST", "/holds", { title: title.id, member: "member-80" }), { status: 404, body: { error: "no-member" } });
  assert.deepEqual(call(store, "GET", "/holds/hold-80"), { status: 404, body: { error: "no-hold" } });
});
