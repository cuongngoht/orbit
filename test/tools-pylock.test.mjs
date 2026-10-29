// The `python-lock` installer (src/tools/pylock.mjs), over a real temporary store with only the Process port faked:
// what pip is told, in what order and from where; that a lock which is not the grammar installs nothing; and that an
// install that fails at any step leaves no receipt, no staged directory and nothing where detection looks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { Blocked } from "../src/errors.mjs";
import { childEnv } from "../src/process/env.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { realIo } from "../src/store/io.mjs";
import { toolCatalog } from "../src/tools/catalog.mjs";
import { installTool } from "../src/tools/install.mjs";
import { PIP_FLAGS, pythonLockInstaller } from "../src/tools/pylock.mjs";
import { realInstallIo } from "../src/tools/real.mjs";
import { createToolState } from "../src/tools/state.mjs";

const REPO = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const ROWS = toolCatalog(JSON.parse(readFileSync(join(REPO, "catalog", "tools.json"), "utf8")));
const ROW = ROWS.find((r) => r.id === "azure-cli-private");
const ASSET = ROW.install.assets["linux-x64"];
const LOCK = readFileSync(join(REPO, "catalog", ASSET.lock), "utf8");
const PARENT = { PATH: "/usr/bin", HOME: "/home/dev", AZURE_CONFIG_DIR: "/home/dev/.azure", AZURE_DEVOPS_EXT_PAT: "a-secret", PIP_INDEX_URL: "https://evil.example/simple", HTTPS_PROXY: "http://proxy.example:3128", SSL_CERT_FILE: "/etc/ssl/corp.pem", SECRET_TOKEN: "x" };

function world(opts = {}) {
  const base = mkdtempSync(join(tmpdir(), "orbit-pylock-"));
  const rooms = stateRooms(base);
  const calls = [];
  const asked = [];
  const scratches = [];
  const text = opts.lock ?? LOCK;
  const ran = async (file, args, o) => {
    calls.push({ file, args, o });
    if (args.includes("venv")) stage(args.at(-1));
    if (args.includes("pip") && opts.pip === "fail") return { ok: false, out: "", err: "ERROR: THESE PACKAGES DO NOT MATCH THE HASHES FROM THE REQUIREMENTS FILE" };
    if (args.includes("pip")) writeFileSync(join(dirname(dirname(dirname(file))), "installed"), "x");
    return { ok: true, out: "", err: "", status: 0 };
  };
  const stage = (venv) => (mkdirSync(join(venv, "bin"), { recursive: true }), writeFileSync(join(venv, "bin", "python"), ""));
  const run = (file, args, o) => (asked.push({ file, args, o }), existsSync(join(dirname(dirname(dirname(file))), "installed")) ? { status: 0, stdout: `azure-cli                         ${opts.version ?? "2.91.0"}\n`, stderr: "" } : { error: Object.assign(new Error("no"), { code: "ENOENT" }) });
  const ctx = { platform: "linux", arch: "x64", env: PARENT, rooms, io: realInstallIo(), process: { runAsync: ran }, ensurePython: async () => (opts.python === "missing" ? Promise.reject(new Blocked("no private Python")) : { file: "/orbit/python/bin/python3" }), lockFile: () => ({ path: "/plugin/catalog/locks/x.lock", text }), exists: existsSync, run, scratch: () => (scratches.push({ dir: `/scratch/${scratches.length}` }), { dir: `/scratch/${scratches.length - 1}`, dispose: () => {} }), now: () => "2026-10-29T00:00:00.000Z", installers: { "python-lock": pythonLockInstaller }, state: createToolState(rooms, realIo()) };
  return { ctx, base, rooms, calls, asked, scratches, final: join(rooms.toolRuntimes, "azure-cli-private", "2.91.0-linux-x64") };
}

const leftovers = (w) => (existsSync(join(w.rooms.toolRuntimes, "azure-cli-private")) ? readdirSync(join(w.rooms.toolRuntimes, "azure-cli-private")).filter((n) => n.startsWith(".install-")) : []);

