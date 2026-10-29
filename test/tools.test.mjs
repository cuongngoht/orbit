// CLI tools: found in an explicit precedence, installed only on request, into
// the store and nowhere else, with a receipt -- and never half.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogFile, readCatalog } from "../src/catalog.mjs";
import { controlNodeDetector, nodeDistInstaller } from "../skills/orbit-control/tools.mjs";
import { Blocked, Refused } from "../src/errors.mjs";
import { archiveInstaller } from "../src/tools/archive.mjs";
import { toolCatalog } from "../src/tools/catalog.mjs";
import { detectionContext } from "../src/tools/context.mjs";
import { detectTool, newer, SOURCES, versionIn } from "../src/tools/detect.mjs";
import { observeSome, observeTools, onDemand } from "../src/tools/observe.mjs";
import { fakeIo } from "./fakes/io.mjs";
import { effectiveTools, OBSERVATION_TTL_MS } from "../src/tools/effective.mjs";
import { installTool } from "../src/tools/install.mjs";
import { realDetection, realInstallIo } from "../src/tools/real.mjs";
import { createToolState, receiptPath } from "../src/tools/state.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { realIo } from "../src/store/io.mjs";

const BYTES = Buffer.from("pretend this is sqlcmd-1.10.0.tar.bz2");
const SHA = createHash("sha256").update(BYTES).digest("hex");
const CATALOG = toolCatalog({ tools: [
  { id: "sqlcmd", name: "SQLCMD", provides: ["sqlserver.query"], detection: { commands: ["sqlcmd"], versionPattern: "Version:?\\s*v?(\\d+(?:\\.\\d+){1,3})" }, install: { strategy: "archive", version: "1.10.0", assets: { "linux-x64": { url: "https://example.test/sqlcmd.tar.bz2", sha256: SHA, format: "tar.bz2", bin: "sqlcmd" }, "win32-x64": { url: "https://example.test/sqlcmd.zip", sha256: SHA, format: "zip", bin: "sqlcmd.exe" }, "bad-pin": { url: "http://insecure", sha256: SHA, format: "zip", bin: "x" } } } },
  { id: "playwright", name: "Playwright CLI", provides: ["browser.automation"], detection: { commands: ["playwright-cli"], project: true }, install: { strategy: "manual", instructions: "npm i -g @playwright/cli" } },
  { id: "git", name: "Git", provides: ["source-control"], detection: { commands: ["git"], versionPattern: "git version (\\d+\\.\\d+\\.\\d+)" }, install: { strategy: "manual", instructions: "install git" } },
] });
const tool = (id) => CATALOG.find((t) => t.id === id);

function detection({ files = [], versions = {}, platform = "linux", env = { PATH: "/usr/bin:/opt/bin" }, projectRoot = "/work/app", receipts = [], rooms = stateRooms("/store"), read = () => "" } = {}) {
  const ran = [];
  const run = (file, args) => (ran.push([file, ...args]), versions[file] instanceof Error ? { error: versions[file] } : { status: 0, stdout: versions[file] ?? "", stderr: "" });
  // A probe of a tool that keeps identity state is given a directory made for it and removed after (src/tools/launch.mjs).
  const scratch = () => ({ dir: `/scratch/probe-${ran.length}`, dispose: () => {} });
  return { ctx: { platform, arch: "x64", env, projectRoot, receipts, rooms, node: "/node", exists: (p) => files.includes(p), read, run, scratch, now: () => "2026-09-23T10:00:00.000Z" }, ran };
}

test("the precedence is explicit: project, then Orbit managed, then system", () => {
  assert.deepEqual(SOURCES.map((s) => s.source), ["project", "orbit-managed", "system"]);
});

