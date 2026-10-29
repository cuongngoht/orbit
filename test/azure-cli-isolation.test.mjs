// ORBIT'S MICROSOFT SIGN-IN IS INDEPENDENT FROM THE DEVELOPER'S OWN AZURE CLI LOGIN -- the eight things the release is
// held to, run over the WHOLE chain: the real tools layer (which program, which environment), the real adapter, and a
// fake `az` that keeps state exactly where the real one does (test/fakes/az-cli.mjs), so a profile that is not named is
// the developer's here as in life.
//
// Orbit may use an Azure CLI program that is on the machine. It never uses the developer's Azure CLI IDENTITY STATE.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAuth } from "../src/connections/auth.mjs";
import { ensureOne, findOne } from "../src/tools/ensure.mjs";
import { launcherOf } from "../src/tools/launch.mjs";
import { azureCliAdapter } from "../skills/orbit-report/auth/azure-cli.mjs";
import { providers } from "../skills/orbit-report/pack.mjs";
import { createFakeAz } from "./fakes/az-cli.mjs";
import { CATALOG, IDS, world } from "./fakes/tools-world.mjs";

const PROVIDERS = providers();
const CONNECTION = { id: "ado-acme", provider: "azure-devops", organization: "acme", auth: { strategy: "azure-cli" } };
const DEV = "/fake/developer";
const DEV_PROFILE = `${DEV}/.azure`;
const ORBIT_PROFILE = "/fake/orbit/control/auth/azure-cli";
const NOW = 1_800_000_000_000;

// What the developer's own shell holds -- including a profile of theirs named outright, and the pins turned the other way.
const SHELL = { PATH: "/usr/bin:/opt/homebrew/bin", HOME: DEV, AZURE_CONFIG_DIR: DEV_PROFILE, AZURE_CORE_ENABLE_BROKER_ON_WINDOWS: "true", AZURE_CORE_ENCRYPT_TOKEN_CACHE: "true", AZURE_EXTENSION_DIR: `${DEV_PROFILE}/cliextensions`, AZURE_DEVOPS_EXT_PAT: "a-personal-access-token", HTTPS_PROXY: "http://proxy.example:3128" };

const A = { name: "dev-A", tenant: "tenant-a" };
const B = { name: "orbit-B", tenant: "tenant-b" };

const spawnShape = (r) => ({ status: r.status ?? (r.ok ? 0 : 1), stdout: r.out, stderr: r.err, ...(r.unstarted ? { error: { code: "ENOENT" } } : {}) });

// The whole chain, on a machine where `az` is where `where` says -- every process, a probe included, goes to the fake.
function chain({ where = {}, developer = A, people = [B], privateAt = null } = {}) {
  const az = createFakeAz({ parentEnv: SHELL, developer, people });
  const w = world({ system: where.system ?? null, privateAt });
  w.ctx.env = SHELL;
  w.ctx.rooms = { ...w.ctx.rooms, authSessions: "/fake/orbit/control/auth" };
  w.ctx.run = (file, args, options) => spawnShape(az.process.run(file, args, options));
  const tools = { ensure: (ids) => ensureOne(ids, w.ctx), find: (ids) => findOne(ids, w.ctx) };
  const adapter = azureCliAdapter({ tools, process: az.process, io: az.io, nowMs: () => NOW, next: { signIn: () => "sign in" } });
  const auth = createAuth({ secrets: {}, adapters: { "azure-cli": adapter }, providers: PROVIDERS, nowMs: () => NOW });
  return { az, w, auth, calls: () => az.state.calls, done: () => w.done() };
}

const SYSTEM = { path: "/opt/homebrew/bin/az", version: "2.85.0" };
const touchedDeveloper = (c) => c.calls().filter((call) => call.configDir === DEV_PROFILE);

test("1. the developer's Azure profile is ignored: every process Orbit starts -- a probe, a sign-in, a token -- is given Orbit's own AZURE_CONFIG_DIR, and nothing refers to the developer's", async () => {
  const c = chain({ where: { system: SYSTEM } });
  await c.auth.resolve(CONNECTION, { notify: () => {} }).headers();
  const sessions = c.calls().filter((call) => call.argv[0] !== "--version");
  assert.ok(sessions.length >= 2, "a sign-in and a token");
  for (const call of sessions) assert.equal(call.env.AZURE_CONFIG_DIR, ORBIT_PROFILE, `${call.argv[0]}: the profile is exactly Orbit's`);
  for (const call of c.calls()) {
    assert.notEqual(call.env.AZURE_CONFIG_DIR, DEV_PROFILE, "the developer's AZURE_CONFIG_DIR is never handed on");
    assert.equal(JSON.stringify([call.argv, Object.values(call.env)]).includes(DEV_PROFILE), false, `${call.argv[0]}: nothing refers to ${DEV_PROFILE}`);
    assert.equal(Object.keys(call.env).filter((k) => k.startsWith("AZURE_") && !/^AZURE_(CONFIG_DIR|CORE_[A-Z0-9_]+)$/.test(k)).length, 0, "no other AZURE_ variable of the developer's");
    assert.equal(call.env.AZURE_DEVOPS_EXT_PAT, undefined);
  }
  assert.deepEqual(touchedDeveloper(c), [], "the developer's profile was never the profile of any call");
  c.done();
});

