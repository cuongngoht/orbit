// ENSURE (src/tools/ensure.mjs): how a need for the Azure CLI is met, in the order the spec lists it --
//   1. a private runtime Orbit already installed   2. a program on this machine, verified (a binary only)
//   3. otherwise a private runtime Orbit installs itself   4. otherwise BLOCKED, naming every candidate
// -- and the gate that keeps (3) to a pinned archive or lock, never a package manager.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authorize, isAuto } from "../src/protected/authorize.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { realIo } from "../src/store/io.mjs";
import { assetFor, toolCatalog } from "../src/tools/catalog.mjs";
import { AUTONOMOUS_STRATEGIES, ToolBlocked, ensureOne, findOne } from "../src/tools/ensure.mjs";
import { createToolState, receiptPath } from "../src/tools/state.mjs";

const REPO = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const CATALOG = toolCatalog(JSON.parse(readFileSync(join(REPO, "catalog", "tools.json"), "utf8")));
const IDS = ["azure-cli-private", "azure-cli-private-win", "azure-cli"];
const AZ = (v) => ({ status: 0, stdout: `azure-cli                         ${v}\n`, stderr: "" });
const PY = { status: 0, stdout: "Python 3.13.15\n", stderr: "" };

// A machine: what is on PATH, what answers, and installers that do what a real one does -- put a runtime where its
// receipt says, and make it answer -- while recording what they were asked to do.
// A private runtime that was installed before: its receipt, and a binary that answers where the receipt says.
function known(id, { platform, arch, rooms, state, files, answers }) {
  const row = CATALOG.find((r) => r.id === id);
  const receipt = { tool: id, version: "2.91.0", platform, arch, home: "toolRuntimes", dir: `${id}/2.91.0-${platform}-${arch}`, bin: assetFor(row, platform, arch).bin };
  state.saveReceipt(receipt);
  files.add(receiptPath(rooms, receipt, platform));
  answers[receiptPath(rooms, receipt, platform)] = AZ("2.91.0");
}

function world({ platform = "linux", arch = "x64", system = null, privateAt = null, failInstall = null, silentInstall = null, catalog = CATALOG } = {}) {
  const base = mkdtempSync(join(tmpdir(), "orbit-ensure-"));
  const rooms = stateRooms(base);
  const files = new Set();
  const answers = {};
  const installs = [];
  const state = createToolState(rooms, realIo());
  if (system) (files.add(system.path), (answers[system.path] = AZ(system.version)));
  const place = (entry, ctx, file) => {
    const dir = `${entry.id}/${entry.install.version}-${ctx.platform}-${ctx.arch}`;
    const bin = (assetFor(entry, ctx.platform, ctx.arch) ?? {}).bin ?? "bin";
    const path = receiptPath(rooms, { home: "toolRuntimes", dir, bin }, ctx.platform);
    if (silentInstall !== entry.id) (files.add(path), (answers[path] = file));
    return { version: entry.install.version, home: "toolRuntimes", dir, bin, checksum: "sha256:0", source: "test" };
  };
  const supports = (e, p, a) => (assetFor(e, p, a) ? null : `no verified build of ${e.name} is pinned for ${p}-${a}`);
  const installers = {
    archive: { strategy: "archive", supports, install: async (entry, ctx) => (installs.push(entry.id), failInstall === entry.id ? Promise.reject(new Error("the download was refused")) : place(entry, ctx, entry.id === "python" ? PY : AZ(entry.install.version))) },
    "python-lock": { strategy: "python-lock", supports, install: async (entry, ctx) => (await ctx.ensurePython(entry.install.python), installs.push(entry.id), failInstall === entry.id ? Promise.reject(new Error("pip refused")) : place(entry, ctx, AZ(entry.install.version))) },
  };
  const ctx = { platform, arch, env: { PATH: "/usr/bin" }, projectRoot: null, rooms, node: "/node", exists: (p) => files.has(p), read: () => "", run: (file) => answers[file] ?? { error: Object.assign(new Error("no"), { code: "ENOENT" }) }, scratch: () => ({ dir: "/scratch/0", dispose: () => {} }), now: () => "2026-10-29T00:00:00.000Z", state, catalog, installers, io: realIo(), windowsMounts: [] };
  if (privateAt) known(privateAt.id, { platform, arch, rooms, state, files, answers });
  return { ctx, installs, rooms, base, done: () => rmSync(base, { recursive: true, force: true }) };
}