test("a tool on PATH is found by the system source, with its version read off its own answer", () => {
  const { ctx, ran } = detection({ files: ["/opt/bin/git"], versions: { "/opt/bin/git": "git version 2.50.1 (Apple Git-155)" } });
  const found = detectTool(tool("git"), ctx);
  assert.deepEqual([found.status, found.source, found.version, found.path], ["ready", "system", "2.50.1", "/opt/bin/git"]);
  assert.deepEqual(ran, [["/opt/bin/git", "--version"]], "asked with argv, once");
  assert.deepEqual(found.sources.map((s) => [s.source, s.found]), [["project", false], ["orbit-managed", false], ["system", true]]);
});

test("a project's own copy wins over the machine's, and a copy that will not start is passed over", () => {
  const bin = posix.join("/work/app", "node_modules", ".bin", "playwright-cli");
  const both = detection({ files: [bin, "/usr/bin/playwright-cli"], versions: { [bin]: "0.1.4", "/usr/bin/playwright-cli": "0.1.1" } });
  assert.deepEqual([detectTool(tool("playwright"), both.ctx).source, detectTool(tool("playwright"), both.ctx).version], ["project", "0.1.4"]);
  const broken = detection({ files: [bin, "/usr/bin/playwright-cli"], versions: { [bin]: Object.assign(new Error("x"), { code: "EACCES" }), "/usr/bin/playwright-cli": "0.1.1" } });
  const found = detectTool(tool("playwright"), broken.ctx);
  assert.deepEqual([found.source, found.sources[0].reason], ["system", "found, but not executable"]);
});

test("a Orbit-managed install is found from its RECEIPT and beats the system copy", () => {
  const rooms = stateRooms("/store");
  const receipt = { tool: "sqlcmd", version: "1.10.0", platform: "linux", arch: "x64", home: "toolRuntimes", dir: "sqlcmd/1.10.0-linux-x64", bin: "sqlcmd" };
  const managed = receiptPath(rooms, receipt);
  const { ctx } = detection({ files: [managed, "/usr/bin/sqlcmd"], versions: { [managed]: "sqlcmd\n\nVersion: v1.10.0", "/usr/bin/sqlcmd": "Version 15.0.4298.1" }, receipts: [receipt], rooms });
  const found = detectTool(tool("sqlcmd"), ctx);
  assert.deepEqual([found.source, found.version, found.path], ["orbit-managed", "1.10.0", managed]);
});

test("nothing anywhere is `missing`, with every source saying it looked", () => {
  const found = detectTool(tool("sqlcmd"), detection().ctx);
  assert.deepEqual([found.status, found.source, found.sources.every((s) => !s.found)], ["missing", null, true]);
});

test("Windows: PATH is split on ;, PATHEXT is asked in order, and a .cmd shim is run through Node, never a shell", () => {
  const env = { Path: "C:\\Tools;C:\\npm", PATHEXT: ".EXE;.CMD" };
  const shim = win32.join("C:\\npm", "playwright-cli.cmd");
  const target = win32.join("C:\\npm", "node_modules\\@playwright\\cli\\playwright-cli.js");
  const read = () => `@ECHO off\r\n"%_prog%"  "%dp0%\\node_modules\\@playwright\\cli\\playwright-cli.js" %*\r\n`;
  const { ctx, ran } = detection({ platform: "win32", env, projectRoot: "C:\\work\\app", files: [shim, target], versions: { "/node": "Version 0.1.4" }, read });
  const found = detectTool(tool("playwright"), ctx);
  assert.deepEqual([found.status, found.path], ["ready", shim]);
  assert.deepEqual(ran[0], ["/node", target, "--version"]);
  const exe = win32.join("C:\\Tools", "git.exe");
  assert.equal(detectTool(tool("git"), detection({ platform: "win32", env, files: [exe], versions: { [exe]: "git version 2.46.0.windows.1" } }).ctx).version, "2.46.0");
});

