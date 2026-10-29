// The AUTH CONTRACT of a connection (src/connections/auth.mjs and the `auth` field of model.mjs), over a provider made up
// for the test: the contract knows no vendor, no tool and no token format, so neither does this file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Refused } from "../src/errors.mjs";
import { AUTH_CODES, AuthBlocked, excerpt } from "../src/connections/auth-errors.mjs";
import { SAFETY_MS, createAuth } from "../src/connections/auth.mjs";
import { createConnections } from "../src/connections/manage.mjs";
import { configured, connectionProblems, publicConnection, shapedConnection, strategyOf } from "../src/connections/model.mjs";
import { connectionStore } from "../src/connections/store.mjs";
import { secretSource } from "../src/secrets.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { realIo } from "../src/store/io.mjs";

const PROVIDERS = [
  { id: "svc", label: "Service", connection: { fields: [{ name: "organization", label: "Organization", required: true }] }, authentication: { default: "session", strategies: [
    { id: "session", kind: "broker", request: "bearer", label: "Sign in", options: [{ name: "tenant", label: "Tenant", type: "string", pattern: "^[a-z0-9.-]{1,60}$" }, { name: "deviceCode", label: "Device code", type: "boolean" }] },
    { id: "credential", kind: "credential", request: "basic", label: "Token" },
  ] } },
  { id: "plain", label: "Plain", connection: { fields: [{ name: "organization", label: "Organization", required: true }] } },
];

const TOKEN_A = "tokA-9f3c1d7e5b2a4c8d";
const TOKEN_B = "tokB-1a2b3c4d5e6f7a8b";

// An adapter that hands out tokens from a script and records what it was asked.
function adapter(script) {
  const calls = [];
  const next = () => script.shift();
  return { calls, acquire: async (a) => (calls.push({ op: "acquire", interactive: a.interactive, notify: typeof a.notify }), (await Promise.resolve(), (() => { const got = next(); if (got instanceof Error) throw got; return got; })())), status: async () => ({ state: "authenticated" }), signIn: async (a) => (calls.push({ op: "signIn", tenant: a.tenant, deviceCode: a.deviceCode }), { state: "authenticated" }), signOut: async () => (calls.push({ op: "signOut" }), { state: "sign-in-required" }) };
}

const clock = (start = 1_000_000) => { const c = { now: start }; return { c, nowMs: () => c.now }; };
const SESSION = { id: "svc-acme", provider: "svc", organization: "acme", auth: { strategy: "session" } };

test("a connection with no `auth` is a credential connection, and every strategy is looked up in the PROVIDER's descriptor", () => {
  const [svc, plain] = PROVIDERS;
  assert.equal(strategyOf({ provider: "svc" }, svc).id, "credential");
  assert.equal(strategyOf(SESSION, svc).kind, "broker");
  assert.equal(strategyOf({ auth: { strategy: "session" } }, plain).id, "credential", "a provider that offers no strategies has only the credential");
  assert.deepEqual([configured({ credential: "ENV_NAME" }, svc), configured({}, svc), configured(SESSION, svc)], [true, false, true], "a sign-in needs nothing until it is used");
});

test("a record carries `auth` only as the provider's descriptor allows, and the refusal never repeats what it was given", () => {
  const [svc, plain] = PROVIDERS;
  const rec = (auth) => ({ id: "svc-acme", provider: "svc", organization: "acme", auth });
  assert.deepEqual(connectionProblems(rec({ strategy: "session", tenant: "contoso.example", deviceCode: true }), PROVIDERS), []);
  assert.deepEqual(connectionProblems({ id: "old-one", provider: "svc", organization: "acme" }, PROVIDERS), [], "a record made before `auth` existed still holds");
  for (const [what, auth] of [["an unknown strategy", { strategy: "magic" }], ["an unknown option", { strategy: "session", nope: 1 }], ["a bad pattern", { strategy: "session", tenant: "Not A Tenant!" }], ["a bad type", { strategy: "session", deviceCode: "yes" }], ["not an object", "session"], ["an option on a credential", { strategy: "credential", tenant: "x" }]]) assert.notDeepEqual(connectionProblems(rec(auth), PROVIDERS), [], what);
  const secretish = "tenant-SECRET-VALUE!!";
  assert.equal(connectionProblems(rec({ strategy: "session", tenant: secretish }), PROVIDERS).join(" ").includes(secretish), false, "no echo");
  assert.notDeepEqual(connectionProblems({ id: "plain-x", provider: "plain", organization: "a", auth: { strategy: "session" } }, PROVIDERS), [], "a provider with no strategies takes no `auth`");
  assert.equal(svc.authentication.default, "session");
  assert.equal(plain.authentication, undefined);
});