test("2. an existing system login is not reused: the developer is signed in, Orbit is not -- so Orbit says it is not, and signs in itself", async () => {
  const c = chain({ where: { system: SYSTEM } });
  assert.equal((await c.auth.status(CONNECTION)).state, "sign-in-required", "the developer's session does not make Orbit consider itself signed in");
  const refused = await c.auth.resolve(CONNECTION, { interactive: "never" }).headers().catch((e) => e);
  assert.equal(refused.code, "AUTH_LOGIN_REQUIRED");
  assert.equal(c.calls().some((call) => call.argv[0] === "get-access-token" || call.argv[1] === "get-access-token"), false, "no token was ever asked of a profile nobody signed in to");
  const header = await c.auth.resolve(CONNECTION, { notify: () => {} }).headers();
  assert.equal(c.calls().some((call) => call.argv[0] === "login"), true, "Orbit performs the login");
  assert.match(header.Authorization, /^Bearer tok\.orbit-B\./, "and the token is Orbit's account's, never the developer's");
  c.done();
});

test("3. Orbit's login does not touch the developer's: after it, theirs is byte for byte what it was", async () => {
  const c = chain({ where: { system: SYSTEM } });
  const before = c.az.snapshotOf(DEV_PROFILE);
  await c.auth.resolve(CONNECTION, { notify: () => {} }).headers();
  await c.auth.resolve(CONNECTION, {}).headers();
  assert.equal(c.az.snapshotOf(DEV_PROFILE), before);
  assert.equal(c.az.state.profiles.get(ORBIT_PROFILE).account.name, "orbit-B", "and Orbit's holds its own");
  c.done();
});

test("4. accounts are not mixed: the developer's is A, Orbit's is B; Orbit's tokens are B's, and nothing ever changes the developer's account or subscription", async () => {
  const c = chain({ where: { system: SYSTEM } });
  const headers = await Promise.all([1, 2, 3].map(() => c.auth.resolve(CONNECTION, { notify: () => {} }).headers()));
  for (const h of headers) assert.match(h.Authorization, /orbit-B/);
  assert.equal(c.az.state.issued.every((t) => t.includes("orbit-B")), true, "not one token was ever issued for the developer's account");
  assert.equal(c.calls().flatMap((call) => call.wrote).includes("account"), false, "no `az account set`, ever");
  assert.equal(c.az.state.profiles.get(DEV_PROFILE).account.name, "dev-A");
  c.done();
});

test("5. disconnecting Orbit signs out of Orbit's session only: the developer stays signed in", async () => {
  const c = chain({ where: { system: SYSTEM } });
  await c.auth.resolve(CONNECTION, { notify: () => {} }).headers();
  assert.equal((await c.auth.signOut(CONNECTION)).state, "sign-in-required");
  assert.equal(c.az.state.profiles.get(ORBIT_PROFILE).account, null);
  assert.equal(c.az.state.profiles.get(DEV_PROFILE).account.name, "dev-A", "their login survives");
  assert.deepEqual(c.calls().filter((call) => call.argv[0] === "logout").map((call) => call.configDir), [ORBIT_PROFILE], "the logout was run against Orbit's profile and no other");
  c.done();
});

test("6. configuration is Orbit's own: no `config set`, no extension, no subscription change is ever made, and every write is under Orbit's directory", async () => {
  const c = chain({ where: { system: SYSTEM } });
  await c.auth.resolve(CONNECTION, { notify: () => {} }).headers();
  await c.auth.signOut(CONNECTION);
  const written = c.calls().filter((call) => call.wrote.length);
  assert.ok(written.length > 0, "the sign-in and the sign-out did write");
  assert.deepEqual([...new Set(written.map((call) => call.configDir))], [ORBIT_PROFILE]);
  assert.deepEqual([...new Set(written.flatMap((call) => call.wrote))].sort(), ["session"], "only a session: no config, no extension, no account");
  c.done();
});

test("7. runtime isolation: when Orbit has its own copy of the CLI and the machine has one too, Orbit's own is the one that runs", async () => {
  const c = chain({ where: { system: SYSTEM }, privateAt: { id: "azure-cli-private" } });
  await c.auth.resolve(CONNECTION, { notify: () => {} }).headers();
  const sessions = c.calls().filter((call) => call.configDir === ORBIT_PROFILE);
  for (const call of sessions) assert.equal(call.file.includes("azure-cli-private"), true, "the private runtime");
  assert.equal(c.calls().some((call) => call.file === SYSTEM.path && call.configDir === ORBIT_PROFILE), false, "the machine's program is not what ran");
  c.done();
});