// npm 9+ writes its OWN npm.cmd unlike the shims it writes for every other package: the
// script is named in a variable, beside a second script it must not be mistaken for.
const NPM_CMD = [
  ":: Created by npm, please don't edit manually.", "@ECHO OFF", "SETLOCAL",
  'SET "NODE_EXE=%~dp0\\node.exe"', 'IF NOT EXIST "%NODE_EXE%" (', '  SET "NODE_EXE=node"', ")",
  'SET "NPM_PREFIX_JS=%~dp0\\node_modules\\npm\\bin\\npm-prefix.js"',
  'SET "NPM_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npm-cli.js"',
  "FOR /F \"delims=\" %%F IN ('CALL \"%NODE_EXE%\" \"%NPM_PREFIX_JS%\"') DO (", '  SET "NPM_PREFIX_NPM_CLI_JS=%%F\\node_modules\\npm\\bin\\npm-cli.js"', ")",
  'IF EXIST "%NPM_PREFIX_NPM_CLI_JS%" (', '  SET "NPM_CLI_JS=%NPM_PREFIX_NPM_CLI_JS%"', ")",
  '"%NODE_EXE%" "%NPM_CLI_JS%" %*',
].join("\r\n");

test("Windows: npm's own npm.cmd names its script in a variable, and npm is asked through that script -- never the prefix helper beside it", () => {
  const env = { Path: "C:\\Program Files\\nodejs", PATHEXT: ".EXE;.CMD" };
  const shim = win32.join("C:\\Program Files\\nodejs", "npm.cmd");
  const target = win32.join("C:\\Program Files\\nodejs", "node_modules\\npm\\bin\\npm-cli.js");
  const { ctx, ran } = detection({ platform: "win32", env, files: [shim, target], versions: { "/node": "10.9.8" }, read: () => NPM_CMD });
  const found = detectTool(SHIPPED.find((t) => t.id === "npm"), ctx);
  assert.deepEqual([found.status, found.version, ran[0]], ["ready", "10.9.8", ["/node", target, "--version"]]);
});

test("a detection context is the real effects, the project, and only what the caller adds -- one shape for every composition root", () => {
  const ctx = detectionContext({ env: { PATH: "/x" }, projectRoot: "/p", rooms: { tools: "/r" }, receipts: undefined });
  assert.deepEqual([ctx.env, ctx.projectRoot, ctx.rooms, "receipts" in ctx, typeof ctx.run, typeof ctx.exists, typeof ctx.read], [{ PATH: "/x" }, "/p", { tools: "/r" }, false, "function", "function", "function"]);
  assert.equal(detectionContext({ env: {} }).projectRoot, null, "no project is null, never a guess");
});

test("versions are compared as numbers, and read by the row's own pattern", () => {
  assert.ok(newer("1.10.0", "1.9.3") > 0);
  assert.equal(newer("24.15.0", "24.15.0"), 0);
  assert.equal(versionIn("Version: v1.10.0", tool("sqlcmd").detection.versionPattern), "1.10.0");
  assert.equal(versionIn("no digits here", null), null);
});

// ---- desired vs observed ---------------------------------------------------------------

const NOW = Date.parse("2026-09-23T12:00:00.000Z");
const reconcile = (over = {}) => Object.fromEntries(effectiveTools({ catalog: CATALOG, desired: { tools: {} }, observed: { tools: {} }, receipts: [], now: NOW, platform: "linux", arch: "x64", installers: { archive: archiveInstaller }, ...over }).map((t) => [t.id, t]));

test("desired and observed stay apart: wanted but missing is not available, and nothing observed is unknown", () => {
  const seenMissing = { sqlcmd: { status: "missing", checkedAt: new Date(NOW - 1000).toISOString(), sources: [] } };
  const t = reconcile({ observed: { tools: seenMissing } }).sqlcmd;
  assert.deepEqual([t.enabled, t.status, t.available, t.state], [true, "missing", false, "not-installed"]);
  assert.deepEqual([reconcile().git.status, reconcile().git.state, reconcile().git.available], ["unknown", "unknown", false]);
  const old = reconcile({ observed: { tools: { git: { status: "ready", checkedAt: new Date(NOW - OBSERVATION_TTL_MS - 1).toISOString() } } } }).git;
  assert.deepEqual([old.status, old.stale], ["unknown", true]);
  assert.equal(reconcile({ desired: { tools: { git: { enabled: false } } }, observed: { tools: { git: { status: "ready", checkedAt: new Date(NOW).toISOString() } } } }).git.available, false);
});

