// The PostgreSQL STATE reference adapter (ADR 0035; doc §5.4, §5.5): a zero-dependency client that
// authenticates as the startup user (trust, cleartext, MD5, SCRAM-SHA-256 with the server held to its
// own proof), reads inside ONE REPEATABLE READ, READ ONLY transaction, and is asked only statements
// the adapter BUILT -- quoted identifiers from the binding, every value a parameter -- against a fake
// server on a real loopback socket. Nothing a request says ever becomes SQL.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { BEGIN, readRows } from "../skills/orbit-backend-test/postgres/client.mjs";
import { OPERATIONS, planOf, run } from "../skills/orbit-backend-test/postgres/operations.mjs";
import { clientFinal, clientFirst, serverFirstOf, serverProved } from "../skills/orbit-backend-test/postgres/scram.mjs";
import { columnsOf, createReader, fieldsOf, statement, valuesOf } from "../skills/orbit-backend-test/postgres/wire.mjs";
import { pgPeer } from "./fakes/pg-peer.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REMINDERS = [{ business_key: "tenant-a|inv-a|billing-daily:2026-10-22T09:00:00+07:00", tenant_id: "tenant-a", status: "recorded" }, { business_key: "tenant-b|inv-b|billing-daily:2026-10-22T09:00:00+07:00", tenant_id: "tenant-b", status: "recorded" }];
const KEY = REMINDERS[0].business_key;

test("SCRAM-SHA-256 is the RFC 7677 exchange: the client's proof, and the server's signature it holds the server to", () => {
  const first = clientFirst("rOprNGfwEbeRWgbNEkqO", "user");
  const server = serverFirstOf("r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096", first.nonce);
  const final = clientFinal("pencil", first, server);
  assert.equal(final.message, "c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,p=dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=");
  assert.equal(serverProved("v=6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=", final.serverSignature), true);
  assert.equal(serverProved("v=AAAA", final.serverSignature), false);
  assert.equal(serverFirstOf("r=someone-elses-nonce,s=AA==,i=4096", first.nonce), null, "a challenge that does not extend our nonce is not ours");
});

test("the wire: a statement carries its values as parameters, and a reader keeps half a message for the next chunk", () => {
  const bytes = statement('SELECT count(*) FROM "reminders" WHERE "business_key" = $1', ["x'; DROP TABLE reminders; --"]);
  assert.equal(bytes.includes(Buffer.from("DROP TABLE")), true, "the value travels…");
  assert.equal(bytes.indexOf(Buffer.from("SELECT")) < bytes.indexOf(Buffer.from("DROP")), true, "…after the statement, as a parameter of its own");
  const seen = [];
  const reader = createReader((m) => seen.push(m.type));
  const two = Buffer.concat([Buffer.from("Z"), Buffer.from([0, 0, 0, 5]), Buffer.from("I"), Buffer.from("C"), Buffer.from([0, 0, 0, 5]), Buffer.from([0])]);
  reader.push(two.subarray(0, 7));
  reader.push(two.subarray(7));
  assert.deepEqual(seen, ["Z", "C"]);
  assert.deepEqual(fieldsOf(Buffer.from("SERROR\0C42P01\0Mrelation does not exist\0\0")), { S: "ERROR", C: "42P01", M: "relation does not exist" });
  const row = Buffer.concat([Buffer.from([0, 2, 0, 0, 0, 1]), Buffer.from("7"), Buffer.from([0xff, 0xff, 0xff, 0xff])]);
  assert.deepEqual(valuesOf(row), ["7", null]);
  const desc = Buffer.concat([Buffer.from([0, 1]), Buffer.from("count\0"), Buffer.alloc(18)]);
  assert.deepEqual(columnsOf(desc), ["count"]);
});