test("a private runtime that is installed wins over the machine's own `az`, and nothing is installed", async () => {
  const w = world({ system: { path: "/usr/bin/az", version: "2.85.0" }, privateAt: { id: "azure-cli-private" } });
  const got = await ensureOne(IDS, w.ctx);
  assert.deepEqual([got.id, got.source, got.version, got.acquired, w.installs], ["azure-cli-private", "orbit-managed", "2.91.0", false, []]);
  assert.deepEqual(got.args, ["-IBm", "azure.cli"]);
  w.done();
});

test("with no private runtime, the machine's `az` is used as a PROGRAM -- verified, no download -- under Orbit's own profile", async () => {
  const w = world({ system: { path: "/usr/bin/az", version: "2.85.0" } });
  const got = await ensureOne(IDS, w.ctx);
  assert.deepEqual([got.id, got.source, got.version, got.acquired, w.installs], ["azure-cli", "system", "2.85.0", false, []]);
  const session = got.launcher("session");
  assert.equal(session.env.AZURE_CONFIG_DIR, join(w.rooms.authSessions, "azure-cli"), "the sign-in is Orbit's whatever program runs");
  assert.equal(session.file, "/usr/bin/az");
  w.done();
});

test("with neither, Orbit installs a private runtime of its own -- the interpreter first, then the locked environment -- and believes it only once it answers", async () => {
  const w = world();
  const got = await ensureOne(IDS, w.ctx);
  assert.deepEqual([got.id, got.source, got.acquired, w.installs], ["azure-cli-private", "orbit-managed", true, ["python", "azure-cli-private"]]);
  assert.equal(got.launcher("session").env.AZURE_CONFIG_DIR, join(w.rooms.authSessions, "azure-cli"), "the same profile a machine's az would have used");
  w.done();
});

test("each platform is served by the row that has a build for it: a ZIP on Windows x64, a lock on macOS and Linux", async () => {
  const expected = { "win32-x64": ["azure-cli-private-win", ["azure-cli-private-win"]], "darwin-arm64": ["azure-cli-private", ["python", "azure-cli-private"]], "darwin-x64": ["azure-cli-private", ["python", "azure-cli-private"]], "linux-x64": ["azure-cli-private", ["python", "azure-cli-private"]], "linux-arm64": ["azure-cli-private", ["python", "azure-cli-private"]] };
  for (const [key, [id, installs]] of Object.entries(expected)) {
    const [platform, arch] = key.split("-");
    const w = world({ platform, arch });
    const got = await ensureOne(IDS, w.ctx);
    assert.deepEqual([got.id, w.installs.filter((i) => i !== "python" || id === "azure-cli-private")], [id, installs.filter((i) => i !== "python" || id === "azure-cli-private")], key);
    w.done();
  }
});

