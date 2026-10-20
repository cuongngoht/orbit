// Orbit-MANAGED MCP, end to end over a real temporary machine store: a remote
// HTTP server added with no install at all, a stdio server with a private
// runtime placed in the store, the host's own servers kept external -- and the
// two things this design is FOR: the plugin directory is replaced, or the store
// is moved, and nothing a person set up goes with it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Blocked, Refused } from "../src/errors.mjs";
import { mcpCatalog } from "../src/mcp/catalog.mjs";
import { BASE_ENV, baseEnv } from "../src/process/env.mjs";
import { probeManaged, resolvedDefinition } from "../src/mcp/connect.mjs";
import { effectiveMcp } from "../src/mcp/effective.mjs";
import { installMcp, mcpArchiveInstaller, remoteHttpInstaller, removeRuntime } from "../src/mcp/install.mjs";
import { addCustom, addFromCatalog, recordCheck, removeManaged, setEnabled } from "../src/mcp/manage.mjs";
import { envSecrets } from "../src/secrets.mjs";
import { createMcpState, observedAs } from "../src/mcp/state.mjs";
import { relativeInside } from "../src/project/boundary.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { realIo } from "../src/store/io.mjs";
import { realInstallIo } from "../src/tools/real.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const AT = "2026-09-24T08:00:00.000Z";
const NOW = Date.parse(AT) + 60_000;
const ARCHIVE = Buffer.from("company-docs 1.2.0, as far as this suite is concerned");
const SHA = createHash("sha256").update(ARCHIVE).digest("hex");
const INSTALLERS = { [remoteHttpInstaller.strategy]: remoteHttpInstaller, [mcpArchiveInstaller.strategy]: mcpArchiveInstaller };

// The repository's own catalog, plus one stdio server with a pinned runtime.
function catalogData() {
  const repo = JSON.parse(readFileSync(join(REPO, "catalog", "mcp.json"), "utf8"));
  const asset = (platform) => ({ url: `https://example.test/company-docs-1.2.0-${platform}.tgz`, sha256: SHA, format: "tar.gz", entrypoint: "bin/server.js" });
  const docs = { id: "company-docs", name: "Company docs", description: "the company's documentation", recommended: true, definition: { transport: "stdio", commandRef: "managed-runtime", args: ["--stdio"], requiredEnv: ["DOCS_TOKEN"] }, install: { strategy: "archive", version: "1.2.0", launch: "node", assets: { "linux-x64": asset("linux-x64"), "win32-x64": asset("win32-x64") } }, provides: ["documentation.search", "documentation.company"] };
  return { ...repo, servers: [...repo.servers, docs] };
}

function world(t, { pluginRoot, base } = {}) {
  const root = base ?? mkdtempSync(join(tmpdir(), "orbit-managed-"));
  if (!base) t.after(() => rmSync(root, { recursive: true, force: true }));
  const plugin = pluginRoot ?? join(root, "plugin");
  if (!pluginRoot) writeCatalog(plugin, catalogData());
  const rooms = stateRooms(join(root, "store"));
  const catalog = mcpCatalog(JSON.parse(readFileSync(join(plugin, "catalog", "mcp.json"), "utf8")));
  const state = createMcpState(rooms, realIo());
  return { root, plugin, rooms, catalog, state, ctx: { state, catalog, now: () => AT } };
}

function writeCatalog(plugin, data) {
  mkdirSync(join(plugin, "catalog"), { recursive: true });
  writeFileSync(join(plugin, "catalog", "mcp.json"), JSON.stringify(data));
}

const effective = (w, env = {}) => Object.fromEntries(effectiveMcp({ catalog: w.catalog, state: w.state.all(), receipts: w.state.receipts(), secrets: envSecrets(env), now: NOW, platform: "linux", arch: "x64", exists: existsSync, rooms: w.rooms, installers: INSTALLERS }).map((e) => [e.key, e]));

const installIo = (over = {}) => ({ ...realInstallIo(), download: async () => over.bytes ?? ARCHIVE, unpack: over.unpack ?? unpackServer });

