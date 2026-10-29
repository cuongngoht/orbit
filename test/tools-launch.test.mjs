// HOW A TOOL THAT KEEPS IDENTITY STATE IS STARTED (src/tools/launch.mjs), through the rows the catalog ships for the
// Azure CLI: one environment, built in one place, that cannot be made to carry anybody else's profile -- on every
// operating system and architecture, with the path rules of that platform and not of the machine running the suite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Blocked } from "../src/errors.mjs";
import { assetFor, toolCatalog } from "../src/tools/catalog.mjs";
import { detectTool } from "../src/tools/detect.mjs";
import { launchEnv, launcherOf, launchOf, onWindowsDrive, profileOf, sessionDir } from "../src/tools/launch.mjs";

const REPO = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const RAW = JSON.parse(readFileSync(join(REPO, "catalog", "tools.json"), "utf8"));
const ROWS = toolCatalog(RAW);
const row = (id) => ROWS.find((r) => r.id === id);
const [SYSTEM, PRIVATE, WIN] = ["azure-cli", "azure-cli-private", "azure-cli-private-win"].map(row);

const PLATFORMS = [
  { platform: "win32", arch: "x64", authSessions: "C:\\Users\\dev\\.orbit\\projects\\control\\auth", home: "C:\\Users\\dev" },
  { platform: "win32", arch: "arm64", authSessions: "C:\\Users\\dev\\.orbit\\projects\\control\\auth", home: "C:\\Users\\dev" },
  { platform: "darwin", arch: "x64", authSessions: "/Users/dev/.orbit/projects/control/auth", home: "/Users/dev" },
  { platform: "darwin", arch: "arm64", authSessions: "/Users/dev/.orbit/projects/control/auth", home: "/Users/dev" },
  { platform: "linux", arch: "x64", authSessions: "/home/dev/.orbit/projects/control/auth", home: "/home/dev" },
  { platform: "linux", arch: "arm64", authSessions: "/home/dev/.orbit/projects/control/auth", home: "/home/dev" },
];

// What a developer's own shell holds: their profile, their pins, their secrets, their proxy.
const HOSTILE = (home) => ({ PATH: "/usr/bin", HOME: home, AZURE_CONFIG_DIR: `${home}/.azure`, AZURE_CORE_ENABLE_BROKER_ON_WINDOWS: "true", AZURE_CORE_ENABLE_BROKER_ON_MAC: "true", AZURE_CORE_ENCRYPT_TOKEN_CACHE: "true", AZURE_EXTENSION_DIR: `${home}/.azure/cliextensions`, AZURE_DEVOPS_EXT_PAT: "a-secret-pat", AZ_INSTALLER: "DEB", HTTPS_PROXY: "http://proxy.example:3128", SSL_CERT_FILE: "/etc/ssl/corp.pem", DISPLAY: ":0", SECRET_TOKEN: "do-not-pass" });

test("the three Azure CLI rows declare the same profile and the same pins, and every declared pin survives parsing", () => {
  const raw = (id) => RAW.tools.find((t) => t.id === id);
  for (const id of ["azure-cli", "azure-cli-private", "azure-cli-private-win"]) {
    const parsed = row(id);
    assert.deepEqual(parsed.profile, { env: "AZURE_CONFIG_DIR", name: "azure-cli" }, id);
    assert.deepEqual(parsed.launch.env, raw(id).launch.env, `${id}: no pin was dropped`);
    assert.deepEqual(parsed.launch.platformEnv, { win32: raw(id).launch.platformEnv.win32, posix: raw(id).launch.platformEnv.posix }, id);
    assert.deepEqual(parsed.launch.inherit, raw(id).launch.inherit, `${id}: no inherited name was dropped`);
    assert.deepEqual([parsed.launch.env, parsed.launch.inherit], [SYSTEM.launch.env, SYSTEM.launch.inherit], `${id} pins what the others pin`);
  }
  assert.deepEqual(SYSTEM.detection.wrapper, raw("azure-cli").detection.wrapper, "the Windows wrapper survives parsing");
  assert.deepEqual([...assetFor(PRIVATE, "linux", "x64").launch.args, ...assetFor(WIN, "win32", "x64").launch.args], ["-IBm", "azure.cli", "-IBm", "azure.cli"]);
});

