#!/usr/bin/env node
// Start Orbit Control on a Node that can run it, whichever Node started this.
//
//   node <plugin>/skills/orbit-control/start.mjs [--port=<n>]    start it; Ctrl+C stops it
//   node <plugin>/skills/orbit-control/start.mjs --which         which Node it would use, and stop
//   node <plugin>/skills/orbit-control/start.mjs --install-runtime [--which]
//        no Node here is new enough? download the official LTS into the plugin's
//        own store first (install.mjs) -- the system Node, nvm and PATH untouched
//
// Nothing is downloaded without --install-runtime, and an installed runtime is
// reused. Everything else after the script name is handed to
// control-server/src/main.mjs as is. The server prints the one URL that carries
// the edit token; this script adds nothing to it and keeps nothing of it.
//
// Exit 1: no Node here is new enough (what to do is printed). Exit 3: the
// runtime could not be installed (offline, a proxy, a checksum that did not
// match). Otherwise the server's own exit code.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { required, supported } from "../../control-server/src/runtime.mjs";
import { storeBase } from "../../src/project/repository.mjs";
import { installRuntime, targetOf } from "./install.mjs";
import { candidates, pick } from "./node.mjs";

const MAIN = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "control-server", "src", "main.mjs");
const INSTALL = "--install-runtime";
const TARGET = targetOf(process.platform, process.arch);

async function main(argv) {
  const root = runtimeRoot();
  const found = findNode(root) ?? (argv.includes(INSTALL) ? await installed(root) : null);
  if (!found) return missing(root);
  if (argv.includes("--which")) return console.log(`${found.node} (Node ${found.version})`);
  run(found.node, argv.filter((a) => a !== INSTALL));
}

// Beside the backups, in the store ORBIT_STORE_DIR already relocates, and never
// inside a repository (storeBase refuses that). null when no store can be named.
function runtimeRoot() {
  try { return join(storeBase(process.env), "control-runtime"); }
  catch { return null; }
}

function findNode(root) {
  const runtime = root && TARGET ? { root, bin: TARGET.bin } : undefined;
  return pick(candidates({ env: process.env, home: homedir(), execPath: process.execPath, list, runtime }), versionOf, supported);
}

async function installed(root) {
  if (!root || !TARGET) return blocked(`a private runtime cannot be installed here (${!root ? "no store directory can be named" : `no official build for ${process.platform}-${process.arch}`})`);
  try { await installRuntime(realIo(root)); }
  catch (e) { return blocked(`the runtime could not be installed: ${e.message}`); }
  return findNode(root) ?? blocked("the runtime was installed but does not run on this machine");
}

const realIo = (root) => ({ root, target: TARGET, supported, getJson, getText, getBytes, sha256, exists: existsSync, unpack, log: (line) => console.error(line) });

function list(dir) {
  try { return readdirSync(dir); }
  catch { return []; }
}

// The running Node answers without a child process; anything else is asked.
function versionOf(node) {
  if (node === process.execPath) return process.versions.node;
  const said = spawnSync(node, ["--version"], { encoding: "utf8", timeout: 5000 });
  return said.status === 0 ? said.stdout.trim().replace(/^v/, "") : null;
}

async function fetched(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response;
}

const getJson = async (url) => (await fetched(url)).json();
const getText = async (url) => (await fetched(url)).text();
const getBytes = async (url) => Buffer.from(await (await fetched(url)).arrayBuffer());
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Extracted beside its final place, then renamed into it: start.mjs never sees
// half a runtime. tar reads .tar.gz everywhere and .zip on Windows (bsdtar),
// and is given argv, never a shell.
function unpack(bytes, asset, folder, dir) {
  mkdirSync(dirname(dir), { recursive: true });
  const tmp = mkdtempSync(join(dirname(dir), ".install-"));
  try { placed(bytes, asset, folder, tmp, dir); }
  finally { rmSync(tmp, { recursive: true, force: true }); }
  return dir;
}

function placed(bytes, asset, folder, tmp, dir) {
  writeFileSync(join(tmp, asset), bytes);
  const tar = spawnSync("tar", ["-xf", join(tmp, asset), "-C", tmp], { encoding: "utf8" });
  if (tar.status !== 0) throw new Error(`tar could not unpack ${asset}: ${(tar.stderr || tar.error?.message || "").trim()}`);
  renameSync(join(tmp, folder), dir);
}

function missing(root) {
  console.error(`Orbit Control needs Node ${required()}, and none was found here (this is ${process.version}).`);
  if (root && TARGET) console.error(`Run again with ${INSTALL} to download the official Node LTS into ${root} (checked against nodejs.org's SHA-256). The system Node, nvm and PATH are not touched.`);
  console.error("Or install one yourself (with nvm: nvm install 24), or point ORBIT_CONTROL_NODE at a node binary that is.");
  process.exit(1);
}

function blocked(message) {
  console.error(message);
  process.exit(3);
}

function run(node, argv) {
  const child = spawn(node, [MAIN, ...argv], { stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 0 : 1)));
}

main(process.argv.slice(2));