test("the install builds Orbit's own environment, runs pip over exactly the lock with every flag that keeps it to the lock, verifies, and receipts last", async () => {
  const w = world();
  const receipt = await installTool(ROW, w.ctx);
  assert.equal(w.calls.length, 2);
  const [venv, pip] = w.calls;
  assert.deepEqual([venv.file, venv.args.slice(0, 3)], ["/orbit/python/bin/python3", ["-I", "-m", "venv"]], "built from Orbit's interpreter, in isolated mode");
  assert.equal(venv.args[3].endsWith(join("venv")), true);
  assert.deepEqual(pip.args, ["-I", "-m", "pip", "install", ...PIP_FLAGS, "-r", "/plugin/catalog/locks/x.lock"], "pip is told the lock and nothing else");
  assert.deepEqual(PIP_FLAGS.slice().sort(), ["--disable-pip-version-check", "--isolated", "--no-cache-dir", "--no-deps", "--no-input", "--only-binary=:all:", "--require-hashes"]);
  assert.equal(pip.file.startsWith(join(w.rooms.toolRuntimes, "azure-cli-private", ".install-")), true, "run from the STAGED environment");
  assert.equal(existsSync(join(w.final, "venv", "bin", "python")), true, "promoted into place");
  assert.deepEqual(leftovers(w), [], "the staging directory is gone");
  assert.deepEqual([receipt.version, receipt.dir, receipt.bin, receipt.checksum, receipt.source, receipt.reused], ["2.91.0", join("azure-cli-private", "2.91.0-linux-x64"), "venv/bin/python", `sha256:${createHash("sha256").update(LOCK).digest("hex")}`, `lock:${ASSET.lock}`, false]);
  assert.equal(JSON.stringify(w.ctx.state.receipts()).includes(w.base), false, "a receipt holds relative paths, never an absolute one");
  rmSync(w.base, { recursive: true, force: true });
});

test("nothing the person's environment says reaches a child of the install: no profile, no secret, no pip configuration -- a proxy and a certificate bundle do", async () => {
  const w = world();
  await installTool(ROW, w.ctx);
  for (const { o } of w.calls) {
    assert.deepEqual(o.env, childEnv(PARENT, ROW.launch.inherit));
    assert.deepEqual([o.env.AZURE_CONFIG_DIR, o.env.AZURE_DEVOPS_EXT_PAT, o.env.PIP_INDEX_URL, o.env.SECRET_TOKEN], [undefined, undefined, undefined, undefined]);
    assert.deepEqual([o.env.HTTPS_PROXY, o.env.SSL_CERT_FILE], ["http://proxy.example:3128", "/etc/ssl/corp.pem"]);
    assert.equal(o.cwd.startsWith(join(w.rooms.toolRuntimes, "azure-cli-private", ".install-")), true, "from the stage, never from a checkout");
    assert.ok(o.timeoutMs >= 60_000, "bounded, but long enough for ~150 wheels");
  }
  rmSync(w.base, { recursive: true, force: true });
});

test("no install ever asks pip for anything the lock does not name: no user site, no other index, no link page, no build, no privilege, no system Python", async () => {
  const w = world();
  await installTool(ROW, w.ctx);
  const argv = w.calls.flatMap((c) => [c.file, ...c.args]).join(" ");
  for (const forbidden of ["--user", "--break-system-packages", "--index-url", "--extra-index-url", "--find-links", "--trusted-host", "--no-binary", "--no-build-isolation", "sudo", " -e ", "setup.py", "/usr/bin/python", "--target", "--prefix", "--root"]) assert.equal(argv.includes(forbidden), false, forbidden);
  assert.deepEqual(w.calls.map((c) => c.file === "/orbit/python/bin/python3" || c.file.includes(".install-")), [true, true], "only Orbit's interpreter and the staged environment are ever run");
  rmSync(w.base, { recursive: true, force: true });
});