test("8. a program on the machine is a PROGRAM only: with no copy of its own, Orbit runs the machine's `az` -- and still in its own profile, leaving the developer's alone", async () => {
  const c = chain({ where: { system: SYSTEM } });
  await c.auth.resolve(CONNECTION, { notify: () => {} }).headers();
  const session = c.calls().filter((call) => call.configDir === ORBIT_PROFILE);
  assert.ok(session.length >= 2);
  for (const call of session) assert.equal(call.file, SYSTEM.path);
  assert.deepEqual(touchedDeveloper(c), []);
  assert.equal(c.az.state.profiles.get(DEV_PROFILE).account.name, "dev-A");
  c.done();
});

test("looking is not signing in: asking what is installed and who is signed in creates no session directory, and every probe runs in a scratch profile of its own", async () => {
  const c = chain({ where: { system: SYSTEM } });
  const found = findOne(IDS, c.w.ctx);
  assert.equal(found.found.id, "azure-cli");
  assert.equal(c.az.state.dirs.has(ORBIT_PROFILE), false, "a read creates no state");
  assert.equal((await c.auth.status(CONNECTION)).state, "sign-in-required");
  assert.equal(c.az.state.dirs.has(ORBIT_PROFILE), false, "not even asking who is signed in");
  for (const call of c.calls()) assert.notEqual(call.configDir, DEV_PROFILE);
  assert.ok(c.calls().every((call) => call.configDir === "/scratch/0"), "probes only, and each in a scratch profile");
  c.done();
});

// ---- the pins do real work: remove one and the fake LEAKS -------------------------------------------------------------

const row = (id) => CATALOG.find((r) => r.id === id);

const without = (r, pin) => ({ ...r, launch: { ...r.launch, env: Object.fromEntries(Object.entries(r.launch.env).filter(([k]) => k !== pin)), platformEnv: { win32: Object.fromEntries(Object.entries(r.launch.platformEnv.win32).filter(([k]) => k !== pin)), posix: Object.fromEntries(Object.entries(r.launch.platformEnv.posix).filter(([k]) => k !== pin)) } } });

function launcherFor(r, { platform, authSessions, parent }) {
  const found = { launch: { file: "/orbit/az", args: ["-IBm", "azure.cli"] }, source: "orbit-managed" };
  return launcherOf(r, found, { platform, env: parent, rooms: { authSessions }, scratch: () => ({ dir: "/scratch", dispose: () => {} }), windowsMounts: [] }, "session");
}

test("pin: the Windows broker. Left on, a profile of Orbit's own is not one: its session is the OS user's, so Orbit would find -- and could sign out -- the developer's. With the pin, it is Orbit's alone", () => {
  const home = "C:\\Users\\dev";
  const parent = { PATH: "C:\\Windows", USERPROFILE: home };
  const orbit = "C:\\fake\\orbit\\control\\auth";
  for (const [label, r, leaks] of [["unpinned", without(row("azure-cli-private-win"), "AZURE_CORE_ENABLE_BROKER_ON_WINDOWS"), true], ["pinned", row("azure-cli-private-win"), false]]) {
    const az = createFakeAz({ platform: "win32", home, parentEnv: parent, people: [B] });
    az.state.broker.account = A;
    const l = launcherFor(r, { platform: "win32", authSessions: orbit, parent });
    const seen = az.process.run(l.file, [...l.args, "account", "show"], { env: l.env });
    assert.equal(seen.ok, leaks, `${label}: does Orbit see the developer's broker session?`);
    az.process.run(l.file, [...l.args, "logout"], { env: l.env });
    assert.equal(az.state.broker.account === null, leaks, `${label}: did Orbit's logout take the developer's account with it?`);
  }
});

test("pin: the OS keystore. Where a release makes it the default, every profile shares one entry with fixed names; pinned off, the session is a file in Orbit's profile", () => {
  const parent = { PATH: "/usr/bin", HOME: DEV };
  for (const [label, r, leaks] of [["unpinned", without(row("azure-cli-private"), "AZURE_CORE_ENCRYPT_TOKEN_CACHE"), true], ["pinned", row("azure-cli-private"), false]]) {
    const az = createFakeAz({ platform: "darwin", home: DEV, parentEnv: parent, keystoreByDefault: true, people: [B] });
    az.state.keystore.account = A;
    const l = launcherFor(r, { platform: "darwin", authSessions: "/fake/orbit/control/auth", parent });
    assert.equal(az.process.run(l.file, [...l.args, "account", "show"], { env: l.env }).ok, leaks, label);
  }
});

test("a launcher with no environment WOULD use the developer's profile: the fake is honest, so the tests above can fail", () => {
  const az = createFakeAz({ parentEnv: { PATH: "/usr/bin", HOME: DEV }, developer: A });
  const seen = az.process.run("/opt/homebrew/bin/az", ["account", "show"], {});
  assert.deepEqual([seen.ok, az.state.calls[0].configDir], [true, DEV_PROFILE]);
});

test("a probe runs from its own scratch profile, never from a shared directory, and a session command from the profile", async () => {
  const c = chain({ where: { system: SYSTEM } });
  await c.auth.resolve(CONNECTION, { notify: () => {} }).headers();
  for (const call of c.calls()) assert.equal(call.cwd, call.configDir, `${call.argv[0]}: the directory it runs from is the profile it was given`);
  c.done();
});
