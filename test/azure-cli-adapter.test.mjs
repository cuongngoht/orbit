// The Azure CLI ADAPTER (skills/orbit-report/auth/azure-cli.mjs): the sequence it follows to give a connection a token,
// over a fake `az` that keeps state the way the real one does and the REAL launcher of the tools layer -- so the
// environment every call carries is the one the owner builds, not one the test made up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createAuth } from "../src/connections/auth.mjs";
import { AuthBlocked } from "../src/connections/auth-errors.mjs";
import { toolCatalog } from "../src/tools/catalog.mjs";
import { launcherOf } from "../src/tools/launch.mjs";
import { azureCliAdapter } from "../skills/orbit-report/auth/azure-cli.mjs";
import { classify } from "../skills/orbit-report/auth/azure-cli-classify.mjs";
import { providers } from "../skills/orbit-report/pack.mjs";
import { createFakeAz } from "./fakes/az-cli.mjs";

const REPO = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const ROWS = toolCatalog(JSON.parse(readFileSync(join(REPO, "catalog", "tools.json"), "utf8")));
const PRIVATE = ROWS.find((r) => r.id === "azure-cli-private");
const PROVIDERS = providers();
const STRATEGY = PROVIDERS.find((p) => p.id === "azure-devops").authentication.strategies.find((s) => s.id === "azure-cli");
const CONNECTION = { id: "ado-acme", provider: "azure-devops", organization: "acme", auth: { strategy: "azure-cli" } };
const ORBIT = "/fake/orbit/control/auth";
const NOW = 1_800_000_000_000;

const B = { name: "orbit-B", tenant: "tenant-b" };

// The tools layer's answer, with the REAL launcher: file, leading arguments, environment and profile directory.
function tooling(az, { env = az.parentEnv ?? {}, row = PRIVATE, platform = "linux" } = {}) {
  const found = { launch: { file: "/orbit/runtimes/azure-cli-private/venv/bin/python", args: ["-IBm", "azure.cli"] }, source: "orbit-managed", version: "2.91.0" };
  const ctx = { platform, env, rooms: { authSessions: ORBIT }, scratch: () => ({ dir: "/scratch/x", dispose: () => {} }), windowsMounts: [] };
  const resolved = { id: row.id, found, version: "2.91.0", source: "orbit-managed", launcher: (purpose) => launcherOf(row, found, ctx, purpose) };
  return { ensure: async () => resolved, find: () => ({ found: resolved, tried: [], acquirable: null }) };
}

function rig({ people = [B], developer = null, parentEnv = { PATH: "/usr/bin", HOME: "/fake/developer" } } = {}) {
  const az = createFakeAz({ parentEnv, developer, people });
  const events = [];
  const adapter = azureCliAdapter({ tools: tooling({ ...az, parentEnv }, { env: parentEnv }), process: az.process, io: az.io, nowMs: () => NOW, emit: (e) => events.push(e), next: { signIn: (c) => `node cli/project-report.mjs sign-in ${c.id}` } });
  const auth = createAuth({ secrets: {}, adapters: { "azure-cli": adapter }, providers: PROVIDERS, nowMs: () => NOW });
  return { az, adapter, auth, events, ops: () => az.state.calls.map((c) => c.argv[0] === "account" ? `${c.argv[0]} ${c.argv[1]}` : c.argv[0]) };
}

const ask = (r, options, connection = CONNECTION) => r.auth.resolve(connection, options).headers();

test("with no one signed in and a person not to be disturbed, nothing is run at all: the answer is known from the profile that is not there", async () => {
  const r = rig();
  const blocked = await ask(r, { interactive: "never" }).catch((e) => e);
  assert.ok(blocked instanceof AuthBlocked);
  assert.deepEqual([blocked.code, r.az.state.calls.length], ["AUTH_LOGIN_REQUIRED", 0]);
  assert.match(blocked.next, /^node cli\/project-report\.mjs sign-in ado-acme$/, "the one thing to do, as a command");
});