test("the staged runtime is verified the way it will be run: its own arguments, under the launcher's environment, in a scratch profile", async () => {
  const w = world();
  await installTool(ROW, w.ctx);
  const [first] = w.asked;
  assert.deepEqual(first.args, ["-IBm", "azure.cli", "--version"]);
  assert.equal(first.o.env.AZURE_CONFIG_DIR.startsWith("/scratch/"), true);
  assert.equal(first.o.env.AZURE_CORE_ENABLE_BROKER_ON_WINDOWS, "false");
  assert.equal(first.file.includes(".install-"), true, "asked BEFORE it is put in place");
  rmSync(w.base, { recursive: true, force: true });
});

test("a lock that is not a pinned, hashed list installs nothing: no process is run, nothing is staged, no receipt is written", async () => {
  for (const bad of [`${LOCK}--index-url https://evil.example/simple\n`, `${LOCK}evil @ https://evil.example/evil.whl\n`, LOCK.replace(/ --hash=sha256:[a-f0-9]{64}/, "")]) {
    const w = world({ lock: bad });
    await assert.rejects(() => installTool(ROW, w.ctx), Blocked);
    assert.deepEqual([w.calls.length, w.ctx.state.receipts().length, existsSync(w.final)], [0, 0, false]);
    rmSync(w.base, { recursive: true, force: true });
  }
});

test("a lock that does not pin the row's own package to the row's own version installs nothing", async () => {
  const w = world({ lock: LOCK.split("\n").filter((l) => !l.startsWith("azure-cli==")).join("\n") });
  await assert.rejects(() => installTool(ROW, w.ctx), /does not pin azure-cli to 2\.91\.0/);
  assert.equal(w.calls.length, 0);
  rmSync(w.base, { recursive: true, force: true });
});

test("pip refusing the hashes leaves no receipt, no half-built environment and nothing where detection looks", async () => {
  const w = world({ pip: "fail" });
  await assert.rejects(() => installTool(ROW, w.ctx), /could not install its locked distributions.*DO NOT MATCH THE HASHES.*nothing was installed/);
  assert.deepEqual([w.ctx.state.receipts().length, existsSync(w.final), leftovers(w)], [0, false, []]);
  rmSync(w.base, { recursive: true, force: true });
});

test("an environment that does not name the pinned version is not put in place", async () => {
  const w = world({ version: "2.90.0" });
  await assert.rejects(() => installTool(ROW, w.ctx), /did not answer as 2\.91\.0.*nothing was installed/);
  assert.deepEqual([w.ctx.state.receipts().length, existsSync(w.final), leftovers(w)], [0, false, []]);
  rmSync(w.base, { recursive: true, force: true });
});

test("without a private interpreter nothing is staged -- the machine's Python is never the fallback", async () => {
  const w = world({ python: "missing" });
  await assert.rejects(() => installTool(ROW, w.ctx), /no private Python/);
  assert.deepEqual([w.calls.length, leftovers(w), w.ctx.state.receipts().length], [0, [], 0]);
  rmSync(w.base, { recursive: true, force: true });
});

test("an install that is already in place and answers is reused: nothing is run, the receipt is written again", async () => {
  const w = world();
  await installTool(ROW, w.ctx);
  const again = await installTool(ROW, w.ctx);
  assert.deepEqual([again.reused, w.calls.length], [true, 2], "no new process");
  rmSync(w.base, { recursive: true, force: true });
});

test("a platform the row pins no lock for is refused up front, naming the platform", () => {
  assert.equal(pythonLockInstaller.supports(ROW, "linux", "x64"), null);
  assert.match(pythonLockInstaller.supports(ROW, "win32", "arm64"), /no verified build of .* is pinned for win32-arm64/);
  assert.match(pythonLockInstaller.supports(ROW, "linux", "ia32"), /linux-ia32/);
});
