#!/usr/bin/env node
// Orbit Web's deterministic checks, the same here, in a container and in the PR workflow: install (unless told the
// tree is installed), typecheck, lint, the tests of each kind, and the production builds. It needs no credential and
// no network beyond the package registry, and it prints how many tests of each kind ran and passed.
//
// The API's integration tests run against a REAL PostgreSQL with pgvector -- never a stand-in: the one
// ORBIT_WEB_TEST_DATABASE_URL names (the PR workflow's service container), or else the pinned image this script starts
// in Docker (scripts/test-db.mjs). Without either, it stops and says so.
//
//   node scripts/ci.mjs [--skip-install]
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startTestDb } from "./test-db.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));

const STEPS = [
  { name: "install", cmd: ["npm", "ci", "--no-audit", "--no-fund"], skip: args.has("--skip-install") },
  { name: "governance-core build", cmd: ["npm", "run", "build", "-w", "@orbit-web/governance-core"] },
  { name: "contracts build", cmd: ["npm", "run", "build", "-w", "@orbit-web/contracts"] },
  { name: "typecheck api", cmd: ["npm", "run", "typecheck", "-w", "@orbit-web/api"] },
  { name: "typecheck web", cmd: ["npm", "run", "typecheck", "-w", "@orbit-web/web"] },
  { name: "lint", cmd: ["npx", "eslint", "--max-warnings=0", "."] },
  { name: "governance-core unit tests", cmd: ["npm", "run", "test", "-w", "@orbit-web/governance-core"], kind: "node" },
  { name: "contracts unit tests", cmd: ["npm", "run", "test", "-w", "@orbit-web/contracts"], kind: "node" },
  { name: "api compile tests", cmd: ["npm", "run", "test:compile", "-w", "@orbit-web/api"] },
  { name: "api unit tests", cmd: ["npm", "run", "test:unit", "-w", "@orbit-web/api"], kind: "node" },
  { name: "api integration tests (PostgreSQL, mocked processes)", cmd: ["npm", "run", "test:integration", "-w", "@orbit-web/api"], kind: "node" },
  { name: "web tests", cmd: ["npm", "run", "test", "-w", "@orbit-web/web"], kind: "vitest" },
  { name: "api build", cmd: ["npm", "run", "build", "-w", "@orbit-web/api"] },
  { name: "web build", cmd: ["npm", "run", "build", "-w", "@orbit-web/web"] },
];

// eslint-disable-next-line no-control-regex -- the escape character is what a colour code starts with
const ANSI = /\x1b\[[0-9;]*m/g;

// "ℹ tests 12 … ℹ pass 12 … ℹ fail 0" (node --test) or "Tests  30 passed (30)" (vitest).
function counts(kind, out) {
  if (kind === "node") {
    const n = (label) => Number(new RegExp(`ℹ ${label} (\\d+)`).exec(out)?.[1] ?? NaN);
    return { tests: n("tests"), pass: n("pass"), fail: n("fail") };
  }
  const m = /Tests\s+(?:(\d+) failed \| )?(\d+) passed \((\d+)\)/.exec(out.replace(ANSI, ""));
  return m ? { tests: Number(m[3]), pass: Number(m[2]), fail: Number(m[1] ?? 0) } : { tests: NaN, pass: NaN, fail: NaN };
}

async function testDatabase() {
  if (process.env.ORBIT_WEB_TEST_DATABASE_URL) return { url: process.env.ORBIT_WEB_TEST_DATABASE_URL, how: "given" };
  try {
    return { url: await startTestDb(), how: "started in Docker" };
  } catch (err) {
    return { url: null, how: err instanceof Error ? err.message : String(err) };
  }
}

const database = await testDatabase();
const env = { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", CI: "1", ...(database.url ? { ORBIT_WEB_TEST_DATABASE_URL: database.url } : {}) };

const rows = [["test database (PostgreSQL + pgvector)", database.url ? "ok" : "FAILED", database.how]];
let failed = database.url === null;
if (failed) process.stdout.write(`\n--- the API's tests need PostgreSQL with pgvector: ${database.how}. Set ORBIT_WEB_TEST_DATABASE_URL, or make Docker available. ---\n`);
for (const step of failed ? [] : STEPS) {
  if (step.skip) {
    rows.push([step.name, "skipped", ""]);
    continue;
  }
  const started = Date.now();
  const r = spawnSync(step.cmd[0], step.cmd.slice(1), { cwd: ROOT, encoding: "utf8", env, maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const c = step.kind ? counts(step.kind, out) : null;
  const ok = r.status === 0 && (c === null || (c.fail === 0 && c.pass === c.tests && c.tests > 0));
  rows.push([step.name, ok ? "ok" : "FAILED", `${seconds}s${c ? ` · ${c.pass}/${c.tests} passed` : ""}`]);
  if (!ok) {
    failed = true;
    process.stdout.write(`\n--- ${step.name} failed (exit ${r.status}) ---\n${out.slice(-6000)}\n`);
    break;
  }
}

const width = Math.max(...rows.map((r) => r[0].length));
process.stdout.write(`\nOrbit Web checks\n${rows.map(([n, s, d]) => `  ${n.padEnd(width)}  ${s.padEnd(7)}  ${d}`).join("\n")}\n`);
process.exit(failed ? 1 : 0);