test("what an install WOULD do is described per platform, and a managed install older than the pin offers an update", () => {
  assert.deepEqual([reconcile().sqlcmd.install.supported, reconcile().sqlcmd.install.version], [true, "1.10.0"]);
  assert.match(reconcile({ platform: "darwin", arch: "riscv" }).sqlcmd.install.reason, /no verified build/);
  assert.match(reconcile().git.install.reason, /install git/);
  assert.equal(Object.keys(tool("sqlcmd").install.assets).includes("bad-pin"), false, "an http:// pin is dropped, never trusted");
  const older = { tool: "sqlcmd", version: "1.9.0", platform: "linux", arch: "x64", home: "toolRuntimes", dir: "sqlcmd/1.9.0-linux-x64", bin: "sqlcmd" };
  assert.deepEqual(reconcile({ receipts: [older] }).sqlcmd.update, { from: "1.9.0", to: "1.10.0" });
});

// ---- installing, for real, into a temporary store --------------------------------------

function installCtx(t, over = {}) {
  const base = mkdtempSync(join(tmpdir(), "orbit-tools-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const rooms = stateRooms(base);
  const state = createToolState(rooms, realIo());
  const counts = { downloads: 0 };
  const io = { ...realInstallIo(), download: async () => (counts.downloads++, over.bytes ?? BYTES), unpack: over.unpack ?? fakeUnpack };
  const run = over.run ?? ((bin) => (existsSync(bin) ? { status: 0, stdout: `sqlcmd: tools\n\nVersion: v${readFileSync(bin, "utf8").trim()}` } : { error: { code: "ENOENT" } }));
  return { base, rooms, state, counts, ctx: { platform: "linux", arch: "x64", rooms, state, io, exists: existsSync, run, now: () => "2026-09-23T10:00:00.000Z", installers: { archive: archiveInstaller } } };
}

function fakeUnpack(bytes, asset, tmp) {
  const into = join(tmp, "unpacked");
  mkdirSync(into, { recursive: true });
  writeFileSync(join(into, asset.bin), "1.10.0\n");
  return into;
}

test("an install lands in the store under tool/version-platform, verified, with a receipt that holds no absolute path", async (t) => {
  const { base, rooms, state, ctx, counts } = installCtx(t);
  const receipt = await installTool(tool("sqlcmd"), ctx);
  const final = join(rooms.toolRuntimes, "sqlcmd", "1.10.0-linux-x64");
  assert.equal(readFileSync(join(final, "sqlcmd"), "utf8").trim(), "1.10.0");
  assert.deepEqual([receipt.version, receipt.checksum, receipt.reused, counts.downloads], ["1.10.0", `sha256:${SHA}`, false, 1]);
  const [kept] = state.receipts();
  assert.deepEqual([kept.dir, kept.home, kept.bin, kept.schema], [join("sqlcmd", "1.10.0-linux-x64"), "toolRuntimes", "sqlcmd", 1]);
  assert.equal(JSON.stringify(kept).includes(base), false);
  assert.deepEqual(readdirSync(join(rooms.toolRuntimes, "sqlcmd")), ["1.10.0-linux-x64"], "no staging directory is left behind");
});

test("a compatible runtime already in place is reused: no download, and the receipt says so", async (t) => {
  const { ctx, counts } = installCtx(t);
  await installTool(tool("sqlcmd"), ctx);
  const again = await installTool(tool("sqlcmd"), ctx);
  assert.deepEqual([again.reused, counts.downloads], [true, 1]);
});

test("a checksum that does not match the pin installs NOTHING", async (t) => {
  const { rooms, state, ctx } = installCtx(t, { bytes: Buffer.from("tampered") });
  await assert.rejects(installTool(tool("sqlcmd"), ctx), (e) => e instanceof Blocked && /SHA-256/.test(e.message));
  assert.equal(existsSync(join(rooms.toolRuntimes, "sqlcmd", "1.10.0-linux-x64")), false);
  assert.deepEqual(state.receipts(), []);
});

test("a half install is never promoted: an unpack that fails, or a binary that does not answer, leaves nothing where detection looks", async (t) => {
  const broken = installCtx(t, { unpack: () => { throw new Error("tar: truncated archive"); } });
  await assert.rejects(installTool(tool("sqlcmd"), broken.ctx), /truncated/);
  assert.deepEqual([existsSync(join(broken.rooms.toolRuntimes, "sqlcmd", "1.10.0-linux-x64")), readdirSync(join(broken.rooms.toolRuntimes, "sqlcmd")), broken.state.receipts()], [false, [], []]);
  const wrong = installCtx(t, { run: () => ({ status: 0, stdout: "Version: v1.9.9" }) });
  await assert.rejects(installTool(tool("sqlcmd"), wrong.ctx), (e) => e instanceof Blocked && /did not answer/.test(e.message));
  assert.deepEqual([readdirSync(join(wrong.rooms.toolRuntimes, "sqlcmd")), wrong.state.receipts()], [[], []]);
});

test("a strategy Orbit cannot run here is refused with the row's own instructions", async (t) => {
  const { ctx } = installCtx(t);
  await assert.rejects(installTool(tool("git"), ctx), (e) => e instanceof Refused && /install git/.test(e.message));
  await assert.rejects(installTool(tool("sqlcmd"), { ...ctx, platform: "sunos" }), (e) => e instanceof Refused && /no verified build/.test(e.message));
});

test("replacing the plugin directory does not touch a managed runtime: a new catalog finds it again by its receipt", async (t) => {
  const { rooms, state, ctx } = installCtx(t);
  await installTool(tool("sqlcmd"), ctx);
  const upgraded = toolCatalog({ tools: [{ ...JSON.parse(JSON.stringify({ id: "sqlcmd", name: "SQLCMD (renamed in B)", provides: ["sqlserver.query"], detection: { commands: ["sqlcmd"], versionPattern: "Version:?\\s*v?(\\d+(?:\\.\\d+){1,3})" }, install: { strategy: "archive", version: "1.10.0", assets: {} } })) }] })[0];
  const found = detectTool(upgraded, { platform: "linux", arch: "x64", env: { PATH: "" }, rooms, receipts: state.receipts(), exists: existsSync, run: ctx.run, now: ctx.now });
  assert.deepEqual([found.status, found.source, found.version], ["ready", "orbit-managed", "1.10.0"]);
});

// ---- Orbit Control's own Node ------------------------------------------------------------

test("node-control is found in 1.5.2's order, and the first Node new enough wins", () => {
  const rooms = stateRooms("/store");
  const ctx = { platform: "linux", arch: "x64", env: { ORBIT_CONTROL_NODE: "/typed/node" }, rooms, node: "/running/node", exists: () => true, run: (n) => ({ status: 0, stdout: { "/typed/node": "v22.1.0", "/running/node": "v20.19.0" }[n] ?? "v24.21.0" }) };
  const list = (dir) => (dir === rooms.controlRuntime ? ["v24.21.0-linux-x64"] : []);
  const sources = controlNodeDetector({ home: "/home/u", list, supported: (v) => newer(v, "24.15.0") >= 0, required: () => ">=24.15" })({}, ctx);
  assert.deepEqual(sources.map((s) => [s.source, s.ok]), [["override", false], ["running", false], ["orbit-managed", true]]);
  assert.match(sources[0].reason, /older than Orbit Control needs/);
});

test("the node-dist installer is 1.5.2's installRuntime, and its receipt carries the digest it was verified against", async (t) => {
  const base = mkdtempSync(join(tmpdir(), "orbit-node-dist-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const rooms = stateRooms(base);
  const archive = Buffer.from("node archive");
  const digest = createHash("sha256").update(archive).digest("hex");
  const io = { ...realInstallIo(), unpack: (bytes, asset, tmp) => (mkdirSync(join(tmp, "unpacked", "node-v24.21.0-linux-x64", "bin"), { recursive: true }), writeFileSync(join(tmp, "unpacked", "node-v24.21.0-linux-x64", "bin", "node"), ""), join(tmp, "unpacked")) };
  const installer = nodeDistInstaller({ supported: () => true, fetchJson: async () => [{ version: "v24.21.0", lts: "Krypton", files: ["linux-x64"] }], fetchText: async () => `${digest}  node-v24.21.0-linux-x64.tar.gz\n`, fetchBytes: async () => archive, io, log: () => {} });
  const state = createToolState(rooms, realIo());
  const receipt = await installTool({ id: "node-control", name: "Node", install: { strategy: "node-dist" } }, { platform: "linux", arch: "x64", rooms, state, exists: existsSync, now: () => "t", installers: { "node-dist": installer } });
  assert.deepEqual([receipt.version, receipt.home, receipt.dir, receipt.checksum], ["24.21.0", "controlRuntime", "v24.21.0-linux-x64", `sha256:${digest}`]);
  assert.ok(existsSync(join(rooms.controlRuntime, "v24.21.0-linux-x64", "bin", "node")), "in the same room start.mjs has always looked in");
});

// ---- the two command line tools a work item can be read through ------------------------------

const SHIPPED = toolCatalog(readCatalog(realIo(), catalogFile(join(dirname(fileURLToPath(import.meta.url)), ".."), "tools")));

test("the Azure CLI and the GitHub CLI are catalog rows that provide their command, are never installed by Orbit, and are found the way every tool is", () => {
  const [az, gh] = ["azure-cli", "github-cli"].map((id) => SHIPPED.find((t) => t.id === id));
  assert.deepEqual([az.provides, gh.provides], [["command:az"], ["command:gh"]]);
  for (const row of [az, gh]) assert.deepEqual([row.install.strategy, /^Install /.test(row.install.instructions), /Orbit does not install it/.test(row.install.instructions)], ["manual", true, true], row.id);
  const found = detectTool(az, detection({ files: ["/opt/bin/az"], versions: { "/opt/bin/az": "azure-cli                         2.61.0 *\n\ncore                              2.61.0 *\ntelemetry                          1.1.0\n" } }).ctx);
  assert.deepEqual([found.status, found.source, found.version], ["ready", "system", "2.61.0"]);
  const cli = detectTool(gh, detection({ files: ["/usr/bin/gh"], versions: { "/usr/bin/gh": "gh version 2.50.0 (2026-05-01)\nhttps://github.com/cli/cli/releases/tag/v2.50.0\n" } }).ctx);
  assert.deepEqual([cli.status, cli.version], ["ready", "2.50.0"]);
});

test("a machine without them says so plainly, asks nothing but their version, and installs nothing", () => {
  const { ctx, ran } = detection({ files: [] });
  const [az, gh] = ["azure-cli", "github-cli"].map((id) => detectTool(SHIPPED.find((t) => t.id === id), ctx));
  assert.deepEqual([az.status, gh.status], ["missing", "missing"]);
  assert.deepEqual(ran, [], "nothing on PATH, so nothing was even run");
  const effective = effectiveTools({ catalog: SHIPPED.filter((t) => ["azure-cli", "github-cli"].includes(t.id)), desired: {}, observed: { observedAt: "2026-09-23T10:00:00.000Z", tools: { "azure-cli": az, "github-cli": gh } }, receipts: [], now: Date.parse("2026-09-23T10:00:00.000Z"), platform: "linux", arch: "x64", installers: {} });
  assert.deepEqual(Object.fromEntries(effective.map((t) => [t.id, [t.install.supported, t.state]])), { "azure-cli": [false, "not-installed"], "github-cli": [false, "not-installed"] });
});

// ---- observing only what a concrete need asked about ---------------------------------------

function observing(over = {}) {
  const io = fakeIo();
  const state = createToolState(stateRooms("/store"), io);
  const { ctx, ran } = detection(over);
  return { ctx: { ...ctx, state, now: over.now ?? ctx.now }, ran, state };
}

test("observing SOME rows records those and keeps every other row exactly as it was, on its own clock", () => {
  const first = observing({ files: ["/opt/bin/git"], versions: { "/opt/bin/git": "git version 2.50.1" }, now: () => "2026-09-01T00:00:00.000Z" });
  observeTools(SHIPPED.filter((t) => ["git", "azure-cli"].includes(t.id)), first.ctx);
  const before = first.state.read("observed").tools;
  assert.deepEqual([before.git.status, before["azure-cli"]], ["ready", undefined], "a row that is only observed on demand is not looked at by the general observation");
  const later = { ...first.ctx, now: () => "2026-09-20T00:00:00.000Z", exists: (p) => p === "/opt/bin/az", run: () => ({ status: 0, stdout: "azure-cli                         2.61.0 *\n", stderr: "" }) };
  const found = observeSome(SHIPPED, ["azure-cli"], later);
  assert.deepEqual(found.map((f) => [f.id, f.status, f.version]), [["azure-cli", "ready", "2.61.0"]]);
  const after = first.state.read("observed").tools;
  assert.deepEqual(after.git, before.git, "the row nobody asked about is untouched, checkedAt and all");
  assert.equal(after.git.checkedAt, "2026-09-01T00:00:00.000Z");
  assert.deepEqual([after["azure-cli"].status, after["azure-cli"].checkedAt], ["ready", "2026-09-20T00:00:00.000Z"]);
});

test("only the commands of the rows asked for are looked for at all", () => {
  const { ctx, ran } = observing({ files: ["/opt/bin/gh"], versions: { "/opt/bin/gh": "gh version 2.50.0 (2026-05-01)" } });
  observeSome(SHIPPED, ["github-cli"], ctx);
  assert.deepEqual(ran, [["/opt/bin/gh", "--version"]], "one command, by argv, and no other tool was even considered");
});

test("asking for a row that is not in the catalog, or for none, records nothing and looks at nothing", () => {
  const { ctx, ran, state } = observing({ files: ["/usr/bin/git"] });
  assert.deepEqual(observeSome(SHIPPED, ["nothing-like-it"], ctx), []);
  assert.deepEqual(observeSome(SHIPPED, [], ctx), []);
  assert.deepEqual(ran, []);
  assert.deepEqual(state.read("observed").tools, {}, "no document was written for a question nobody asked");
});

test("a probe that throws is recorded as not found, with the reason, and does not stop the rows beside it", () => {
  const { ctx } = observing({ files: [] });
  const broken = { ...ctx, exists: () => { throw new Error("EACCES"); } };
  const found = observeSome(SHIPPED, ["azure-cli", "github-cli"], broken);
  assert.deepEqual(Object.fromEntries(found.map((f) => [f.id, [f.status, f.reason]])), { "azure-cli": ["missing", "its detection failed"], "github-cli": ["missing", "its detection failed"] });
});

// ---- the general observation runs inside a session's start ----------------------------------

test("the general observation never runs a row that is observed on demand, and keeps what a need observed of it", () => {
  const { ctx, ran, state } = observing({ files: ["/opt/bin/az", "/usr/bin/git"], versions: { "/opt/bin/az": "azure-cli  2.61.0", "/usr/bin/git": "git version 2.50.1" }, now: () => "2026-09-01T00:00:00.000Z" });
  observeSome(SHIPPED, ["azure-cli"], ctx);
  ran.length = 0;
  const found = observeTools(SHIPPED, { ...ctx, now: () => "2026-09-20T00:00:00.000Z" });
  assert.equal(ran.some(([file]) => /\/az$/.test(file) || /\/gh$/.test(file)), false, "neither slow CLI was started");
  assert.equal(found.some((f) => ["azure-cli", "github-cli"].includes(f.id)), false);
  const kept = state.read("observed").tools;
  assert.deepEqual([kept["azure-cli"].status, kept["azure-cli"].checkedAt], ["ready", "2026-09-01T00:00:00.000Z"], "the earlier observation of the on-demand row stands, on its own clock");
  assert.equal(kept["github-cli"], undefined);
});

test("the shipped catalog marks the work-item CLIs (and the private copies of the Azure CLI) and the project-runtime tools as on demand, and any other value means always", () => {
  // The runtime tools (1.7.6) are asked about only when a project's runtime needs one: thirteen probes at a
  // session's start would spend a hook's few seconds on a question nobody had asked.
  const runtime = ["node", "npm", "pnpm", "yarn", "dotnet", "python3", "go", "java", "ruby", "make", "docker", "docker-daemon", "devcontainer", "task", "just"];
  assert.deepEqual(SHIPPED.filter(onDemand).map((t) => t.id), ["github-cli", "azure-cli", "azure-cli-private", "azure-cli-private-win", ...runtime]);
  assert.equal(toolCatalog({ tools: [{ id: "x", observe: "sometimes", detection: { commands: ["x"] } }] })[0].observe, "always");
});

// ---- 1.7.6: a probe that did not answer in time is unknown, not missing ------------------------------

test("a tool that was found and then did not answer in time is UNKNOWN -- never reported as missing", () => {
  const slow = Object.assign(new Error("spawnSync x ETIMEDOUT"), { code: "ETIMEDOUT" });
  const { ctx } = detection({ files: ["/opt/bin/git"], versions: { "/opt/bin/git": slow } });
  const found = detectTool(tool("git"), ctx);
  assert.deepEqual([found.status, found.source, found.reason], ["unknown", null, "found, but it did not answer in time"]);
  assert.equal(found.sources.find((s) => s.found).timedOut, true);
  const refused = Object.assign(new Error("x"), { code: "EACCES" });
  assert.equal(detectTool(tool("git"), detection({ files: ["/opt/bin/git"], versions: { "/opt/bin/git": refused } }).ctx).status, "missing", "a tool that will not start is still missing");
  assert.equal(detectTool(tool("git"), detection({ files: [] }).ctx).status, "missing", "and one that is not there is missing");
});

test("an unknown observation is not ready, is said so, and is not a reason to install", () => {
  const unknown = { id: "git", status: "unknown", source: null, version: null, path: null, sources: [], reason: "found, but it did not answer in time", checkedAt: "2026-09-23T10:00:00.000Z" };
  const [effective] = effectiveTools({ catalog: [tool("git")], desired: {}, observed: { tools: { git: unknown } }, receipts: [], now: Date.parse("2026-09-23T10:00:00.000Z"), platform: "linux", arch: "x64", installers: {} });
  assert.deepEqual([effective.status, effective.available, effective.state], ["unknown", false, "unknown"]);
});

// A version is asked from a neutral directory: a tool that reads the directory it runs in -- a
// version manager's pin, a package manager's per-project configuration -- must never be handed a
// checkout's, which is untrusted data.
test("a version probe runs from a neutral directory, never from the one this process was started in", () => {
  const here = mkdtempSync(join(tmpdir(), "orbit-probe-cwd-"));
  const marker = join(here, "marker");
  const asked = spawnWhere(here);
  assert.equal(asked.status, 0);
  assert.equal(realpathSync(asked.stdout.trim()), realpathSync(tmpdir()), "asked from the OS temp directory");
  assert.notEqual(realpathSync(asked.stdout.trim()), realpathSync(here));
  assert.equal(existsSync(marker), false);
  rmSync(here, { recursive: true, force: true });
});

function spawnWhere(cwd) {
  const was = process.cwd();
  process.chdir(cwd);
  try {
    return realDetection({}).run(process.execPath, ["-e", "console.log(process.cwd())"]);
  } finally {
    process.chdir(was);
  }
}