test("isolation is pinned in the row on every platform: no OS broker, no shared keystore, no subscription picker, no telemetry", () => {
  for (const p of PLATFORMS) {
    const env = launchEnv(PRIVATE, { parent: {}, platform: p.platform, profileDir: "/p" });
    assert.equal(env.AZURE_CORE_ENABLE_BROKER_ON_WINDOWS, "false", `${p.platform}: the Windows broker holds a session OUTSIDE the profile`);
    assert.equal(env.AZURE_CORE_ENABLE_BROKER_ON_MAC, "false");
    assert.equal(env.AZURE_CORE_LOGIN_EXPERIENCE_V2, "off");
    assert.equal(env.AZURE_CORE_COLLECT_TELEMETRY, "false");
    assert.equal(env.AZURE_CORE_ENCRYPT_TOKEN_CACHE, p.platform === "win32" ? "true" : "false", `${p.platform}: the token cache is a file in the profile (encrypted per Windows user), never a keystore entry other profiles share`);
  }
});

test("the environment of a child is built from names the row declares and nothing else: the developer's profile, pins, extensions and secrets never arrive", () => {
  for (const p of PLATFORMS) {
    const env = launchEnv(PRIVATE, { parent: HOSTILE(p.home), platform: p.platform, profileDir: `${p.authSessions}/azure-cli` });
    assert.equal(env.AZURE_CONFIG_DIR, `${p.authSessions}/azure-cli`, `${p.platform}-${p.arch}: the profile is Orbit's`);
    assert.deepEqual(Object.keys(env).filter((k) => k.startsWith("AZURE_")).sort(), ["AZURE_CONFIG_DIR", "AZURE_CORE_COLLECT_TELEMETRY", "AZURE_CORE_ENABLE_BROKER_ON_MAC", "AZURE_CORE_ENABLE_BROKER_ON_WINDOWS", "AZURE_CORE_ENCRYPT_TOKEN_CACHE", "AZURE_CORE_LOGIN_EXPERIENCE_V2"], "only the pins and the profile");
    assert.equal(Object.values(env).some((v) => String(v).includes(`${p.home}/.azure`)), false, "nothing refers to the developer's profile");
    assert.deepEqual([env.AZURE_DEVOPS_EXT_PAT, env.AZURE_EXTENSION_DIR, env.SECRET_TOKEN, env.AZ_INSTALLER], [undefined, undefined, undefined, undefined]);
    assert.deepEqual([env.HTTPS_PROXY, env.SSL_CERT_FILE, env.DISPLAY], ["http://proxy.example:3128", "/etc/ssl/corp.pem", ":0"], "what a proxy or a browser hand-off needs does arrive");
  }
});

test("a build's own pins sit on the row's: the Windows ZIP says it was installed as a ZIP, a locked environment says nothing", () => {
  const zip = assetFor(WIN, "win32", "x64");
  assert.equal(launchEnv(WIN, { parent: {}, platform: "win32", profileDir: "C:\\p", asset: zip }).AZ_INSTALLER, "ZIP");
  assert.equal(launchEnv(PRIVATE, { parent: {}, platform: "linux", profileDir: "/p", asset: assetFor(PRIVATE, "linux", "x64") }).AZ_INSTALLER, undefined);
});

test("a row cannot let the profile variable through, and a malformed pin is dropped rather than half-applied", () => {
  const profile = profileOf({ env: "AZURE_CONFIG_DIR", name: "azure-cli" });
  assert.deepEqual(launchOf({ inherit: ["AZURE_CONFIG_DIR", "HTTPS_PROXY", "not a name"] }, profile).inherit, ["HTTPS_PROXY"]);
  assert.deepEqual(launchOf({ env: { GOOD: "false", "bad name": "x", ALSO_BAD: "has a space", WORSE: "a;b" } }).env, { GOOD: "false" });
  assert.equal(profileOf({ env: "AZURE_CONFIG_DIR" }), null, "a profile with no name is not a profile");
  assert.equal(profileOf({ env: "lower case!", name: "x" }), null);
});