test("when a sign-in is allowed, it happens ONCE and then a token is asked for ONCE; the next request needs no sign-in at all", async () => {
  const r = rig();
  const shown = [];
  const first = await ask(r, { notify: (line) => shown.push(line) });
  assert.match(first.Authorization, /^Bearer tok\.orbit-B\./);
  assert.deepEqual(r.ops(), ["login", "account get-access-token"]);
  assert.match(shown[0], /Opening Microsoft sign-in/);
  assert.match(shown.join(" "), /A web browser has been opened/, "the tool's own prompt reaches the person as it appears");
  const again = await ask(r, {});
  assert.deepEqual([r.ops(), again.Authorization.startsWith("Bearer tok.orbit-B.")], [["login", "account get-access-token", "account get-access-token"], true]);
  assert.deepEqual(r.events.filter((e) => e.phase === "login"), [{ phase: "login", outcome: "ok" }]);
});

test("a dozen readers waiting at once cause one sign-in and one token request, not a dozen of either", async () => {
  const r = rig();
  const headers = await Promise.all(Array.from({ length: 12 }, () => ask(r, { notify: () => {} })));
  assert.equal(new Set(headers.map((h) => h.Authorization)).size, 1);
  assert.deepEqual(r.ops(), ["login", "account get-access-token"]);
});

test("a session that needs a person again is ONE sign-in, never a loop: after it, a token that still cannot be had is a failure that says so", async () => {
  const r = rig({ people: [{ ...B, expire: 70043 }, { ...B, expire: 70043 }] });
  const first = await r.auth.resolve(CONNECTION, { interactive: "never" }).headers().catch((e) => e);
  assert.equal(first.code, "AUTH_LOGIN_REQUIRED", "nothing has signed in yet");
  const stuck = await ask(r, {}).catch((e) => e);
  assert.equal(stuck.code, "AUTH_LOGIN_FAILED");
  assert.equal(r.az.state.calls.filter((c) => c.argv[0] === "login").length, 1, "one sign-in, then it stops");
});

test("an expired or revoked session is recognised by the service's own code, signs in once, and then works", async () => {
  const r = rig({ people: [B, B] });
  await ask(r, {});
  r.az.state.profiles.get(`${ORBIT}/azure-cli`).account = { ...B, expire: 50076 };
  const seen = await r.auth.resolve(CONNECTION, { interactive: "never" }).headers().catch((e) => e);
  assert.equal(seen.code, "AUTH_LOGIN_REQUIRED", "asked not to disturb anybody, it says what is needed");
  assert.match(seen.message, /needs a person again/);
  assert.equal((await ask(r, {})).Authorization.startsWith("Bearer tok.orbit-B."), true, "and when it may, it signs in again");
  assert.equal(r.az.state.calls.filter((c) => c.argv[0] === "login").length, 2);
});

test("a person who cancels is told, nothing is retried, and a later request may ask again", async () => {
  const r = rig({ people: [] });
  const cancelled = await ask(r, {}).catch((e) => e);
  assert.deepEqual([cancelled.code, r.az.state.calls.filter((c) => c.argv[0] === "login").length], ["AUTH_LOGIN_CANCELLED", 1]);
  assert.deepEqual(r.events.at(-1), { phase: "login", outcome: "cancelled" });
  r.az.state.people.push(B);
  assert.equal((await ask(r, {})).Authorization.startsWith("Bearer tok.orbit-B."), true);
});

test("a service that cannot be reached is not a reason to sign in: the token request says so, and no sign-in is started", async () => {
  const r = rig({ people: [B] });
  await ask(r, {});
  const down = { ok: false, out: "", err: "ERROR: HTTPSConnectionPool(host='login.example', port=443): Max retries exceeded with url: /token (Caused by NewConnectionError('Failed to establish a new connection'))\n", status: 1 };
  assert.equal(classify(down), "network");
  const real = r.az.process.runAsync;
  r.az.process.runAsync = async (file, args, opts) => (args.includes("get-access-token") ? down : real(file, args, opts));
  const failed = await r.auth.resolve(CONNECTION, {}).headers().catch((e) => e);
  assert.deepEqual([failed.code, r.az.state.calls.filter((c) => c.argv[0] === "login").length], ["AUTH_TOKEN_FAILED", 1], "the one sign-in was the first; the outage started none");
});