test("Windows ARM64: Microsoft publishes no build, so there is no private runtime -- the machine's `az` or a blocked answer that says so, never an emulated guess", async () => {
  const none = world({ platform: "win32", arch: "arm64" });
  await assert.rejects(() => ensureOne(IDS, none.ctx), (e) => e instanceof ToolBlocked && e.code === "TOOL_UNSUPPORTED" && /no verified build of .* is pinned for win32-arm64/.test(e.message) && /Azure CLI \(Orbit's own copy\)/.test(e.message) && /Install the Azure CLI from/.test(e.message));
  assert.deepEqual(none.installs, [], "nothing was attempted");
  const some = world({ platform: "win32", arch: "arm64", system: { path: "C:\\az\\python.exe", version: "2.91.0" } });
  assert.equal(findOne(IDS, some.ctx).found, null, "(the fixture's `az` is not on this machine's PATH, so it is not found)");
  none.done();
  some.done();
});

test("a machine `az` older than the floor is found and not used: Orbit installs its own, and the refusal names the version", async () => {
  const w = world({ system: { path: "/usr/bin/az", version: "2.40.0" } });
  const seen = findOne(IDS, w.ctx);
  assert.equal(seen.found, null);
  assert.match(seen.tried.find((t) => t.id === "azure-cli").reason, /found 2\.40\.0, older than the 2\.61\.0 this needs/);
  assert.equal((await ensureOne(IDS, w.ctx)).id, "azure-cli-private");
  w.done();
});

test("looking never installs: `findOne` says what is ready and which row Orbit COULD install, and changes nothing", () => {
  const w = world();
  const seen = findOne(IDS, w.ctx);
  assert.deepEqual([seen.found, seen.acquirable, w.installs], [null, "azure-cli-private", []]);
  assert.equal(existsSync(w.rooms.toolRuntimes), false, "not even a directory was made");
  w.done();
});

test("an install that fails is a BLOCKED outcome with the reason, not a crash and not a half-install", async () => {
  const w = world({ failInstall: "azure-cli-private" });
  await assert.rejects(() => ensureOne(IDS, w.ctx), (e) => e instanceof ToolBlocked && e.code === "TOOL_INSTALL_FAILED" && /pip refused/.test(e.message));
  w.done();
});

test("an install that finishes but does not answer is never believed", async () => {
  const w = world({ silentInstall: "azure-cli-private" });
  await assert.rejects(() => ensureOne(IDS, w.ctx), (e) => e instanceof ToolBlocked && e.code === "TOOL_UNVERIFIED");
  w.done();
});

test("only a row that says it may be installed by Orbit, by a pinned archive or lock, is ever installed on Orbit's own initiative", async () => {
  assert.deepEqual(AUTONOMOUS_STRATEGIES, ["archive", "python-lock"]);
  assert.equal(isAuto(authorize({ kind: "tool.acquire", tool: "azure-cli-private" })), true, "no protected boundary holds an install into Orbit's own store");
  const manual = world();
  await assert.rejects(() => ensureOne(["azure-cli"], manual.ctx), (e) => e instanceof ToolBlocked && e.code === "TOOL_MISSING");
  assert.deepEqual(manual.installs, [], "a machine tool is never installed, however it is asked for");
  const odd = CATALOG.map((r) => (r.id === "azure-cli-private" ? { ...r, install: { ...r.install, strategy: "npm-global", autonomous: true } } : r.id === "azure-cli-private-win" ? { ...r, install: { ...r.install, autonomous: false } } : r));
  const w = world({ catalog: odd });
  await assert.rejects(() => ensureOne(IDS, w.ctx), ToolBlocked);
  assert.deepEqual(w.installs, [], "an unknown strategy, or a row that has not said it may, is never run");
  manual.done();
  w.done();
});

test("the interpreter a lock builds from is Orbit's own: a Python on PATH is never what an install is built from", async () => {
  const w = world({ system: { path: "/usr/bin/python3", version: "9" } });
  w.ctx.exists = ((e) => (p) => e(p) || p === "/usr/bin/python3")(w.ctx.exists);
  const run = w.ctx.run;
  w.ctx.run = (file, ...rest) => (file === "/usr/bin/python3" ? { status: 0, stdout: "Python 3.12.1\n", stderr: "" } : run(file, ...rest));
  const python = await ensureOne(["python"], w.ctx, ["orbit-managed"]);
  assert.deepEqual([python.source, python.acquired, w.installs], ["orbit-managed", true, ["python"]], "the system one was passed over and a private one installed");
  w.done();
});

test("nothing that routes a prompt or draws a list ever reaches `ensure`: it is an act, never an observation", () => {
  const walk = (dir) => readdirSync(join(REPO, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".mjs") ? [join(dir, e.name)] : []));
  const files = [...walk("src/routing"), ...walk("src/resources"), ...walk("src/help"), join("cli", "router-hook.mjs")];
  for (const f of files) assert.doesNotMatch(readFileSync(join(REPO, f), "utf8"), /tools\/ensure\.mjs|ensureOne/, f);
});