test("the session directory is derived with the PLATFORM's path rules: exact strings on every operating system, never a POSIX separator in a Windows path", () => {
  for (const p of PLATFORMS) {
    const dir = sessionDir(PRIVATE, { platform: p.platform, rooms: { authSessions: p.authSessions } });
    assert.equal(dir, `${p.authSessions}${p.platform === "win32" ? "\\" : "/"}azure-cli`, `${p.platform}-${p.arch}`);
    if (p.platform === "win32") assert.equal(dir.includes("/"), false, "a Windows path has no forward slash");
  }
});

test("whichever copy runs -- a private one or the machine's -- the sign-in is the SAME profile: switching runtime never signs anybody out", () => {
  const where = (r) => sessionDir(r, { platform: "linux", rooms: { authSessions: "/s" } });
  assert.deepEqual([where(SYSTEM), where(PRIVATE), where(WIN)], ["/s/azure-cli", "/s/azure-cli", "/s/azure-cli"]);
});

test("under WSL a profile on a Windows drive is refused; elsewhere the same path is just a path", () => {
  const wsl = { platform: "linux", windowsMounts: ["/mnt/"], rooms: { authSessions: "/mnt/c/Users/dev/.orbit/projects/control/auth" } };
  assert.throws(() => sessionDir(PRIVATE, wsl), Blocked);
  assert.doesNotThrow(() => sessionDir(PRIVATE, { ...wsl, rooms: { authSessions: "/home/dev/.orbit/projects/control/auth" } }));
  assert.doesNotThrow(() => sessionDir(PRIVATE, { ...wsl, windowsMounts: [] }), "not WSL: nothing is refused");
  assert.equal(onWindowsDrive("/windir/d/x", { windowsMounts: ["/windir/"] }), true, "a mount root moved by /etc/wsl.conf is honoured");
  assert.equal(onWindowsDrive("/mnt/data/x", { windowsMounts: ["/mnt/"] }), false, "only a single-letter drive is a Windows drive");
});

function machine({ platform = "linux", arch = "x64", files = [], answers = {}, env = { PATH: "/usr/bin:/opt/bin" }, receipts = [], rooms = { authSessions: "/orbit/control/auth", toolRuntimes: "/orbit/runtimes/tools" }, windowsMounts = [], heads = {}, read = () => "" } = {}) {
  const ran = [];
  const scratches = [];
  const run = (file, args, options) => (ran.push({ file, args, options }), answers[file] ?? { error: Object.assign(new Error("no"), { code: "ENOENT" }) });
  const scratch = () => (scratches.push({ dir: `/scratch/${scratches.length}`, disposed: false }), ((s) => ({ dir: s.dir, dispose: () => { s.disposed = true; } }))(scratches.at(-1)));
  return { ctx: { platform, arch, env, projectRoot: null, receipts, rooms, node: "/node", exists: (p) => files.includes(p), read, head: (p) => heads[p] ?? null, windowsMounts, run, scratch, now: () => "t" }, ran, scratches };
}

const AZ = (v) => ({ status: 0, stdout: `azure-cli                         ${v}\n\ncore                              ${v}\n`, stderr: "" });

test("a probe of a profile tool runs under the launcher's environment, in a scratch profile that is removed -- and never in the session directory", () => {
  const m = machine({ files: ["/usr/bin/az"], answers: { "/usr/bin/az": AZ("2.85.0") }, env: HOSTILE("/Users/dev") });
  const found = detectTool(SYSTEM, m.ctx);
  assert.deepEqual([found.status, found.source, found.version], ["ready", "system", "2.85.0"]);
  const [asked] = m.ran;
  assert.deepEqual(asked.args, ["--version"]);
  assert.equal(asked.options.env.AZURE_CONFIG_DIR, "/scratch/0", "the profile of a probe is made for it");
  assert.equal(asked.options.timeoutMs, 60000, "a tool that starts an interpreter gets the row's own deadline");
  assert.equal(Object.keys(asked.options.env).includes("AZURE_DEVOPS_EXT_PAT"), false);
  assert.deepEqual(m.scratches, [{ dir: "/scratch/0", disposed: true }], "removed after the question");
  assert.deepEqual(found.launch, { file: "/usr/bin/az", args: [] }, "what a caller starts it with");
});

