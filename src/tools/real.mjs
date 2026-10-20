// The real effects behind tool detection and installation, bound once by a
// composition root. Everything above this file takes them as parameters.
//
// Every process is argv, never a shell. `tar` unpacks every format the catalog
// allows: bsdtar (macOS, Windows 10+) reads .zip too, and GNU tar detects the
// compression of the archive it reads. The download is capped, and bounded in
// time, because a stalled mirror must fail rather than hang a request.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
export const realDetection = (env = process.env) => ({ env, platform: process.platform, arch: process.arch, node: process.execPath, exists: existsSync, read: (p) => readFileSync(p, "utf8"), run: (file, args) => spawnSync(file, args, { encoding: "utf8", timeout: PROBE_TIMEOUT_MS, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], cwd: tmpdir() }) });

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
