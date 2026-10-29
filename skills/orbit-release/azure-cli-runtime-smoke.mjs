#!/usr/bin/env node
// The EVIDENCE a platform gets for the private Azure CLI runtime: Orbit's own installer, into a temporary store, then
// the real program asked three things -- on THIS machine, with a decoy "developer profile" in the environment.
//
//   node skills/orbit-release/azure-cli-runtime-smoke.mjs [--expect=installed|unsupported] [--keep]
//
//   installed     the runtime is fetched and verified (pinned archive or lock), runs as the version the catalog pins,
//                 and -- with a decoy profile named in the environment and a decoy HOME -- asking who is signed in
//                 answers "sign in required", creates no session directory, and leaves the decoy byte for byte as it was
//   unsupported   the platform has no private runtime (Microsoft publishes no Windows ARM64 build); the answer is the
//                 refusal, naming it, and nothing was installed
//
// It prints ONE line of JSON (the record to paste into ADR 0043's "Platform evidence" table) and exits non-zero when
// the platform did not do what was expected. It needs the network. Nothing here is a test of the suite: the suite runs
// no network and no real `az`; this is what a person runs, or the `azure-cli-runtime` workflow runs per platform.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogFile, readCatalog } from "../../src/catalog.mjs";
import { createProcess } from "../../src/process/index.mjs";
import { childEnv } from "../../src/process/env.mjs";
import { stateRooms } from "../../src/store/control.mjs";
import { realIo } from "../../src/store/io.mjs";
import { toolCatalog } from "../../src/tools/catalog.mjs";
import { azureCliAdapter } from "../orbit-report/auth/azure-cli.mjs";
import { createToolsPort } from "../orbit-report/auth/tools.mjs";
import { providers } from "../orbit-report/pack.mjs";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const IDS = ["azure-cli-private", "azure-cli-private-win"];
const argOf = (argv, name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

// What a directory holds, as one digest: every path and every byte, in order.
function digestOf(dir) {
  const hash = createHash("sha256");
  for (const file of filesIn(dir).sort()) hash.update(`${file}\n`).update(readFileSync(join(dir, file)));
  return hash.digest("hex");
}

const filesIn = (dir, prefix = "") => readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesIn(dir, join(prefix, e.name)) : [join(prefix, e.name)]));

// A stand-in for a developer's own Azure CLI profile, named in the environment as theirs would be.
function decoyIn(home) {
  mkdirSync(join(home, ".azure"), { recursive: true });
  writeFileSync(join(home, ".azure", "config"), "[defaults]\nlocation = nowhere\n");
  return digestOf(join(home, ".azure"));
}

async function settled(run) {
  try { return { ok: true, value: await run() }; }
  catch (error) { return { ok: false, code: error.code ?? "ERROR", message: String(error.message).slice(0, 300) }; }
}

const strategy = () => providers().find((p) => p.id === "azure-devops").authentication.strategies.find((s) => s.id === "azure-cli");

const toolsOver = (base, env, process, log) => createToolsPort({ pluginRoot: REPO, env, rooms: stateRooms(join(base, "store")), io: realIo(), process, log });

// What the program says when asked: who is signed in (it must say nobody, and create nothing), and its version.
async function verified(got, home, decoy, process) {
  const adapter = azureCliAdapter({ tools: { ensure: async () => got, find: () => ({ found: got, tried: [], acquirable: null }) }, process, io: realIo(), nowMs: Date.now });
  const state = await adapter.status({ connection: { id: "smoke", auth: { strategy: "azure-cli" } }, strategy: strategy() });
  return { state: state.state, version: await versionOf(got, process), sessionDirCreated: existsSync(got.launcher("session").profileDir), decoyUntouched: digestOf(join(home, ".azure")) === decoy };
}

async function versionOf(got, process) {
  const probe = got.launcher("probe");
  const said = process.run(probe.file, [...probe.args, "--version"], { env: probe.env, cwd: probe.profileDir, timeoutMs: 120_000 });
  probe.release();
  return /azure-cli\s+(\d+\.\d+\.\d+)/.exec(`${said.out}${said.err}`)?.[1] ?? null;
}

async function timed(run) {
  const started = Date.now();
  const value = await run();
  return { value, seconds: Math.round((Date.now() - started) / 1000) };
}

const failure = (got) => ({ result: "failed", code: got.code, detail: got.message });

async function installed(base, home, env) {
  const process = createProcess();
  const decoy = decoyIn(home);
  const got = await timed(() => settled(() => toolsOver(base, env, process, (m) => console.error(m)).ensure(IDS)));
  if (!got.value.ok) return failure(got.value);
  return { result: "installed", source: got.value.value.source, acquired: got.value.value.acquired, seconds: got.seconds, ...(await verified(got.value.value, home, decoy, process)) };
}

async function unsupported(base, env) {
  const got = await settled(() => toolsOver(base, env, createProcess(), () => {}).ensure(IDS));
  if (got.ok) return { result: "installed-unexpectedly" };
  return got.code === "TOOL_UNSUPPORTED" ? { result: "unsupported", code: got.code, detail: got.message } : failure(got);
}

const meets = (expect, r) => (expect === "unsupported" ? r.result === "unsupported" : r.result === "installed" && r.state === "sign-in-required" && r.sessionDirCreated === false && r.decoyUntouched === true && r.version === "2.91.0");

// The variable a tool names its profile by is the catalog row's to say, as everywhere else.
const profileVariable = () => toolCatalog(readCatalog(realIo(), catalogFile(REPO, "tools"))).find((r) => r.id === IDS[0]).profile.env;

// A temporary store, and a home with a profile in it that is not Orbit's: both named in the environment as a developer's would be.
function workspace() {
  const base = mkdtempSync(join(tmpdir(), "orbit-smoke-"));
  const home = join(base, "home");
  return { base, home, env: { ...childEnv(globalThis.process.env, []), HOME: home, USERPROFILE: home, [profileVariable()]: join(home, ".azure") } };
}

function report(expect, record) {
  console.log(JSON.stringify({ platform: globalThis.process.platform, arch: globalThis.process.arch, node: globalThis.process.version, expect, ...record, met: meets(expect, record) }));
  globalThis.process.exitCode = meets(expect, record) ? 0 : 1;
}

async function main(argv) {
  const expect = argOf(argv, "expect") ?? "installed";
  const w = workspace();
  report(expect, expect === "unsupported" ? await unsupported(w.base, w.env) : await installed(w.base, w.home, w.env));
  if (!argv.includes("--keep")) rmSync(w.base, { recursive: true, force: true });
}

if (globalThis.process.argv[1] === fileURLToPath(import.meta.url)) await main(globalThis.process.argv.slice(2));
