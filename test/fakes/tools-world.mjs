// A scripted MACHINE for the tools layer: what is on PATH, what answers, and installers that do what a real one does --
// put a runtime where its receipt says and make it answer -- while recording what they were asked to do. Shared by the
// suites that walk the real `ensureOne` (test/tools-ensure.test.mjs, test/azure-cli-isolation.test.mjs).
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stateRooms } from "../../src/store/control.mjs";
import { realIo } from "../../src/store/io.mjs";
import { assetFor, toolCatalog } from "../../src/tools/catalog.mjs";
import { createToolState, receiptPath } from "../../src/tools/state.mjs";

const REPO = new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
export const CATALOG = toolCatalog(JSON.parse(readFileSync(join(REPO, "catalog", "tools.json"), "utf8")));
export const IDS = ["azure-cli-private", "azure-cli-private-win", "azure-cli"];
export const AZ = (v) => ({ status: 0, stdout: `azure-cli                         ${v}\n`, stderr: "" });
export const PY = { status: 0, stdout: "Python 3.13.15\n", stderr: "" };

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

export function world({ platform = "linux", arch = "x64", system = null, privateAt = null, failInstall = null, silentInstall = null, catalog = CATALOG } = {}) {
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