function unpackServer(bytes, asset, tmp) {
  const into = join(tmp, "unpacked");
  mkdirSync(join(into, "bin"), { recursive: true });
  writeFileSync(join(into, "bin", "server.js"), "// the company-docs MCP server\n");
  return into;
}

const install = (w, id, over = {}) => installMcp(w.catalog.find((e) => e.id === id), { installers: INSTALLERS, platform: "linux", arch: "x64", rooms: w.rooms, state: w.state, io: installIo(over), exists: existsSync, now: () => AT });

const connectCtx = (w, env = {}) => ({ secrets: envSecrets(env), rooms: w.rooms, receipts: w.state.receipts(), catalog: w.catalog, exists: existsSync, platform: "linux", arch: "x64", node: "/opt/node/bin/node", now: () => AT });

const files = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)])) : []);

// ---- remote HTTP: Microsoft Learn ----------------------------------------------------

test("Add Microsoft Learn to Orbit: a managed record in the machine store, NO binary installed, and ready", async (t) => {
  const w = world(t);
  const record = addFromCatalog(w.ctx, "microsoft-learn");
  assert.deepEqual([record.origin, record.catalog, record.definition], ["catalog", "microsoft-learn", { transport: "http", url: "https://learn.microsoft.com/api/mcp", requiredHeaders: [] }]);
  assert.equal(await install(w, "microsoft-learn"), null, "remote-http installs nothing and writes no receipt");
  assert.equal(existsSync(w.rooms.mcpRuntimes), false, "nothing pretends it has a binary");
  const learn = effective(w)["managed:microsoft-learn"];
  assert.deepEqual([learn.ownership, learn.runtime.kind, learn.runtimeReady, learn.state, learn.eligible, learn.status, learn.install.strategy], ["orbit-managed", "remote", true, "ready", true, "unknown", "remote-http"]);
  assert.throws(() => addFromCatalog(w.ctx, "microsoft-learn"), /already manages/);
  assert.throws(() => addFromCatalog(w.ctx, "github"), /recommends no MCP server named github/, "a recognition-only row cannot be added");
});

test("Test Connection keeps a verdict under the MANAGED key; a refusal makes it needs-attention; disable takes it out of reach", async (t) => {
  const w = world(t);
  addFromCatalog(w.ctx, "microsoft-learn");
  const record = w.state.read("managed").servers["microsoft-learn"];
  const seen = [];
  const probe = async (def) => (seen.push(def), { status: "connected", checkedAt: new Date(NOW - 1000).toISOString(), reason: null, tools: [{ name: "microsoft_docs_search", description: "Search" }] });
  recordCheck(w.ctx, "managed:microsoft-learn", await probeManaged(record, connectCtx(w), probe));
  assert.deepEqual(seen, [{ transport: "http", url: "https://learn.microsoft.com/api/mcp", headers: [] }]);
  assert.deepEqual([effective(w)["managed:microsoft-learn"].status, effective(w)["managed:microsoft-learn"].toolCount], ["connected", 1]);
  recordCheck(w.ctx, "managed:microsoft-learn", { status: "needs-auth", checkedAt: new Date(NOW - 1000).toISOString(), reason: "the server answered 401" });
  assert.deepEqual([effective(w)["managed:microsoft-learn"].runtimeReady, effective(w)["managed:microsoft-learn"].state], [false, "needs-attention"]);
  recordCheck(w.ctx, "managed:microsoft-learn", { status: "connected", checkedAt: new Date(NOW - 1000).toISOString() });
  setEnabled(w.ctx, "microsoft-learn", false);
  assert.deepEqual([effective(w)["managed:microsoft-learn"].enabled, effective(w)["managed:microsoft-learn"].eligible, effective(w)["managed:microsoft-learn"].state], [false, false, "disabled"]);
});

