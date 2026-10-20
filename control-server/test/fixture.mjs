// A throwaway plugin root for every Control Server test: skills/, a built
// public/, a backup room and things OUTSIDE all three that nothing may reach.
// The repository's own skills/ is never written by a test.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mcpArchiveInstaller, remoteHttpInstaller } from "../../src/mcp/install.mjs";
import { archiveInstaller } from "../../src/tools/archive.mjs";
import { realInstallIo } from "../../src/tools/real.mjs";
import { stateRooms } from "../../src/store/control.mjs";
import { realIo } from "../../src/store/io.mjs";
import { fakeMcpHost } from "../../test/fakes/mcp-host.mjs";
import { createLive } from "../src/live/index.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const TOKEN = "test-token-0123456789";

export const skillText = (name, description = `The ${name} skill, for tests.`, extra = "user-invocable: true\n") => `---\nname: ${name}\ndescription: >\n  ${description}\n${extra}---\n\n# ${name}\n\nBody.\n`;

export function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "orbit-control-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = { base, plugin: join(base, "plugin"), skills: join(base, "plugin", "skills"), public: join(base, "plugin", "public"), store: join(base, "store"), backups: join(base, "store", "control-backups", "skills"), project: join(base, "project"), outside: join(base, "outside") };
  seed(root);
  return { root, ctx: contextFor(root) };
}

export const contextFor = (root, world = worldFor(root)) => ({ skillsRoot: root.skills, publicRoot: root.public, backupRoot: root.backups, token: TOKEN, now: () => new Date("2026-09-23T10:15:30.123Z"), node: "24.15.0", engine: "0.0.0-test", log: () => {}, world, capabilities: async () => [], live: createLive({ pollMs: 10, heartbeatMs: 40 }) });

// The resource manager's world, faked where it would touch the machine: the
// host is in memory (test/fakes/mcp-host.mjs), a download is a fixed buffer
// whose SHA-256 the fixture catalog pins, a "binary" is a file that holds the
// version it answers with, and a managed server's Test Connection is a probe
// that records the RESOLVED definition it was handed. The store, the rooms and
// every rename are real.
export const ARCHIVE = Buffer.from("the sqlcmd archive, as far as this suite is concerned");
export const ARCHIVE_SHA = createHash("sha256").update(ARCHIVE).digest("hex");

export const CONNECTED = { status: "connected", checkedAt: "2026-09-23T10:00:00.000Z", reason: null, tools: [{ name: "search", description: "Search the docs" }, { name: "fetch", description: "Fetch one page" }] };

// Whoever is signed in to Claude on the test "machine" -- with a field the
// adapter would never return, to prove the page could not receive it anyway.
export const SIGNED_IN = { signedIn: true, displayName: "Test Person", email: "person@example.test", organization: "Example Org", role: "admin", accessToken: "sk-ant-oat01-must-never-leave" };

export function worldFor(root, { host = fakeMcpHost(), pluginRoot = root.plugin, downloads = { n: 0 }, env = {}, probed = [], account = () => SIGNED_IN } = {}) {
  const run = (bin) => (existsSync(bin) ? { status: 0, stdout: `sqlcmd\n\nVersion: v${readFileSync(bin, "utf8").trim()}`, stderr: "" } : { error: { code: "ENOENT" } });
  const installIo = { ...realInstallIo(), download: async () => (downloads.n++, ARCHIVE), unpack: fakeUnpack };
  const detection = { platform: "linux", arch: "x64", env: { PATH: "" }, node: process.execPath, exists: existsSync, read: (p) => readFileSync(p, "utf8"), run, projectRoot: root.project, detectors: {} };
  return { pluginRoot, projectRoot: root.project, env, io: realIo(), installIo, host, account, detection, storeBase: root.store, rooms: stateRooms(root.store), installers: { archive: archiveInstaller }, mcpInstallers: { [remoteHttpInstaller.strategy]: remoteHttpInstaller, [mcpArchiveInstaller.strategy]: mcpArchiveInstaller }, managedProbe: async (def) => (probed.push(def), { ...CONNECTED, checkedAt: new Date().toISOString() }), session: { fetch: null, start: null, env: {} }, node: process.execPath, plugin: "orbit", platform: "linux", arch: "x64", log: () => {} };
}