test("a version below the row's minimum is found and not used", () => {
  const m = machine({ files: ["/usr/bin/az"], answers: { "/usr/bin/az": AZ("2.40.0") } });
  const found = detectTool(SYSTEM, m.ctx);
  assert.deepEqual([found.status, found.reason], ["missing", "found 2.40.0, older than the 2.61.0 this needs"]);
});

test("a private copy is found from its receipt and nowhere else: an `az` on PATH is not it", () => {
  const nowhere = machine({ files: ["/usr/bin/az"], answers: { "/usr/bin/az": AZ("2.85.0") } });
  const found = detectTool(PRIVATE, nowhere.ctx);
  assert.equal(found.status, "missing");
  assert.deepEqual(found.sources.map((s) => s.source), ["orbit-managed"], "PATH is not even looked at");
  assert.deepEqual(nowhere.ran, [], "and nothing was run");
});

test("a private copy runs as its build says -- an interpreter and `-IBm azure.cli` -- on every platform, with that platform's separators", () => {
  const cases = [
    { p: PLATFORMS[0], row: WIN, file: "C:\\Users\\dev\\.orbit\\projects\\runtimes\\tools\\azure-cli-private-win\\2.91.0-win32-x64\\python.exe", dir: "azure-cli-private-win\\2.91.0-win32-x64", bin: "python.exe" },
    { p: PLATFORMS[3], row: PRIVATE, file: "/Users/dev/.orbit/projects/runtimes/tools/azure-cli-private/2.91.0-darwin-arm64/venv/bin/python", dir: "azure-cli-private/2.91.0-darwin-arm64", bin: "venv/bin/python" },
    { p: PLATFORMS[5], row: PRIVATE, file: "/home/dev/.orbit/projects/runtimes/tools/azure-cli-private/2.91.0-linux-arm64/venv/bin/python", dir: "azure-cli-private/2.91.0-linux-arm64", bin: "venv/bin/python" },
  ];
  for (const c of cases) {
    const toolRuntimes = c.p.authSessions.replace(/[\\/]control[\\/]auth$/, c.p.platform === "win32" ? "\\runtimes\\tools" : "/runtimes/tools");
    const receipt = { tool: c.row.id, version: "2.91.0", platform: c.p.platform, arch: c.p.arch, home: "toolRuntimes", dir: c.dir, bin: c.bin };
    const m = machine({ platform: c.p.platform, arch: c.p.arch, files: [c.file], answers: { [c.file]: AZ("2.91.0") }, receipts: [receipt], rooms: { authSessions: c.p.authSessions, toolRuntimes }, env: { PATH: "" } });
    const found = detectTool(c.row, m.ctx);
    assert.deepEqual([found.status, found.source, found.path], ["ready", "orbit-managed", c.file], `${c.p.platform}-${c.p.arch}`);
    assert.deepEqual(m.ran[0].args, ["-IBm", "azure.cli", "--version"]);
    if (c.p.platform === "win32") assert.equal(m.ran[0].options.env.AZ_INSTALLER, "ZIP", "the ZIP says it was installed as one");
  }
});

test("Windows: a `.cmd` wrapper is never run; the interpreter beside it is, with the arguments the wrapper itself would pass", () => {
  const wbin = "C:\\Program Files\\Microsoft SDKs\\Azure\\CLI2\\wbin";
  const python = "C:\\Program Files\\Microsoft SDKs\\Azure\\CLI2\\python.exe";
  const m = machine({ platform: "win32", files: [`${wbin}\\az.cmd`, python], answers: { [python]: AZ("2.91.0") }, env: { PATH: wbin, PATHEXT: ".EXE;.CMD" }, read: () => "@echo off\r\n\"%~dp0\\..\\python.exe\" -IBm azure.cli %*\r\n" });
  const found = detectTool(SYSTEM, m.ctx);
  assert.deepEqual([found.status, found.path, found.launch], ["ready", `${wbin}\\az.cmd`, { file: python, args: ["-IBm", "azure.cli"] }]);
  assert.deepEqual(m.ran.map((r) => [r.file, ...r.args]), [[python, "-IBm", "azure.cli", "--version"]], "started directly, argv, no shell");
  const without = machine({ platform: "win32", files: [`${wbin}\\az.cmd`], env: { PATH: wbin, PATHEXT: ".CMD" } });
  assert.match(detectTool(SYSTEM, without.ctx).reason, /shim whose target could not be resolved/, "no interpreter beside it: refused, never guessed");
});