test("a secret is NAMED, read from the environment when connecting, and never written anywhere", async (t) => {
  const w = world(t);
  addCustom(w.ctx, { id: "corp-docs", transport: "http", url: "https://docs.corp.example/mcp", requiredHeaders: [{ name: "Authorization", env: "CORP_DOCS_AUTH" }], provides: ["documentation.search"] });
  const unset = effective(w)["managed:corp-docs"];
  assert.deepEqual([unset.state, unset.runtimeReady, unset.why, unset.definition.requiredHeaders], ["needs-attention", false, "CORP_DOCS_AUTH is not set in this environment", [{ name: "Authorization", env: "CORP_DOCS_AUTH", set: false }]]);
  const record = w.state.read("managed").servers["corp-docs"];
  assert.deepEqual(await probeManaged(record, connectCtx(w), () => assert.fail("nothing is reached without its secret")), { status: "needs-auth", checkedAt: AT, reason: "CORP_DOCS_AUTH is not set in this environment, so corp-docs was not connected to", tools: null });
  const env = { CORP_DOCS_AUTH: "Bearer sk-live-corp-9999" };
  assert.equal(effective(w, env)["managed:corp-docs"].state, "ready");
  assert.deepEqual(resolvedDefinition(record, connectCtx(w, env)).headers, [{ name: "Authorization", value: "Bearer sk-live-corp-9999" }]);
  for (const f of files(w.root)) assert.equal(readFileSync(f, "utf8").includes("sk-live-corp"), false, f);
});

// ---- stdio: a private runtime in the machine store ---------------------------------------

test("a stdio server's runtime is installed PRIVATELY into <store>/runtimes/mcp, verified, and its receipt written LAST", async (t) => {
  const w = world(t);
  addFromCatalog(w.ctx, "company-docs");
  assert.equal(effective(w)["managed:company-docs"].state, "not-installed");
  const receipt = await install(w, "company-docs");
  const final = join(w.rooms.mcpRuntimes, "company-docs", "1.2.0-linux-x64");
  assert.ok(existsSync(join(final, "bin", "server.js")));
  assert.deepEqual([receipt.mcp, receipt.version, receipt.home, receipt.dir, receipt.entrypoint, receipt.checksum, receipt.reused], ["company-docs", "1.2.0", "mcpRuntimes", join("company-docs", "1.2.0-linux-x64"), "bin/server.js", `sha256:${SHA}`, false]);
  assert.equal(readFileSync(join(w.rooms.mcpReceipts, "company-docs-1.2.0-linux-x64.json"), "utf8").includes(w.root), false, "relative only");
  assert.deepEqual(readdirSync(join(w.rooms.mcpRuntimes, "company-docs")), ["1.2.0-linux-x64"], "no staging directory left behind");
  assert.deepEqual([effective(w, { DOCS_TOKEN: "t" })["managed:company-docs"].runtimeReady, effective(w, { DOCS_TOKEN: "t" })["managed:company-docs"].runtime.receipt.verified], [true, true]);
  assert.equal((await install(w, "company-docs")).reused, true, "a runtime already in place is reused");
});

test("a failed install leaves NO receipt and nothing where detection looks", async (t) => {
  const w = world(t);
  addFromCatalog(w.ctx, "company-docs");
  await assert.rejects(install(w, "company-docs", { bytes: Buffer.from("tampered") }), (e) => e instanceof Blocked && /SHA-256/.test(e.message));
  await assert.rejects(install(w, "company-docs", { unpack: (b, a, tmp) => (mkdirSync(join(tmp, "unpacked")), join(tmp, "unpacked")) }), (e) => e instanceof Blocked && /has no bin\/server\.js/.test(e.message));
  assert.deepEqual([w.state.receipts(), existsSync(join(w.rooms.mcpRuntimes, "company-docs", "1.2.0-linux-x64"))], [[], false]);
  await assert.rejects(installMcp(w.catalog.find((e) => e.id === "company-docs"), { installers: INSTALLERS, platform: "sunos", arch: "x64", rooms: w.rooms, state: w.state }), (e) => e instanceof Refused && /no verified build/.test(e.message));
});