for (const [auth, password] of [["trust", undefined], ["scram", "pencil"]]) {
  test(`authenticated by ${auth}, every statement runs inside one READ ONLY snapshot and the connection says goodbye`, async () => {
    const peer = await pgPeer({ auth, tables: { reminders: REMINDERS } });
    try {
      const out = await readRows({ host: "127.0.0.1", port: peer.port, user: "invoice", password, timeoutMs: 5000 }, [{ sql: 'SELECT count(*) FROM "reminders" WHERE "business_key" = $1', params: [KEY] }]);
      assert.deepEqual(out[0].rows, [["1"]]);
      assert.deepEqual(peer.seen.queries, [BEGIN, "ROLLBACK"]);
      assert.equal(peer.seen.statements[0].inReadOnlyTx, true);
      assert.deepEqual([peer.seen.startup.user, peer.seen.startup.database, peer.seen.startup.application_name], ["invoice", "invoice", "orbit"]);
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(peer.seen.terminated, true);
    } finally { await peer.close(); }
  });
}

test("a wrong password, a server that cannot prove itself, and a server nobody answers are each refused or the transport's -- never a read", async () => {
  const wrong = await pgPeer({ auth: "scram" });
  await assert.rejects(readRows({ host: "127.0.0.1", port: wrong.port, user: "invoice", password: "not-it", timeoutMs: 5000 }, []), (e) => e.kind === "transport" && /SQLSTATE 28P01/.test(e.message));
  await wrong.close();
  const liar = await pgPeer({ auth: "scram", lieAboutServer: true });
  await assert.rejects(readRows({ host: "127.0.0.1", port: liar.port, user: "invoice", password: "pencil", timeoutMs: 5000 }, []), (e) => e.kind === "refused" && /could not prove it knows the password/.test(e.message));
  await liar.close();
  const nobody = await pgPeer();
  await nobody.close();
  await assert.rejects(readRows({ host: "127.0.0.1", port: nobody.port, user: "invoice", timeoutMs: 5000 }, []), (e) => e.kind === "transport");
  const silent = await pgPeer({ auth: "scram" });
  await assert.rejects(readRows({ host: "127.0.0.1", port: silent.port, user: "invoice", timeoutMs: 5000 }, []), (e) => e.kind === "refused" && /none is bound/.test(e.message));
  await silent.close();
});

test("a password is never handed to a server that asks for it, and a server that skips its proof is refused -- no downgrade", async () => {
  for (const auth of ["cleartext", "md5"]) {
    const peer = await pgPeer({ auth });
    await assert.rejects(readRows({ host: "127.0.0.1", port: peer.port, user: "invoice", password: "pencil", timeoutMs: 5000 }, []), (e) => e.kind === "refused" && /SCRAM-SHA-256, or not at all/.test(e.message), auth);
    assert.deepEqual(peer.seen.passwords, [], `${auth}: the password never left`);
    await peer.close();
  }
  const impostor = await pgPeer({ auth: "trust" });
  await assert.rejects(readRows({ host: "127.0.0.1", port: impostor.port, user: "invoice", password: "pencil", timeoutMs: 5000 }, []), (e) => e.kind === "refused" && /without the proof the bound password requires/.test(e.message), "a bound password means a server that proves it knows it");
  await impostor.close();
});

test("the adapter builds the only statements it asks: the bound table and key column quoted, the request's values as parameters, a whole table never", () => {
  const plan = planOf({ table: "billing.reminders", key: "business_key" }, { key: KEY, match: { tenant_id: "tenant-a" }, limit: 5 });
  assert.deepEqual(plan.statements, [{ sql: 'SELECT count(*) FROM "billing"."reminders" WHERE "business_key" = $1 AND "tenant_id" = $2', params: [KEY, "tenant-a"] }, { sql: 'SELECT * FROM "billing"."reminders" WHERE "business_key" = $1 AND "tenant_id" = $2 LIMIT 5', params: [KEY, "tenant-a"] }]);
  assert.match(planOf({ table: "reminders", key: "business_key" }, {}).refused, /never a whole table/);
  assert.match(planOf({ table: 'reminders"; DROP TABLE x; --', key: "k" }, { key: "v" }).refused, /names no table this adapter can quote/);
  assert.match(planOf({ table: "reminders", key: "k" }, { match: { "tenant_id = tenant_id OR 1": "1" } }).refused, /not a column this adapter can quote/);
  assert.match(planOf({ table: "reminders", key: "k" }, { match: { tenant_id: { nested: true } } }).refused, /not one text, number or boolean/);
  assert.equal(planOf({ table: "reminders", key: "k" }, { key: "v", limit: 10_000 }).statements[1].sql.endsWith("LIMIT 50"), true, "a sample is bounded");
});