test("WSL: a Windows program on PATH is Windows' own -- refused by where it is and by what it is -- and the Linux one beside it is used", () => {
  const windows = "/mnt/c/Program Files (x86)/Microsoft SDKs/Azure/CLI2/wbin/az";
  const copied = "/opt/tools/az";
  const linux = "/usr/bin/az";
  const m = machine({ files: [windows, copied, linux], answers: { [linux]: AZ("2.91.0"), [windows]: AZ("2.91.0"), [copied]: AZ("2.91.0") }, env: { PATH: "/mnt/c/Program Files (x86)/Microsoft SDKs/Azure/CLI2/wbin:/opt/tools:/usr/bin" }, windowsMounts: ["/mnt/"], heads: { [copied]: "MZ" } });
  const found = detectTool(SYSTEM, m.ctx);
  assert.deepEqual([found.status, found.path], ["ready", linux]);
  assert.deepEqual(m.ran.map((r) => r.file), [linux], "neither Windows program was ever started");
  const only = machine({ files: [windows], answers: { [windows]: AZ("2.91.0") }, env: { PATH: "/mnt/c/Program Files (x86)/Microsoft SDKs/Azure/CLI2/wbin" }, windowsMounts: ["/mnt/"] });
  assert.match(detectTool(SYSTEM, only.ctx).reason, /Windows program seen through WSL interop/);
  const notWsl = machine({ files: [windows], answers: { [windows]: AZ("2.91.0") }, env: { PATH: "/mnt/c/Program Files (x86)/Microsoft SDKs/Azure/CLI2/wbin" } });
  assert.equal(detectTool(SYSTEM, notWsl.ctx).status, "ready", "outside WSL nothing changes");
  assert.equal(detectTool(row("git"), only.ctx).status, "missing", "a row that does not ask for `native` is looked at as before");
});

test("a launcher for a tool with no profile is the file and its arguments and nothing else: every other tool is started exactly as it was", () => {
  const found = { launch: { file: "/usr/bin/git", args: [] } };
  const got = launcherOf(row("git"), found, { platform: "linux" }, "probe");
  assert.deepEqual([got.file, got.args, got.env, got.profileDir], ["/usr/bin/git", [], undefined, null]);
});

test("a session launcher never creates anything: the directory is named, and the caller makes it before the first write", () => {
  const found = { launch: { file: "/usr/bin/az", args: [] }, source: "system" };
  const m = machine({});
  const got = launcherOf(SYSTEM, found, m.ctx, "session");
  assert.equal(got.profileDir, "/orbit/control/auth/azure-cli");
  assert.equal(got.env.AZURE_CONFIG_DIR, "/orbit/control/auth/azure-cli");
  assert.deepEqual(m.scratches, [], "no scratch directory for a session");
});

// ---- ONE owner -----------------------------------------------------------------------------------------------------

const codeOf = (dir) => readdirSync(join(REPO, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() && !["node_modules", "public", "dist"].includes(e.name) ? codeOf(join(dir, e.name)) : /\.(mjs|ts|tsx)$/.test(e.name) ? [join(dir, e.name)] : []));

test("the name of the profile variable lives in the catalog and nowhere in code: the one owner reads it from the row", () => {
  const files = ["src", "cli", "skills", "control-server/src", "control-panel/src"].flatMap(codeOf);
  const holders = files.filter((f) => /AZURE_CONFIG_DIR/.test(readFileSync(join(REPO, f), "utf8").replace(/^\s*(\/\/|\*|\/\*).*$/gm, "")));
  assert.deepEqual(holders, [], "code names no profile variable");
});