test("a new connection spells out how it gets in; its public view says so, and an old record is read as a credential", () => {
  const [svc, plain] = PROVIDERS;
  assert.deepEqual(shapedConnection({ id: "svc-a", provider: "svc", organization: "a" }, svc).auth, { strategy: "session" });
  assert.equal(shapedConnection({ id: "p", provider: "plain", organization: "a" }, plain).auth, undefined);
  assert.deepEqual(shapedConnection({ id: "svc-a", provider: "svc", organization: "a", auth: { strategy: "credential" } }, svc).auth, { strategy: "credential" }, "what a person chose wins over the default");
  assert.deepEqual(publicConnection({ id: "old", provider: "svc" }).auth, { strategy: "credential" });
  assert.deepEqual(publicConnection(SESSION).auth, { strategy: "session" });
});

test("a credential is read when a request needs it -- not before -- sent as the descriptor says, and remembered as issued", async () => {
  const reads = [];
  const secrets = { read: async (ref) => (reads.push(ref), ref === "MY_TOKEN" ? "s3cret-credential-value" : null) };
  const auth = createAuth({ secrets, adapters: {}, providers: PROVIDERS, nowMs: () => 0 });
  const conn = { id: "svc-acme", provider: "svc", organization: "acme", auth: { strategy: "credential" }, credential: "MY_TOKEN" };
  const request = auth.resolve(conn);
  assert.deepEqual([reads.length, request.source, request.kind, request.secrets()], [0, "credential", "credential", []], "resolving reads nothing");
  assert.equal((await request.headers()).Authorization, `Basic ${Buffer.from(":s3cret-credential-value").toString("base64")}`, "this strategy's request is basic");
  await request.headers();
  assert.deepEqual([reads.length, request.secrets()], [1, ["s3cret-credential-value"]], "read once per run, and known to the leak scan");
  const bearer = createAuth({ secrets, adapters: {}, providers: [{ ...PROVIDERS[1], authentication: { strategies: [{ id: "credential", kind: "credential", request: "bearer" }] } }], nowMs: () => 0 });
  assert.equal((await bearer.resolve({ ...conn, provider: "plain", auth: undefined }).headers()).Authorization, "Bearer s3cret-credential-value");
});

test("a credential that is not set is a BLOCKED answer with a code and a next step, and never an empty header", async () => {
  const auth = createAuth({ secrets: { read: async () => null }, adapters: {}, providers: PROVIDERS, nowMs: () => 0 });
  const rejection = await auth.resolve({ id: "svc-acme", provider: "svc", organization: "acme", auth: { strategy: "credential" }, credential: "UNSET" }).headers().catch((e) => e);
  assert.ok(rejection instanceof AuthBlocked);
  assert.deepEqual([rejection.code, AUTH_CODES.includes(rejection.code), typeof rejection.next], ["AUTH_CREDENTIAL_MISSING", true, "string"]);
});

test("a signed-in token is kept until two minutes before it ends, then asked for again -- and many requests at once cause ONE acquisition", async () => {
  const { c, nowMs } = clock();
  const a = adapter([{ token: TOKEN_A, expiresAt: c.now + 10 * 60_000 }, { token: TOKEN_B, expiresAt: c.now + 70 * 60_000 }]);
  const request = createAuth({ secrets: {}, adapters: { session: a }, providers: PROVIDERS, nowMs }).resolve(SESSION);
  const together = await Promise.all(Array.from({ length: 12 }, () => request.headers()));
  assert.deepEqual([a.calls.length, new Set(together.map((h) => h.Authorization)).size], [1, 1], "twelve requests, one acquisition");
  c.now += 10 * 60_000 - SAFETY_MS - 1;
  assert.equal((await request.headers()).Authorization, `Bearer ${TOKEN_A}`, "still good a moment before the margin");
  c.now += 2;
  assert.equal((await request.headers()).Authorization, `Bearer ${TOKEN_B}`, "replaced inside the margin: a request made now must be good when the source reads it");
  assert.deepEqual([a.calls.length, request.secrets()], [2, [TOKEN_A, TOKEN_B]], "every token it ever issued is known to the leak scan");
});