// A tool archive holds its binary; an MCP runtime archive, its entrypoint.
function fakeUnpack(bytes, asset, tmp) {
  const into = join(tmp, "unpacked");
  const file = join(into, asset.bin ?? asset.entrypoint);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, asset.bin ? "1.10.0\n" : "// a stdio MCP server\n");
  return into;
}

// A plugin's catalogs: the repository's own MCP catalog plus one stdio server
// whose runtime archive is pinned to ARCHIVE, a components row per fixture
// skill (beta can use documentation), the engine's builtins, and a tool
// catalog whose one archive is pinned to ARCHIVE.
export function catalogsInto(pluginRoot, { learnDescription } = {}) {
  mkdirSync(join(pluginRoot, "catalog"), { recursive: true });
  const mcp = JSON.parse(readFileSync(join(REPO, "catalog", "mcp.json"), "utf8"));
  if (learnDescription) mcp.servers.find((s) => s.id === "microsoft-learn").description = learnDescription;
  mcp.servers.push({ id: "local-docs", name: "Local docs", description: "documentation served by a private runtime", recommended: true, definition: { transport: "stdio", commandRef: "managed-runtime", args: ["--stdio"] }, install: { strategy: "archive", version: "1.2.0", launch: "node", assets: { "linux-x64": { url: "https://example.test/local-docs-1.2.0.tgz", sha256: ARCHIVE_SHA, format: "tar.gz", entrypoint: "bin/server.js" } } }, provides: ["documentation.search"] });
  writeFileSync(join(pluginRoot, "catalog", "mcp.json"), JSON.stringify(mcp));
  writeFileSync(join(pluginRoot, "catalog", "components.json"), JSON.stringify({ schema: 1, skills: { alpha: { summary: "the alpha skill", provides: ["architecture.context"] }, beta: { summary: "beta", provides: ["qa.execution"], needs: ["project.context"], optional: ["documentation.search", "documentation.microsoft"] } }, agents: {}, builtins: { "project-context": { summary: "project context", provides: ["project.context"] } } }));
  writeFileSync(join(pluginRoot, "catalog", "tools.json"), JSON.stringify({ schema: 1, tools: [{ id: "sqlcmd", name: "SQLCMD", summary: "required for SQL Server verification", provides: ["sqlserver.query", "command:sqlcmd"], detection: { commands: ["sqlcmd"], versionPattern: "Version:?\\s*v?(\\d+(?:\\.\\d+){1,3})" }, install: { strategy: "archive", version: "1.10.0", source: "https://example.test/sqlcmd", assets: { "linux-x64": { url: "https://example.test/sqlcmd-linux-x64.tar.bz2", sha256: ARCHIVE_SHA, format: "tar.bz2", bin: "sqlcmd" } } } }, { id: "git", name: "Git", summary: "source control", provides: ["source-control"], detection: { commands: ["git"] }, install: { strategy: "manual", instructions: "Install Git yourself." } }] }));
}

export const copyPlugin = (from, to) => cpSync(from, to, { recursive: true });

function seed(root) {
  catalogsInto(root.plugin);
  mkdirSync(root.project, { recursive: true });
  put(join(root.skills, "alpha", "SKILL.md"), skillText("alpha"));
  put(join(root.skills, "alpha", "scripts", "run.mjs"), "console.log('alpha');\n");
  put(join(root.skills, "beta", "SKILL.md"), skillText("beta", "Beta, not for the slash menu.", "user-invocable: false\n"));
  put(join(root.skills, "no-skill-md", "README.md"), "not a skill\n");
  put(join(root.skills, "README.md"), "a file, not a skill\n");
  put(join(root.skills, ".hidden", "SKILL.md"), skillText(".hidden"));
  put(join(root.outside, "victim", "SKILL.md"), skillText("victim"));
  put(join(root.outside, "secret.txt"), "TOP-SECRET\n");
  put(join(root.public, "index.html"), "<!doctype html><title>Orbit Control</title><div id=root></div>\n");
  put(join(root.public, "assets", "app-abc123.js"), "console.log('app');\n");
  put(join(root.public, "data.bin"), "binary\n");
}

export function put(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

// A symlink, or null where this machine will not make one (Windows without
// developer mode refuses a FILE link; a directory junction needs no privilege).
export function link(target, path, kind = "dir") {
  try {
    symlinkSync(target, path, kind === "dir" && process.platform === "win32" ? "junction" : kind);
    return path;
  } catch {
    return null;
  }
}
