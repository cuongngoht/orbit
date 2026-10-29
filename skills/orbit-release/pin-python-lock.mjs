#!/usr/bin/env node
// Re-pin a `python-lock` tool (catalog/tools.json): write the LOCK of one package for each platform, in the grammar
// src/tools/lock.mjs holds an install to.
//
//   node skills/orbit-release/pin-python-lock.mjs --python=<interpreter> --package=<name>==<version> \
//        [--platform=darwin-arm64,linux-x64,...] [--out=catalog/locks]
//
//   --python    the interpreter that RESOLVES -- Orbit's own pinned Python (the `python` row), run with -I
//   --package   the one distribution, pinned: `azure-cli==2.91.0`. A name alone, or a range, is refused: a lock is
//               made of exact versions and "latest" is never what a release ships
//   --platform  platform keys (default: every key in PLATFORMS); a platform whose closure has no wheel for something
//               is reported and gets NO lock -- it is then installed by no one, never by a build
//   --out       where the locks go (default catalog/locks), one `<package>-<version>-<platform>.lock` each
//
// How: the closure is RESOLVED -- by pip itself for the platform this runs on (a dry run that installs nothing, the
// authoritative answer: what `pip install` of the package picks), and by uv for the others, preferring the exact versions
// pip picked here (pip evaluates environment markers against the interpreter it runs on, so it cannot answer for another
// operating system; uv can). Where a platform needs another release (a package can drop a platform's wheels) the lock says
// so in its header, and a pre-release that nobody asked for is refused for a person to look at. For every distribution in the closure
// PyPI's own record is asked for the SHA-256 of EVERY wheel that could be installed on that platform -- not only the
// one pip picked here, because a machine with another operating-system version may pick another wheel of the same
// release, and --require-hashes would then refuse a file the lock never heard of. Source distributions are never
// accepted: an install builds nothing. Needs the network, and `uv` for any platform but this one; a release does it, an
// install never does.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { lockProblems } from "../../src/tools/lock.mjs";

const REPO = join(fileURLToPath(new URL("../..", import.meta.url)));
const TARGET = { python: "3.13", abi: "cp313" };

// `uv` is what uv calls the platform, for a closure pip cannot resolve from here; `family` says which wheel platform
// tags belong to the platform, for the hashes.
export const PLATFORMS = {
  "darwin-arm64": { uv: "aarch64-apple-darwin", family: /^macosx_\d+_\d+_(arm64|universal2)$/ },
  "darwin-x64": { uv: "x86_64-apple-darwin", family: /^macosx_\d+_\d+_(x86_64|universal2|intel)$/ },
  "linux-x64": { uv: "x86_64-unknown-linux-gnu", family: /^(manylinux\w*_x86_64|linux_x86_64)$/ },
  "linux-arm64": { uv: "aarch64-unknown-linux-gnu", family: /^(manylinux\w*_aarch64|linux_aarch64)$/ },
  "win32-x64": { uv: "x86_64-pc-windows-msvc", family: /^win_amd64$/ },
  "win32-arm64": { uv: "aarch64-pc-windows-msvc", family: /^win_arm64$/ },
};

const HOST = `${process.platform}-${process.arch}`;