test("`invalidate` forgets the token (the source said 401); a token with no expiry is never kept; a failed acquisition is not remembered", async () => {
  const { c, nowMs } = clock();
  const a = adapter([{ token: TOKEN_A, expiresAt: c.now + 60 * 60_000 }, { token: TOKEN_B, expiresAt: c.now + 60 * 60_000 }]);
  const request = createAuth({ secrets: {}, adapters: { session: a }, providers: PROVIDERS, nowMs }).resolve(SESSION);
  await request.headers();
  request.invalidate();
  assert.equal(request.expiresAt(), null);
  assert.equal((await request.headers()).Authorization, `Bearer ${TOKEN_B}`);
  const none = adapter([{ token: TOKEN_A }, { token: TOKEN_B }]);
  const every = createAuth({ secrets: {}, adapters: { session: none }, providers: PROVIDERS, nowMs }).resolve(SESSION);
  await every.headers();
  await every.headers();
  assert.equal(none.calls.length, 2, "no `expiresAt`, so nothing is assumed about how long it is good");
  const flaky = adapter([new AuthBlocked("AUTH_TOKEN_FAILED", "the tool did not answer"), { token: TOKEN_A, expiresAt: c.now + 3_600_000 }]);
  const retry = createAuth({ secrets: {}, adapters: { session: flaky }, providers: PROVIDERS, nowMs }).resolve(SESSION);
  await assert.rejects(() => retry.headers(), (e) => e.code === "AUTH_TOKEN_FAILED");
  assert.equal((await retry.headers()).Authorization, `Bearer ${TOKEN_A}`, "the failure was not kept as the answer");
});

test("what a person may be asked to do is the caller's to say: `interactive` and `notify` reach the adapter, and the default lets it ask", async () => {
  const a = adapter([{ token: TOKEN_A }, { token: TOKEN_A }]);
  const auth = createAuth({ secrets: {}, adapters: { session: a }, providers: PROVIDERS, nowMs: () => 0 });
  await auth.resolve(SESSION).headers();
  await auth.resolve(SESSION, { interactive: "never", notify: () => {} }).headers();
  assert.deepEqual(a.calls, [{ op: "acquire", interactive: "when-required", notify: "undefined" }, { op: "acquire", interactive: "never", notify: "function" }]);
});

test("a source's refusal is told apart: 401 says the sign-in was not accepted, 403 that it was and may not read this -- in fixed words", async () => {
  const auth = createAuth({ secrets: {}, adapters: {}, providers: PROVIDERS, nowMs: () => 0 });
  const request = auth.resolve(SESSION);
  const caught = (r, stop) => r.rejected(stop).then(() => null, (e) => e);
  assert.deepEqual([(await caught(request, { kind: "auth" })).code, (await caught(request, { kind: "forbidden" })).code], ["AUTH_REJECTED", "AUTH_FORBIDDEN"]);
  assert.match((await caught(request, { kind: "auth" })).message, /the sign-in was refused/);
  assert.match((await caught(request, { kind: "auth" })).next, /sign in again/);
  const cred = auth.resolve({ ...SESSION, auth: { strategy: "credential" }, credential: "X" });
  assert.match((await caught(cred, { kind: "auth" })).message, /the credential was refused/);
});

test("an adapter that can see more than the status code gets to say so: which directory to name when the sign-in reaches several", async () => {
  const explaining = { ...adapter([]), explain: async ({ stop }) => (stop.kind === "auth" ? new AuthBlocked("AUTH_TENANT_AMBIGUOUS", "more than one directory", "name it") : null) };
  const request = createAuth({ secrets: {}, adapters: { session: explaining }, providers: PROVIDERS, nowMs: () => 0 }).resolve(SESSION);
  assert.equal((await request.rejected({ kind: "auth" }).catch((e) => e)).code, "AUTH_TENANT_AMBIGUOUS");
  assert.equal((await request.rejected({ kind: "forbidden" }).catch((e) => e)).code, "AUTH_FORBIDDEN", "an adapter with nothing to add leaves the plain answer");
});

test("status, sign-in and sign-out go to the adapter of the strategy; a credential has nothing to sign in to; no adapter is an honest answer", async () => {
  const a = adapter([]);
  const auth = createAuth({ secrets: {}, adapters: { session: a }, providers: PROVIDERS, nowMs: () => 0 });
  assert.deepEqual(await auth.status(SESSION), { strategy: "session", state: "authenticated" });
  assert.deepEqual(await auth.signIn(SESSION, { tenant: "contoso.example", deviceCode: true, notify: () => {} }), { state: "authenticated" });
  await auth.signOut(SESSION);
  assert.deepEqual(a.calls, [{ op: "signIn", tenant: "contoso.example", deviceCode: true }, { op: "signOut" }]);
  const cred = { ...SESSION, auth: { strategy: "credential" }, credential: "X" };
  assert.deepEqual(await auth.status(cred), { strategy: "credential", state: "credential-set" });
  assert.deepEqual(await auth.status({ ...cred, credential: null }), { strategy: "credential", state: "credential-missing" });
  assert.throws(() => auth.signIn(cred), Refused);
  assert.throws(() => auth.signOut(cred), Refused);
  const none = createAuth({ secrets: {}, adapters: {}, providers: PROVIDERS, nowMs: () => 0 });
  await assert.rejects(() => none.status(SESSION), (e) => e.code === "AUTH_TOOL_UNSUPPORTED");
});

