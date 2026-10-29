// The real effects behind tool detection and installation, bound once by a
// composition root. Everything above this file takes them as parameters.
//
// Every process is argv, never a shell. `tar` unpacks every format the catalog
// allows: bsdtar (macOS, Windows 10+) reads .zip too, and GNU tar detects the
// compression of the archive it reads. The download is capped, and bounded in
// time, because a stalled mirror must fail rather than hang a request.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contained } from "../project/boundary.mjs";

export const DOWNLOAD_LIMIT = 512 * 1024 * 1024;
export const DOWNLOAD_TIMEOUT_MS = 300_000;
const PROBE_TIMEOUT_MS = 10_000;

// What detection needs: does a path exist, what does a binary answer.
//
// A version is asked from a NEUTRAL directory, never from wherever this process was started. A
// tool that reads the directory it runs in -- a version manager's pin, a package manager's
// per-project configuration, a global.json that names an SDK -- would otherwise be handed the
// current checkout's, and a checkout is untrusted data: one such tool runs the program its
// configuration names, with this process's whole environment, and another answers "missing" for
// every project on the machine because THIS checkout pins something that is not installed.
//
// `run` takes an optional third argument -- { env, timeoutMs } -- for a tool that keeps identity state, which is asked
// under an environment of its own (src/tools/launch.mjs), and for one that needs longer than the default deadline.
// Without it the probe is exactly what it always was.
export const realDetection = (env = process.env) => ({ env, platform: process.platform, arch: process.arch, node: process.execPath, windowsMounts: windowsMountsOf(env), exists: existsSync, read: (p) => readFileSync(p, "utf8"), head, scratch, run: probe });

function probe(file, args, o = {}) {
  return spawnSync(file, args, { encoding: "utf8", timeout: o.timeoutMs ?? PROBE_TIMEOUT_MS, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], cwd: tmpdir(), ...(o.env ? { env: o.env } : {}) });
}

// A directory made for ONE question and removed after it -- what a probe of a tool with a profile is given as that
// profile, so asking a version creates nothing in anybody's state.
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "orbit-probe-"));
  return { dir, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

// The first `n` bytes of a file as text -- enough to tell what kind of program it is. A file that cannot be read says
// nothing (null), and nothing is a reason to refuse nothing.
function head(path, n) {
  try { return firstBytes(path, n); }
  catch { return null; }
}

function firstBytes(path, n) {
  const fd = openSync(path, "r");
  try { return readSome(fd, n); }
  finally { closeSync(fd); }
}

function readSome(fd, n) {
  const buffer = Buffer.alloc(n);
  return buffer.subarray(0, readSync(fd, buffer, 0, n, 0)).toString("latin1");
}

// Where WSL mounts Windows' drives -- and nothing at all anywhere else. WSL says so in two places: a variable its
// shell sets, and the kernel's own release string. The mount root is `[automount] root=` of /etc/wsl.conf, `/mnt/` by default.
const windowsMountsOf = (env) => (underWsl(env) ? [mountRoot()] : []);

const underWsl = (env) => process.platform === "linux" && (Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP) || /wsl/i.test(readOr("/proc/sys/kernel/osrelease")));

const mountRoot = () => (/\[automount\][^[]*?^\s*root\s*=\s*(\S+)/m.exec(readOr("/etc/wsl.conf"))?.[1] ?? "/mnt").replace(/\/?$/, "/");

function readOr(path) {
  try { return readFileSync(path, "utf8"); }
  catch { return ""; }
}

// A lock is a file the plugin ships under catalog/, named by a catalog row relative to it (src/tools/catalog.mjs
// pinnedLock, which keeps it inside): read from there and from nowhere else.
export const realLockFile = (pluginRoot) => (rel) => {
  const path = contained(join(pluginRoot, "catalog"), join(pluginRoot, "catalog", rel));
  return { path, text: readFileSync(path, "utf8") };
};

export const realInstallIo = (log = () => {}) => ({ download: (url) => downloaded(url, log), sha256: (bytes) => createHash("sha256").update(bytes).digest("hex"), tempDir, unpack, rename: renameSync, remove: (p) => rmSync(p, { recursive: true, force: true }), setAside });

async function downloaded(url, log) {
  log(`downloading ${url}`);
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  if (Number(response.headers.get("content-length") ?? 0) > DOWNLOAD_LIMIT) throw new Error(`${url} is larger than ${DOWNLOAD_LIMIT} bytes`);
  return Buffer.from(await response.arrayBuffer());
}

function tempDir(parent) {
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(join(parent, ".install-"));
}

function unpack(bytes, asset, tmp) {
  const archive = join(tmp, `archive.${asset.format}`);
  const into = join(tmp, "unpacked");
  writeFileSync(archive, bytes);
  mkdirSync(into);
  return extracted(archive, into);
}

function extracted(archive, into) {
  const tar = spawnSync(tarCommand(), ["-xf", archive, "-C", into], { encoding: "utf8", windowsHide: true });
  if (tar.status !== 0) throw new Error(`tar could not unpack the archive: ${(tar.stderr || tar.error?.message || "").trim().slice(0, 200)}`);
  return into;
}

// On Windows, the bsdtar that ships in System32 BY ITS PATH: a GNU tar earlier
// on PATH (Git's "Unix tools") reads `C:\…` as host `C`, and every archive
// "fails to unpack" on a machine that has a perfectly good tar.
function tarCommand() {
  const system = join(process.env.SystemRoot ?? process.env.SYSTEMROOT ?? "C:\\Windows", "System32", "tar.exe");
  return process.platform === "win32" && existsSync(system) ? system : "tar";
}

// An earlier install that no longer answers is moved aside, not deleted: what
// replaces it has already been verified, and what it was is still inspectable.
function setAside(final) {
  if (existsSync(final)) renameSync(final, `${final}.replaced-${Date.now()}`);
}