const argOf = (argv, name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

// A wheel's name says where it runs: {dist}-{version}[-{build}]-{python}-{abi}-{platform}.whl
export function wheelTags(filename) {
  const parts = String(filename).replace(/\.whl$/, "").split("-");
  return { python: parts.at(-3).split("."), abi: parts.at(-2).split("."), platform: parts.at(-1).split(".") };
}

// Could this wheel be installed by CPython 3.13 on this platform? Pure Python for 3; the stable ABI from 3.2 up to 3.13;
// or built for exactly 3.13 (never the free-threaded `t` build).
export function installable(filename, platform) {
  const t = wheelTags(filename);
  const pure = t.python.some((p) => /^py3\d{0,2}$/.test(p) && (p === "py3" || Number(p.slice(2)) <= 13));
  const built = t.abi.includes("abi3") ? t.python.some((p) => /^cp3\d+$/.test(p) && Number(p.slice(3)) <= 13) : t.abi.includes(TARGET.abi);
  return (pure || built) && t.platform.some((p) => p === "any" || PLATFORMS[platform].family.test(p));
}

// pip resolves THIS platform; its `report` lists what it would install, and which wheel it chose.
function pipClosure(python, spec) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-pin-"));
  try { return pipResolution(python, spec, dir); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

function pipResolution(python, spec, dir) {
  const args = ["-I", "-m", "pip", "install", "--isolated", "--dry-run", "--ignore-installed", "--only-binary=:all:", "--no-cache-dir", "--disable-pip-version-check", "--quiet", "--report", join(dir, "report.json"), spec];
  const r = spawnSync(python, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`pip could not resolve ${spec}: ${tail(r.stderr)}`);
  return JSON.parse(readFileSync(join(dir, "report.json"), "utf8")).install.map((i) => ({ name: i.metadata.name, version: i.metadata.version, chosen: decodeURIComponent(i.download_info.url.split("/").pop()) }));
}

const tail = (text) => String(text).trim().split("\n").slice(-3).join(" | ");

// uv resolves ANOTHER platform, preferring the versions pip picked here: they are written as the output file uv starts
// from, which it keeps wherever it can and re-picks only where a platform needs another release (a release can drop a
// platform's wheels, and what requires it follows). Only wheels are ever accepted.
function uvClosure(spec, platform, host) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-pin-"));
  try { return uvResolution(spec, platform, host, dir); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

function uvResolution(spec, platform, host, dir) {
  const out = join(dir, "closure.txt");
  writeFileSync(out, `${host.map((d) => `${d.name}==${d.version}`).join("\n")}\n`);
  const r = spawnSync("uv", uvArgs(platform, out), { input: `${spec}\n`, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`uv could not resolve ${spec} for ${platform}: ${tail(r.stderr || r.error?.message)}`);
  return reviewed(closureIn(readFileSync(out, "utf8")), host, platform);
}

const uvArgs = (platform, out) => ["pip", "compile", "-", "--python-platform", PLATFORMS[platform].uv, "--python-version", TARGET.python, "--only-binary", ":all:", "--prerelease=allow", "-o", out, "--no-header", "--no-annotate", "--no-cache", "--quiet"];

const closureIn = (text) => text.split("\n").filter((l) => l.includes("==")).map((l) => ({ name: l.split("==")[0].trim(), version: l.split("==")[1].trim() }));

// What differs from what pip picked here can only be what the platform needs -- and a pre-release among those is for a
// person to decide, never for a lock to ship by accident (the pre-releases azure-cli itself pins are the host's own).
function reviewed(closure, host, platform) {
  const same = new Set(host.map((d) => `${d.name.toLowerCase()}==${d.version}`));
  const risky = closure.filter((d) => !same.has(`${d.name.toLowerCase()}==${d.version}`) && /\d(a|b|rc|dev)\d/.test(d.version));
  if (risky.length) throw new Error(`${platform} would ship a pre-release nobody asked for: ${risky.map((d) => `${d.name}==${d.version}`).join(", ")}`);
  return closure;
}

const records = new Map();

async function recordOf(name, version) {
  const key = `${name}@${version}`;
  if (!records.has(key)) records.set(key, fetch(`https://pypi.org/pypi/${encodeURIComponent(name)}/${encodeURIComponent(version)}/json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`PyPI answered ${r.status} for ${key}`)))));
  return records.get(key);
}

// Every wheel of the release that could be installed on the platform (a yanked file is never one).
async function installableWheels(dist, platform) {
  const record = await recordOf(dist.name, dist.version);
  return record.urls.filter((u) => u.packagetype === "bdist_wheel" && !u.yanked && installable(u.filename, platform));
}

// ...with its SHA-256, and -- when pip chose one -- the proof that the one it chose is among them.
async function hashesOf(dist, platform) {
  const files = await installableWheels(dist, platform);
  if (dist.chosen && !files.some((u) => u.filename === dist.chosen)) throw new Error(`${dist.name}==${dist.version}: the wheel pip chose for ${platform} (${dist.chosen}) is not among the release's installable wheels`);
  return files.map((u) => u.digests.sha256).sort();
}

// Where this platform's closure is not the host's, said in the lock itself: a reader sees what was re-picked and why.
function differences(closure, host) {
  const picked = new Map(host.map((d) => [d.name.toLowerCase(), d.version]));
  const changed = closure.filter((d) => picked.has(d.name.toLowerCase()) && picked.get(d.name.toLowerCase()) !== d.version);
  return changed.map((d) => `# re-picked for this platform: ${d.name}==${d.version} (the host's pick, ${picked.get(d.name.toLowerCase())}, could not be kept there)`);
}

const lineOf = (dist, hashes) => `${dist.name}==${dist.version} ${hashes.map((h) => `--hash=sha256:${h}`).join(" ")}`;

const header = (spec, platform, count) => [`# The lock of ${spec} for ${platform}: every distribution of its closure, exactly, and every SHA-256 pip may accept.`, `# Generated by skills/orbit-release/pin-python-lock.mjs for CPython ${TARGET.python}, ${count} distributions; edit nothing by hand -- re-pin.`, "# Grammar: src/tools/lock.mjs. An install runs pip with --require-hashes --only-binary=:all: --no-deps over exactly this file.", ""];

async function lockOf(python, spec, platform, host) {
  const closure = [...(platform === HOST ? host : uvClosure(spec, platform, host))].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  const lines = await Promise.all(closure.map(async (d) => lineOf(d, await hashesOf(d, platform))));
  return `${[...header(spec, platform, closure.length), ...differences(closure, host), ...lines].join("\n")}\n`;
}

async function pin(python, spec, platform, out, host) {
  const text = await lockOf(python, spec, platform, host);
  const problems = lockProblems(text);
  if (problems.length) throw new Error(`the lock for ${platform} is not in the grammar: ${problems[0]}`);
  return written(join(out, `${spec.replace("==", "-")}-${platform}.lock`), text, platform);
}

function written(file, text, platform) {
  writeFileSync(file, text);
  return `${platform}: ${file} (${text.split("\n").filter((l) => l && !l.startsWith("#")).length} distributions)`;
}

async function main(argv) {
  const [python, spec] = [argOf(argv, "python"), argOf(argv, "package")];
  if (!python || !/^[A-Za-z0-9][A-Za-z0-9._-]*==[A-Za-z0-9.!+_-]+$/.test(spec ?? "")) throw new Error("usage: pin-python-lock.mjs --python=<interpreter> --package=<name>==<version> [--platform=…] [--out=catalog/locks]");
  const out = argOf(argv, "out") ?? join(REPO, "catalog", "locks");
  mkdirSync(out, { recursive: true });
  for (const line of await pinned({ python, spec, out, platforms: (argOf(argv, "platform") ?? Object.keys(PLATFORMS).join(",")).split(",") })) console.log(line);
}

async function pinned({ python, spec, out, platforms }) {
  const host = pipClosure(python, spec);
  return Promise.all(platforms.map((platform) => settled(() => pin(python, spec, platform, out, host), platform)));
}

async function settled(run, platform) {
  try { return await run(); }
  catch (error) { return `${platform}: NO LOCK -- ${error.message}`; }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
