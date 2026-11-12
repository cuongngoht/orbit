// Every library system sees and changes only its own records.
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

const as = (tenant) => (store, method, path, body) => handle(store, { method, path, tenant, today: "2026-03-02", body });

const harbor = as("harbor");
const upland = as("upland");

// What the harbor system has: a title, a copy lent to a member, another copy on the shelf, and a hold.
function harbors(store) {
  const title = harbor(store, "POST", "/titles", { name: "Tide Tables", format: "book" }).body;
  const [lentCopy, shelfCopy] = [0, 1].map(() => harbor(store, "POST", "/copies", { title: title.id, replacementCents: 2000 }).body);
  const member = harbor(store, "POST", "/members", { name: "Ana" }).body;
  const loan = harbor(store, "POST", "/loans", { copy: lentCopy.id, member: member.id }).body;
  return { title, lentCopy, shelfCopy, member, loan, hold: harbor(store, "POST", "/holds", { title: title.id, member: member.id }).body };
}

test("another system's records read as ones that do not exist", (t) => {
  const store = storeFor(t);
  const h = harbors(store);
  const paths = [`/titles/${h.title.id}`, `/copies/${h.shelfCopy.id}`, `/members/${h.member.id}`, `/members/${h.member.id}/notices`, `/loans/${h.loan.id}`, `/holds/${h.hold.id}`];
  assert.deepEqual(paths.map((p) => upland(store, "GET", p).status), [404, 404, 404, 404, 404, 404]);
});

test("a system lists only its own titles", (t) => {
  const store = storeFor(t);
  harbors(store);
  upland(store, "POST", "/titles", { name: "Salt Roads", format: "dvd" });
  assert.deepEqual([harbor(store, "GET", "/titles").body.titles.map((x) => x.name), upland(store, "GET", "/titles").body.titles.map((x) => x.name)], [["Tide Tables"], ["Salt Roads"]]);
});

// What an upland caller tries with harbor's records, naming its own member Ben where a member is asked for.
const triesOn = (h, ben) => [["POST", "/loans", { copy: h.shelfCopy.id, member: ben.id }], ["POST", "/holds", { title: h.title.id, member: ben.id }], ["POST", "/copies", { title: h.title.id, replacementCents: 100 }], ["POST", `/loans/${h.loan.id}/return`, {}], ["POST", `/loans/${h.loan.id}/renew`, {}]];

test("a change that names another system's record is refused as not found, and changes nothing of theirs", (t) => {
  const store = storeFor(t);
  const h = harbors(store);
  const tries = triesOn(h, upland(store, "POST", "/members", { name: "Ben" }).body);
  assert.deepEqual(tries.map(([m, p, b]) => upland(store, m, p, b).status), [404, 404, 404, 404, 404]);
  assert.deepEqual([harbor(store, "GET", `/copies/${h.shelfCopy.id}`).body.status, harbor(store, "GET", `/loans/${h.loan.id}`).body.returned], ["shelf", null]);
});

test("a drop box checks in only its own system's copies", (t) => {
  const store = storeFor(t);
  const h = harbors(store);
  assert.deepEqual(consume(store, { id: "scan-1", tenant: "upland", copy: h.lentCopy.id, at: "2026-03-05" }), { ack: true, outcome: "unknown-copy" });
  assert.equal(harbor(store, "GET", `/loans/${h.loan.id}`).body.returned, null);
});