test("a receipt is not proof: its runtime deleted by hand, the server is not-installed and nothing is started", async (t) => {
  const w = world(t);
  addFromCatalog(w.ctx, "company-docs");
  await install(w, "company-docs");
  rmSync(join(w.rooms.mcpRuntimes, "company-docs"), { recursive: true, force: true });
  const docs = effective(w, { DOCS_TOKEN: "t" })["managed:company-docs"];
  assert.deepEqual([docs.state, docs.runtimeReady, docs.runtime.receipt.verified], ["not-installed", false, false]);
  assert.match(docs.why, /no longer in the machine store/);
  assert.throws(() => resolvedDefinition(w.state.read("managed").servers["company-docs"], connectCtx(w, { DOCS_TOKEN: "t" })), /no longer in the machine store/);
});

test("the child is started from the receipt's runtime with argv, and sees only the variables it declared -- not the rest of this environment", async (t) => {
  const w = world(t);
  addFromCatalog(w.ctx, "company-docs");
  await install(w, "company-docs");
  const env = { DOCS_TOKEN: "docs-t", OTHER_SECRET: "must-not-reach-the-child", PATH: "/usr/bin" };
  const def = resolvedDefinition(w.state.read("managed").servers["company-docs"], connectCtx(w, env));
  assert.deepEqual([def.command, def.args], ["/opt/node/bin/node", [join(w.rooms.mcpRuntimes, "company-docs", "1.2.0-linux-x64", "bin", "server.js"), "--stdio"]]);
  assert.deepEqual(def.env, [{ name: "DOCS_TOKEN", value: "docs-t" }]);
  const childEnv = { ...baseEnv(env), ...Object.fromEntries(def.env.map((p) => [p.name, p.value])) };
  assert.deepEqual(childEnv, { PATH: "/usr/bin", DOCS_TOKEN: "docs-t" });
  assert.ok(BASE_ENV.includes("SystemRoot") && BASE_ENV.includes("Path"), "what a Windows child needs to start at all");
});

test("cross-platform: a receipt's directory may use either separator, and never climbs out", () => {
  for (const ok of ["company-docs/1.2.0-linux-x64", "company-docs\\1.2.0-win32-x64", "bin/server.js", "server.exe"]) assert.equal(relativeInside(ok), true, ok);
  for (const bad of ["../x", "a/../../x", "a\\..\\x", "/abs", "\\abs", "C:\\abs", "c:/abs", ""]) assert.equal(relativeInside(bad), false, bad);
});

// ---- external stays external -----------------------------------------------------------------

test("a host server is observed into external.json, separately, never eligible -- and never overwrites the managed one of the same name", (t) => {
  const w = world(t);
  addFromCatalog(w.ctx, "microsoft-learn");
  w.state.change("external", (doc) => observedAs(doc, "claude", [{ id: "microsoft-learn", name: "microsoft-learn", host: "claude", scope: "user", transport: "http", url: "https://learn.microsoft.com/api/mcp", headers: [], env: [], args: [], hostEnabled: true, status: "unknown" }], AT));
  assert.equal(JSON.parse(readFileSync(join(w.rooms.mcp, "external.json"), "utf8")).servers[0].id, "microsoft-learn");
  const all = effective(w);
  assert.deepEqual([all["external:microsoft-learn"].ownership, all["external:microsoft-learn"].runtimeReady, all["external:microsoft-learn"].enabled, all["external:microsoft-learn"].eligible], ["external", true, false, false]);
  assert.deepEqual([all["managed:microsoft-learn"].ownership, all["managed:microsoft-learn"].eligible], ["orbit-managed", true]);
  assert.equal(w.state.read("managed").servers["microsoft-learn"].origin, "catalog", "the observation touched nothing Orbit owns");
});

// ---- upgrades and moves ----------------------------------------------------------------------------

