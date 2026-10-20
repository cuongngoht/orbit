// Python as a CLI tool the project report runs on: pinned per platform, found
// past an old interpreter that happens to be asked first, installed one at a
// time -- and never receipted when the install did not happen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Blocked } from "../src/errors.mjs";
import { pinnedArchive } from "../src/store/archive.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { LOCK } from "../src/store/lock.mjs";
import { realIo } from "../src/store/io.mjs";
import { archiveInstaller } from "../src/tools/archive.mjs";
import { toolCatalog } from "../src/tools/catalog.mjs";
import { detectTool, versionIn } from "../src/tools/detect.mjs";
import { installTool } from "../src/tools/install.mjs";
import { realInstallIo } from "../src/tools/real.mjs";
import { createToolState } from "../src/tools/state.mjs";

const REPO = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const shipped = toolCatalog(JSON.parse(readFileSync(join(REPO, "catalog", "tools.json"), "utf8")));
const PYTHON = shipped.find((t) => t.id === "python");

test("the shipped python row pins a verified archive for every platform Orbit supports", () => {
  assert.ok(PYTHON, "catalog/tools.json has a python row");
  assert.deepEqual(Object.keys(PYTHON.install.assets).sort(), ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-arm64", "win32-x64"]);
  for (const [platform, asset] of Object.entries(PYTHON.install.assets)) assert.ok(pinnedArchive(asset, "bin"), platform);
  assert.equal(PYTHON.install.assets["win32-x64"].bin, "python/python.exe");
  assert.equal(versionIn(`Python ${PYTHON.install.version}\n`, PYTHON.detection.versionPattern), PYTHON.install.version, "the version the installer checks is the one the binary prints");
  assert.deepEqual([PYTHON.detection.minimum, PYTHON.provides.includes("python.runtime")], ["3.11", true]);
});

function machine(answers, platform = "darwin") {
  const run = (file) => answers[file] ?? { error: { code: "ENOENT" } };
  return { platform, arch: "arm64", env: { PATH: "/usr/bin:/opt/homebrew/bin" }, projectRoot: null, receipts: [], rooms: stateRooms("/store"), node: "/node", exists: (p) => p in answers, read: () => "", run, now: () => new Date().toISOString() };
}

test("an interpreter below the minimum is FOUND and passed over; the next candidate in the same source wins", () => {
  const found = detectTool(PYTHON, machine({ "/usr/bin/python3": { status: 0, stdout: "Python 3.9.6\n" }, "/opt/homebrew/bin/python3.13": { status: 0, stdout: "Python 3.13.13\n" } }));
  assert.deepEqual([found.status, found.version, found.path], ["ready", "3.13.13", "/opt/homebrew/bin/python3.13"]);
});

test("with only an old interpreter the tool is missing, and says which version it found", () => {
  const found = detectTool(PYTHON, machine({ "/usr/bin/python3": { status: 0, stdout: "Python 3.9.6\n" } }));
  assert.equal(found.status, "missing");
  assert.match(found.reason, /found 3\.9\.6, older than the 3\.11 this needs/);
});

test("a Windows Store alias starts, exits 9009 and names no version: never ready", () => {
  const alias = "C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe";
  const ctx = { ...machine({ [alias]: { status: 9009, stdout: "", stderr: "Python was not found; run without arguments to install from the Microsoft Store" } }, "win32"), env: { PATH: "C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps", PATHEXT: ".EXE" } };
  const found = detectTool(PYTHON, ctx);
  assert.equal(found.status, "missing");
  assert.match(found.reason, /exited 9009/);
});

const BYTES = Buffer.from("pretend this is a python tarball");
const SHA = createHash("sha256").update(BYTES).digest("hex");
const ROW = toolCatalog({ tools: [{ id: "python", name: "Python", provides: ["python.runtime"], detection: { commands: ["python3"], versionPattern: "Python (\\d+\\.\\d+\\.\\d+)", minimum: "3.11" }, install: { strategy: "archive", version: "3.13.15", assets: { "linux-x64": { url: "https://example.test/python.tar.gz", sha256: SHA, format: "tar.gz", bin: "python/bin/python3" } } } }] })[0];

function installCtx(t, over = {}) {
  const base = mkdtempSync(join(tmpdir(), "orbit-python-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const rooms = stateRooms(base);
  const state = createToolState(rooms, realIo({ sleep: () => {} }));
  const io = { ...realInstallIo(), download: async () => over.bytes ?? BYTES, unpack: over.unpack ?? unpacked };
  const run = over.run ?? ((bin) => (existsSync(bin) ? { status: 0, stdout: `Python ${readFileSync(bin, "utf8").trim()}\n` } : { error: { code: "ENOENT" } }));
  return { rooms, state, ctx: { platform: "linux", arch: "x64", rooms, state, io, exists: existsSync, run, now: () => new Date().toISOString(), installers: { archive: archiveInstaller } } };
}

function unpacked(bytes, asset, tmp) {
  const into = join(tmp, "unpacked");
  mkdirSync(join(into, "python", "bin"), { recursive: true });
  writeFileSync(join(into, asset.bin), "3.13.15\n");
  return into;
}

test("an install that fails -- wrong checksum, broken archive, wrong version -- writes no receipt and leaves no runtime", async (t) => {
  for (const over of [{ bytes: Buffer.from("tampered") }, { unpack: () => { throw new Error("tar: truncated gzip"); } }, { run: () => ({ status: 0, stdout: "Python 3.12.0" }) }]) {
    const { rooms, state, ctx } = installCtx(t, over);
    await assert.rejects(installTool(ROW, ctx));
    assert.deepEqual(state.receipts(), [], JSON.stringify(Object.keys(over)));
    assert.equal(existsSync(join(rooms.toolRuntimes, "python", "3.13.15-linux-x64")), false);
  }
});

test("a good install is receipted last, and the install lock is gone afterwards", async (t) => {
  const { rooms, state, ctx } = installCtx(t);
  const receipt = await installTool(ROW, ctx);
  assert.deepEqual([receipt.version, state.receipts().length], ["3.13.15", 1]);
  assert.equal(existsSync(join(rooms.toolRuntimes, "python", LOCK)), false);
});

test("a second install of the same tool while one holds the lock is BLOCKED, in words about installing", async (t) => {
  const { rooms, state, ctx } = installCtx(t);
  mkdirSync(join(rooms.toolRuntimes, "python", LOCK), { recursive: true });
  const busy = { ...ctx, state: { ...state, installing: createToolState(rooms, { ...realIo({ sleep: () => {} }), backoff: [1] }).installing } };
  await assert.rejects(installTool(ROW, busy), (e) => e instanceof Blocked && /another install of python is running/.test(e.message));
  assert.deepEqual(state.receipts(), []);
});