test("signing in as another account is a sign-out and a sign-in: the profile holds one account, and it is replaced", async () => {
  const r = rig({ people: [B, { name: "orbit-C", tenant: "tenant-c" }] });
  await ask(r, {});
  await r.auth.signIn(CONNECTION, { notify: () => {} });
  assert.deepEqual(r.ops(), ["login", "account get-access-token", "logout", "login", "account get-access-token"], "the sign-in, then out, in again, and a token that proves it");
  const token = await ask(r, {});
  assert.match(token.Authorization, /^Bearer tok\.orbit-C\./);
});

test("sign-out signs out of Orbit's profile and says what is left; with nobody signed in it does nothing", async () => {
  const r = rig();
  assert.deepEqual((await r.auth.signOut(CONNECTION)).state, "sign-in-required");
  assert.equal(r.az.state.calls.length, 0, "no profile, so no process");
  await ask(r, {});
  const out = await r.auth.signOut(CONNECTION);
  assert.deepEqual([out.state, r.ops().at(-1)], ["sign-in-required", "logout"]);
  assert.equal((await r.auth.status(CONNECTION)).state, "sign-in-required", "and nobody is signed in afterwards");
});

test("status never signs in and never fetches a tool: no profile is `sign-in-required` without a process; a good session is `authenticated`; a service code is `interaction-required`", async () => {
  const r = rig();
  const before = await r.auth.status(CONNECTION);
  assert.deepEqual([before.state, before.tool.found, before.tool.version, before.tool.source, r.az.state.calls.length], ["sign-in-required", true, "2.91.0", "orbit-managed", 0]);
  await ask(r, {});
  assert.equal((await r.auth.status(CONNECTION)).state, "authenticated");
  r.az.state.profiles.get(`${ORBIT}/azure-cli`).account = { ...B, expire: 50158 };
  assert.equal((await r.auth.status(CONNECTION)).state, "interaction-required");
});

test("a status with no tool at all says so, and what Orbit could do about it", async () => {
  const az = createFakeAz({});
  const adapter = azureCliAdapter({ tools: { ensure: async () => { throw new Error("not used"); }, find: () => ({ found: null, tried: [{ id: "azure-cli", reason: "found 2.40.0, older than the 2.61.0 this needs" }], acquirable: "azure-cli-private" }) }, process: az.process, io: az.io, nowMs: () => NOW });
  const state = await createAuth({ secrets: {}, adapters: { "azure-cli": adapter }, providers: PROVIDERS, nowMs: () => NOW }).status(CONNECTION);
  assert.deepEqual([state.state, state.tool.found, state.tool.acquirable, state.tool.tried[0].reason], ["tool-missing", false, "azure-cli-private", "found 2.40.0, older than the 2.61.0 this needs"]);
});

test("exactly the flags the design says: a token with `--only-show-errors`, a sign-in without it (its prompts are warnings a person must see), never a debug flag, the application from the descriptor", async () => {
  const r = rig();
  await ask(r, {});
  const [login, token] = r.az.state.calls.map((c) => c.argv);
  assert.deepEqual(login, ["login", "--scope", `${STRATEGY.resource}/.default`, "--allow-no-subscriptions", "--output", "none"]);
  assert.deepEqual(token, ["account", "get-access-token", "--resource", STRATEGY.resource, "--output", "json", "--only-show-errors"]);
  for (const argv of r.az.state.calls.map((c) => c.argv)) for (const forbidden of ["--debug", "--verbose", "--password", "--username", "--service-principal"]) assert.equal(argv.includes(forbidden), false, forbidden);
});

test("a directory a connection names, and a device code a person asks for, reach the commands -- and only as the descriptor's options", async () => {
  const r = rig();
  await ask(r, { notify: () => {} }, { ...CONNECTION, auth: { strategy: "azure-cli", tenant: "contoso.example", deviceCode: true } });
  const [login, token] = r.az.state.calls.map((c) => c.argv);
  assert.deepEqual([login.slice(-3), token.slice(-2)], [["--tenant", "contoso.example", "--use-device-code"], ["--tenant", "contoso.example"]]);
});