test("UPGRADE SURVIVAL: the plugin directory is replaced, a new plugin reads the same store, and every managed server is still there", async (t) => {
  const a = world(t);
  addFromCatalog(a.ctx, "microsoft-learn");
  addFromCatalog(a.ctx, "company-docs");
  addCustom(a.ctx, { id: "corp-docs", transport: "http", url: "https://docs.corp.example/mcp", provides: ["documentation.search"] });
  await install(a, "company-docs");
  const pluginB = join(a.root, "plugin-b");
  const data = catalogData();
  data.servers.find((s) => s.id === "microsoft-learn").description = "Microsoft Learn, as plugin B describes it";
  writeCatalog(pluginB, data);
  rmSync(a.plugin, { recursive: true, force: true });
  const b = world(t, { pluginRoot: pluginB, base: a.root });
  const all = effective(b, { DOCS_TOKEN: "t" });
  assert.deepEqual(["managed:microsoft-learn", "managed:company-docs", "managed:corp-docs"].map((k) => [k, all[k].state]), [["managed:microsoft-learn", "ready"], ["managed:company-docs", "ready"], ["managed:corp-docs", "ready"]]);
  assert.equal(all["managed:microsoft-learn"].description, "Microsoft Learn, as plugin B describes it", "the NEW catalog's words");
  assert.equal(all["managed:company-docs"].runtime.receipt.version, "1.2.0", "the runtime is found again, not reinstalled");
  for (const f of files(join(a.root, "store"))) assert.equal(readFileSync(f, "utf8").includes(a.plugin), false, `${f} names the old plugin directory`);
});

test("STORE MOVE: copy the store somewhere else, and every runtime location is re-derived from the new place", async (t) => {
  const a = world(t);
  addFromCatalog(a.ctx, "company-docs");
  await install(a, "company-docs");
  const moved = mkdtempSync(join(tmpdir(), "orbit-moved-"));
  t.after(() => rmSync(moved, { recursive: true, force: true }));
  cpSync(join(a.root, "store"), join(moved, "store"), { recursive: true });
  cpSync(a.plugin, join(moved, "plugin"), { recursive: true });
  rmSync(join(a.root, "store"), { recursive: true, force: true });
  const b = world(t, { pluginRoot: join(moved, "plugin"), base: moved });
  assert.equal(effective(b, { DOCS_TOKEN: "t" })["managed:company-docs"].runtimeReady, true);
  assert.ok(resolvedDefinition(b.state.read("managed").servers["company-docs"], connectCtx(b, { DOCS_TOKEN: "t" })).args[0].startsWith(join(moved, "store")));
});

// ---- removal ---------------------------------------------------------------------------------------

test("Remove from Orbit keeps the runtime; deleting runtime files is a second act, and only inside runtimes/mcp", async (t) => {
  const w = world(t);
  addFromCatalog(w.ctx, "company-docs");
  await install(w, "company-docs");
  assert.deepEqual(removeManaged(w.ctx, "company-docs"), { id: "company-docs", removed: true });
  assert.equal(existsSync(join(w.rooms.mcpRuntimes, "company-docs")), true, "removing the record is not deleting files");
  assert.deepEqual(removeRuntime("company-docs", { rooms: w.rooms, state: w.state, io: realIo() }), { removed: true, receipts: 1 });
  assert.deepEqual([existsSync(join(w.rooms.mcpRuntimes, "company-docs")), w.state.receipts()], [false, []]);
  assert.throws(() => removeRuntime("../../victim", { rooms: w.rooms, state: w.state, io: realIo() }), Refused);
});

test("a runtime directory that is a symlink out of the store is refused, and what it points at survives", (t) => {
  const w = world(t);
  const victim = join(w.root, "victim");
  mkdirSync(victim, { recursive: true });
  writeFileSync(join(victim, "keep.txt"), "keep");
  mkdirSync(w.rooms.mcpRuntimes, { recursive: true });
  try { symlinkSync(victim, join(w.rooms.mcpRuntimes, "evil"), process.platform === "win32" ? "junction" : "dir"); }
  catch { return t.skip("this machine will not make a symlink"); }
  assert.throws(() => removeRuntime("evil", { rooms: w.rooms, state: w.state, io: realIo() }), Refused);
  assert.equal(readFileSync(join(victim, "keep.txt"), "utf8"), "keep");
});
