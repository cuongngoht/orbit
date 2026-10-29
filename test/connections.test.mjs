// Connections: a source, a place, and a REFERENCE to a credential -- the
// value itself only ever in the OS secret store (or the person's own
// environment), never in a Orbit document, never echoed back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Blocked, Refused } from "../src/errors.mjs";
import { createConnections } from "../src/connections/manage.mjs";
import { connectionStore } from "../src/connections/store.mjs";
import { secretSource } from "../src/secrets.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { realIo } from "../src/store/io.mjs";
import { providers } from "../skills/orbit-report/pack.mjs";
import { fakeVault } from "./fakes/vault.mjs";

const PAT = "github_pat_11CONNECTIONCANARY000000000000000000000000000000000000000000000000";

function manager(t, { vault = fakeVault(), env = {} } = {}) {
  const base = mkdtempSync(join(tmpdir(), "orbit-connections-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const store = connectionStore(stateRooms(base), realIo());
  return { m: createConnections({ store, secrets: secretSource({ env, vault }), providers: providers(), now: () => "2026-09-25T04:00:00Z" }), store, vault, file: () => readFileSync(store.file, "utf8") };
}

test("a connection is what its provider says it needs, with the provider's defaults", async (t) => {
  const { m } = manager(t);
  const made = m.create({ id: "github-acme", provider: "github", organization: "acme" });
  assert.equal(made.host, "https://api.github.com");
  assert.deepEqual(made.credential, { set: false, from: null });
  assert.throws(() => m.create({ id: "github-acme", provider: "github", organization: "acme" }), /already exists/);
  assert.throws(() => m.create({ id: "ado", provider: "azure-devops" }), /needs Organization/);
  assert.throws(() => m.create({ id: "x", provider: "gitlab", organization: "a" }), /provider must be one of github, azure-devops/);
  assert.throws(() => m.create({ id: "gh2", provider: "github", organization: "acme", host: "http://example.test" }), /https/);
});

test("a token pasted into the wrong field is refused -- and not repeated in the refusal", async (t) => {
  const { m } = manager(t);
  assert.throws(() => m.create({ id: "github-acme", provider: "github", organization: "acme", note: PAT }), (e) => e instanceof Refused && !e.message.includes(PAT));
});

test("a credential goes into the OS secret store; the document keeps only the reference", async (t) => {
  const { m, vault, file } = manager(t);
  m.create({ id: "github-acme", provider: "github", organization: "acme" });
  const shown = await m.setCredential("github-acme", { value: PAT });
  assert.deepEqual(shown.credential, { set: true, from: "vault" });
  assert.equal(vault.items.get("connection-github-acme"), PAT);
  assert.ok(!file().includes(PAT), "connections.json never holds the value");
  assert.deepEqual(m.record("github-acme").credential, { vault: "connection-github-acme" });
  assert.ok(!JSON.stringify(m.list()).includes(PAT) && !JSON.stringify(m.get("github-acme")).includes(PAT));
});

test("with no OS secret store the answer is BLOCKED -- there is no plaintext fallback", async (t) => {
  const { m, file } = manager(t, { vault: null });
  m.create({ id: "github-acme", provider: "github", organization: "acme" });
  await assert.rejects(m.setCredential("github-acme", { value: PAT }), (e) => e instanceof Blocked && /reference an environment variable instead/.test(e.message));
  assert.ok(!file().includes(PAT));
  const env = await m.setCredential("github-acme", { env: "REPORT_GITHUB_PAT" });
  assert.deepEqual(env.credential, { set: true, from: "env", name: "REPORT_GITHUB_PAT" });
});

test("a credential that is not one line of printable characters is refused before any store sees it, without echo", async (t) => {
  const { m, vault } = manager(t);
  m.create({ id: "github-acme", provider: "github", organization: "acme" });
  await assert.rejects(m.setCredential("github-acme", { value: `${PAT}\ndelete-generic-password` }), (e) => e instanceof Refused && !e.message.includes(PAT));
  assert.equal(vault.items.size, 0);
});

test("switching to an environment reference, or deleting the connection, removes what Orbit kept; the environment stays the person's", async (t) => {
  const { m, vault } = manager(t);
  m.create({ id: "github-acme", provider: "github", organization: "acme" });
  await m.setCredential("github-acme", { value: PAT });
  await m.setCredential("github-acme", { env: "REPORT_GITHUB_PAT" });
  assert.equal(vault.items.size, 0, "the stored one is gone once nothing references it");
  await m.setCredential("github-acme", { value: PAT });
  await m.remove("github-acme");
  assert.equal(vault.items.size, 0);
  assert.deepEqual(m.list(), []);
});

test("a test is kept as the last test -- masked, and forgotten when where the connection points changes", async (t) => {
  const { m, file } = manager(t, { env: { REPORT_GITHUB_PAT: PAT } });
  m.create({ id: "github-acme", provider: "github", organization: "acme" });
  await m.setCredential("github-acme", { env: "REPORT_GITHUB_PAT" });
  const echoing = async (rec, auth) => ({ ok: false, identity: "lan", checks: [{ id: "authentication", status: "ok" }, { id: "acme/web · actions", status: "forbidden", permission: "actions: read", message: `denied for ${(await auth.headers()).Authorization.replace(/^Bearer /, "")}` }] });
  const kept = await m.test("github-acme", echoing);
  assert.equal(kept.ok, false);
  assert.ok(!JSON.stringify(kept).includes(PAT) && !file().includes(PAT), "a probe that echoes the credential is masked before it is kept");
  assert.equal(m.get("github-acme").lastTest.checks[1].permission, "actions: read");
  m.update("github-acme", { organization: "other" });
  assert.equal(m.get("github-acme").lastTest, undefined, "a test of another organization proves nothing about this one");
  const unset = await manager(t).m;
  unset.create({ id: "github-x", provider: "github", organization: "x" });
  assert.equal((await unset.test("github-x", echoing)).checks[0].status, "missing");
});