test("what a tool said is made safe before anyone reads it: its own tokens masked, secrets scrubbed, control characters gone, one short line", () => {
  const said = excerpt(`failed for ${TOKEN_A}\u001b[31m\nsecond line\u0007 password=hunter2hunter2 ${"x".repeat(500)}`, [TOKEN_A]);
  assert.equal(said.includes(TOKEN_A) || said.includes("\u001b") || said.includes("\n") || said.includes("hunter2"), false);
  assert.ok(said.length <= 240);
});

// ---- through the manager ---------------------------------------------------------------------------------------------

function manager(t, a) {
  const base = mkdtempSync(join(tmpdir(), "orbit-auth-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const store = connectionStore(stateRooms(base), realIo());
  const secrets = secretSource({ env: {} });
  const clockOf = clock();
  return { m: createConnections({ store, secrets, providers: PROVIDERS, auth: createAuth({ secrets, adapters: { session: a }, providers: PROVIDERS, nowMs: clockOf.nowMs }), now: () => "2026-10-29T00:00:00Z" }), file: () => readFileSync(store.file, "utf8") };
}

test("a connection is made with the provider's preferred way in; changing how it gets in forgets what a test proved; a person's test never starts a sign-in", async (t) => {
  const a = adapter([{ token: TOKEN_A, expiresAt: Date.now() + 3_600_000 }]);
  const { m, file } = manager(t, a);
  const made = m.create({ id: "svc-acme", provider: "svc", organization: "acme" });
  assert.deepEqual([made.auth, made.credential], [{ strategy: "session" }, { set: false, from: null }]);
  const probe = async (rec, auth) => ({ ok: true, identity: `who ${(await auth.headers()).Authorization}`, checks: [{ id: "authentication", status: "ok", message: `with ${(await auth.headers()).Authorization}` }] });
  const kept = await m.test("svc-acme", probe);
  assert.deepEqual(a.calls.map((c) => c.interactive), ["never"], "a test asks, and never signs in");
  assert.equal(JSON.stringify(kept).includes(TOKEN_A) || file().includes(TOKEN_A), false, "the token is masked wherever it would be kept");
  assert.equal(m.update("svc-acme", { auth: { strategy: "session", tenant: "contoso.example" } }).lastTest, undefined, "a test of another way in proves nothing about this one");
  assert.throws(() => m.update("svc-acme", { auth: { strategy: "magic" } }), Refused);
  assert.deepEqual(m.update("svc-acme", { label: "Acme" }).auth, { strategy: "session", tenant: "contoso.example" });
});

test("an authentication that cannot proceed is an ANSWER of the test, in fixed words and with its next step -- never a crash, never a token", async (t) => {
  const { m } = manager(t, adapter([new AuthBlocked("AUTH_LOGIN_REQUIRED", "a sign-in is needed", "sign in with the connections sign-in command")]));
  m.create({ id: "svc-acme", provider: "svc", organization: "acme" });
  const answer = await m.test("svc-acme", async (rec, auth) => (await auth.headers(), { ok: true, checks: [] }));
  assert.deepEqual([answer.ok, answer.checks[0].id, answer.checks[0].status], [false, "authentication", "missing"]);
  assert.match(answer.checks[0].message, /a sign-in is needed -- sign in with the connections sign-in command/);
  const cred = manager(t, adapter([])).m;
  cred.create({ id: "svc-b", provider: "svc", organization: "b", auth: { strategy: "credential" } });
  const missing = await cred.test("svc-b", async (rec, auth) => (await auth.headers(), { ok: true, checks: [] }));
  assert.deepEqual([missing.checks[0].id, missing.checks[0].status], ["credential", "missing"], "a credential that is not set is the same answer it always was");
});

test("signing in or out is the manager's, goes to the adapter, and forgets the last test", async (t) => {
  const a = adapter([]);
  const { m } = manager(t, a);
  m.create({ id: "svc-acme", provider: "svc", organization: "acme" });
  await m.test("svc-acme", async () => ({ ok: true, checks: [{ id: "authentication", status: "ok" }] }));
  assert.ok(m.get("svc-acme").lastTest);
  assert.deepEqual(await m.authStatus("svc-acme"), { strategy: "session", state: "authenticated" });
  await m.signIn("svc-acme", { tenant: "contoso.example" });
  assert.equal(m.get("svc-acme").lastTest, undefined);
  await m.signOut("svc-acme");
  assert.deepEqual(a.calls.map((c) => c.op), ["signIn", "signOut"]);
});