test("no token is ever an argument, a variable or a recorded value: it is only ever an answer", async () => {
  const r = rig();
  await ask(r, {});
  await ask(r, {});
  for (const call of r.az.state.calls) for (const token of r.az.state.issued) assert.equal(JSON.stringify([call.argv, call.env]).includes(token), false);
  assert.ok(r.az.state.issued.length >= 2);
});

test("every sentence about a failure is made safe before it is shown: what the tool printed is never repeated as it came", async () => {
  const r = rig();
  const noisy = { ok: false, out: "", err: `ERROR: boom password=hunter2hunter2 tok.leak.1.ZXhhbXBsZS10b2tlbi1wYWRkaW5n \u001b[31mred\n${"x".repeat(900)}`, status: 1 };
  const real = r.az.process.runAsync;
  await ask(r, {});
  r.az.process.runAsync = async (file, args, opts) => (args.includes("get-access-token") ? noisy : real(file, args, opts));
  const failed = await r.auth.resolve(CONNECTION, {}).headers().catch((e) => e);
  assert.equal(failed.code, "AUTH_TOKEN_FAILED");
  assert.equal(/hunter2|\u001b|x{200}/.test(failed.message), false);
  assert.ok(failed.message.length < 400);
});

test("when the source refuses the token and the sign-in reaches several directories, the connection is told to name one -- and not when it already has", async () => {
  const r = rig({ people: [{ ...B, tenants: ["tenant-b", "tenant-z"] }] });
  await ask(r, {});
  const request = r.auth.resolve(CONNECTION, {});
  assert.equal((await request.rejected({ kind: "auth" }).catch((e) => e)).code, "AUTH_TENANT_AMBIGUOUS");
  assert.equal((await request.rejected({ kind: "forbidden" }).catch((e) => e)).code, "AUTH_FORBIDDEN", "a 403 is a different thing");
  const named = r.auth.resolve({ ...CONNECTION, auth: { strategy: "azure-cli", tenant: "tenant-b" } }, {});
  assert.equal((await named.rejected({ kind: "auth" }).catch((e) => e)).code, "AUTH_REJECTED", "a directory is already named: no guessing");
});

test("a token's expiry is read from the tool's own `expires_on`; the 2-minute margin is the contract's", async () => {
  const r = rig();
  const request = r.auth.resolve(CONNECTION, {});
  await request.headers();
  assert.equal(request.expiresAt(), (1_800_000_000 + 3600) * 1000);
});

test("the classification is ONE table, read in order: the not-signed-in sentence is real, codes are the service's documented ones, and anything else is `failed`", () => {
  const r = (err, extra = {}) => ({ ok: false, out: "", err, status: 1, ...extra });
  assert.equal(classify(r("ERROR: Please run 'az login' to setup account.\n")), "login-required");
  for (const code of [50076, 50079, 50158, 65001, 70043, 700082, 50173]) assert.equal(classify(r(`ERROR: AADSTS${code}: something`)), "interaction-required", String(code));
  assert.equal(classify(r("ERROR: Interactive authentication is needed")), "interaction-required");
  assert.equal(classify({ ok: false, out: "", timedOut: true }), "network");
  assert.equal(classify({ ok: false, out: "", unstarted: true, error: "could not be started" }), "failed");
  assert.equal(classify(r("ERROR: something nobody has seen")), "failed", "an unknown message is never read as a request to sign in");
  assert.equal(classify({ ok: true, out: "{}" }), "ok");
});

test("a child of the sign-in never runs from a shared directory: its working directory is the profile, which only this user can enter", async () => {
  const r = rig();
  await ask(r, { notify: () => {} });
  await r.auth.signOut(CONNECTION);
  for (const call of r.az.state.calls) assert.equal(call.cwd, `${ORBIT}/azure-cli`, call.argv[0]);
});
