#!/usr/bin/env node
// ORBIT CONTROL ON ITS OWN NODE: what the pipeline's control-server and control-panel jobs held, as one command a person
// runs where the release is made (0.6.0, backlog Q8: no GitHub workflow, and what CI ran stays runnable). Orbit Control
// declares its own Node (control-server/ and control-panel/ `engines`), so on that Node only: the server's tests, the
// panel's clean install, typecheck, tests and build -- and the committed build (control-server/public/) is what the
// source produces. On an older Node nothing runs and the row says so; `ship.mjs --ci` reports it, never requires it.
//
//   node skills/orbit-release/panel.mjs          exit 0 = it held · 2 = it did not, or it could not run here
//   controlPanel(root, env) -> { name, ok, detail }
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NAME = "Orbit Control on its own Node: the server's tests, the panel's install, typecheck, tests and build, and its committed build";

const STEP_MS = 30 * 60000;

// The lowest version a `>=x.y` range admits, compared part by part with this Node's.
const atLeast = (have, range) => ((want) => want.reduce((verdict, w, i) => verdict ?? (have[i] > w ? true : have[i] < w ? false : null), null) ?? true)((/>=\s*([\d.]+)/.exec(range ?? "")?.[1] ?? "0").split(".").map(Number));

const engineOf = (root) => JSON.parse(readFileSync(join(root, "control-panel", "package.json"), "utf8")).engines?.node ?? null;

const ran = (cmd, args, cwd, env) => ((r) => ({ ok: r.status === 0, said: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").slice(-3).join(" | ").slice(0, 400) }))(spawnSync(cmd, args, { cwd, env, encoding: "utf8", timeout: STEP_MS, maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32" && cmd === "npm" }));

const serverTests = (root) => readdirSync(join(root, "control-server", "test")).filter((n) => n.endsWith(".test.mjs")).map((n) => join("control-server", "test", n));

// In order; the first step that fails is the answer.
const STEPS = (root) => [
  { says: "the server's tests", cmd: process.execPath, args: ["--test", ...serverTests(root)], cwd: root },
  { says: "npm ci", cmd: "npm", args: ["ci", "--no-audit", "--no-fund"], cwd: join(root, "control-panel") },
  { says: "npm run typecheck", cmd: "npm", args: ["run", "typecheck"], cwd: join(root, "control-panel") },
  { says: "npm test", cmd: "npm", args: ["test"], cwd: join(root, "control-panel") },
  { says: "npm run build", cmd: "npm", args: ["run", "build"], cwd: join(root, "control-panel") },
];

const stale = (root, env) => ((r) => (r.ok && !r.said ? null : r.ok ? `control-server/public/ is stale (${r.said}): run npm run build in control-panel/ and commit it` : `git status failed: ${r.said}`))(ran("git", ["status", "--porcelain", "--", "control-server/public"], root, env));

const firstFailed = (root, env) => STEPS(root).reduce((failed, s) => failed ?? ((r) => (r.ok ? null : `${s.says} failed: ${r.said}`))(ran(s.cmd, s.args, s.cwd, env)), null);

const held = (root, env) => ((why) => (why ? { name: NAME, ok: false, detail: why } : { name: NAME, ok: true, detail: "the server's tests pass, the panel builds, and its committed build is what the source produces" }))(firstFailed(root, env) ?? stale(root, env));

export const controlPanel = (root, env, version = process.versions.node) => ((range) => (atLeast(version.split(".").map(Number), range) ? held(root, env) : { name: NAME, ok: false, detail: `not run here: Orbit Control declares Node ${range}, and this is ${version} -- node skills/orbit-release/panel.mjs on a machine with it` }))(engineOf(root));

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) ((row) => (console.log(`${row.ok ? "ok  " : "FAIL"}  ${row.name}\n        ${row.detail}`), (process.exitCode = row.ok ? 0 : 2)))(controlPanel(ROOT, process.env));