test("a read answers how many rows and the first few, as text; the server's error is the binding's or the environment's, never the product's", async () => {
  const peer = await pgPeer({ auth: "scram", tables: { reminders: REMINDERS } });
  const deps = { readRows, env: { ORBIT_BIND_DB_USER: "invoice", ORBIT_BIND_DB_PASSWORD: "pencil" }, now: () => performance.now() };
  const bound = { stateRef: { alias: "reminders", transport: "postgres-wire", endpoint: { host: "127.0.0.1", port: peer.port }, credential: { userEnv: "ORBIT_BIND_DB_USER", passwordEnv: "ORBIT_BIND_DB_PASSWORD" }, table: "reminders", key: "business_key" } };
  try {
    assert.deepEqual(OPERATIONS, ["read"]);
    const out = await run({ op: "read", request: { key: KEY }, bound, deadlineMs: 5000 }, deps);
    assert.deepEqual(out.value, { count: 1, rows: [REMINDERS[0]], columns: ["business_key", "tenant_id", "status"] });
    const none = await run({ op: "read", request: { key: "nobody|nothing|never" }, bound, deadlineMs: 5000 }, deps);
    assert.deepEqual([none.value.count, none.value.rows], [0, []]);
    assert.equal((await run({ op: "write", bound }, deps)).failure.class, "refused");
    assert.match((await run({ op: "read", request: { key: KEY }, bound: { stateRef: { ...bound.stateRef, credential: {} } }, deadlineMs: 5000 }, deps)).failure.message, /no user to read it as/);
  } finally { await peer.close(); }
  const missing = await pgPeer({ auth: "trust", errorOn: { when: "count(*)", code: "42P01", text: 'relation "reminders" does not exist' } });
  const failed = await run({ op: "read", request: { key: KEY }, bound: { stateRef: { ...bound.stateRef, endpoint: { host: "127.0.0.1", port: missing.port }, credential: { userEnv: "ORBIT_BIND_DB_USER" } } }, deadlineMs: 5000 }, deps);
  assert.deepEqual([failed.failure.class, /does not hold what the binding named/.test(failed.failure.message)], ["refused", true]);
  await missing.close();
});

test("the helper answers one orbit.helper/v1 line, and the credential travels only in its environment", async () => {
  const peer = await pgPeer({ auth: "scram", tables: { reminders: REMINDERS } });
  const request = { v: "orbit.helper/v1", op: "read", request: { key: KEY }, bound: { stateRef: { alias: "reminders", endpoint: { host: "127.0.0.1", port: peer.port }, credential: { userEnv: "ORBIT_BIND_DB_USER", passwordEnv: "ORBIT_BIND_DB_PASSWORD" }, table: "reminders", key: "business_key" } }, deadlineMs: 5000 };
  const said = await new Promise((resolve) => {
    const child = spawn(process.execPath, [join(ROOT, "skills/orbit-backend-test/postgres/helper.mjs")], { env: { PATH: process.env.PATH, ORBIT_BIND_DB_USER: "invoice", ORBIT_BIND_DB_PASSWORD: "pencil" } });
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.on("close", () => resolve(out));
    child.stdin.end(JSON.stringify(request));
  });
  await peer.close();
  const lines = said.trim().split("\n");
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]).value.count, 1);
  assert.equal(said.includes("pencil"), false, "the password is in no answer");
});
