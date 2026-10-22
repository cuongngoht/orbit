#!/usr/bin/env node
// Runs the TEST-HOOK conformance kit (skills/orbit-adapter-kit/hooks.mjs) against the example
// project's REAL hooks -- stack A, with its injected clock -- for the five hook adapters, through
// their REAL helper, with psql in the stack's own database as the witness.
//
//   node acceptance/kits/hooks.mjs [--json] [--record]
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fingerprintOf } from "../../src/adapters/dispatch.mjs";
import { codeDigestOf } from "../../src/adapters/receipts.mjs";
import { realIo } from "../../src/store/io.mjs";
import { SCENARIOS, scenarioResult } from "../../skills/orbit-adapter-kit/hooks.mjs";
import { assemble } from "../projects/assemble.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PACK = join(ROOT, "skills", "orbit-backend-test");
const PROJECT = "orbit-kit-hooks";

const freePort = () => new Promise((res, rej) => { const s = createServer(); s.once("error", rej); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });

function stackUp(dir, ports, token) {
  const env = { ...process.env, INVOICE_API_PORT: String(ports.api), INVOICE_SINK_PORT: String(ports.sink), INVOICE_HOOKS_PORT: String(ports.hooks), INVOICE_BROKER_PORT: String(ports.broker), ORBIT_SINK_TOKEN: randomBytes(24).toString("hex"), ORBIT_TEST_HOOKS: "on", ORBIT_TEST_HOOKS_TOKEN: token };
  const compose = (args) => spawnSync("docker", ["compose", "-p", PROJECT, ...args], { cwd: dir, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { compose, up: compose(["up", "-d", "--build", "--wait", "--wait-timeout", "240"]) };
}

function askerFor(adapter, token) {
  return (op, request, bound, deadlineMs = 30_000) => {
    const out = spawnSync(process.execPath, [join(PACK, adapter.helper.argv[0])], { input: JSON.stringify({ v: "orbit.helper/v1", op, request, bound, limits: {}, deadlineMs }), env: { PATH: process.env.PATH, ORBIT_KIT_HOOKS_TOKEN: token }, encoding: "utf8", timeout: deadlineMs + 5_000 });
    const lines = String(out.stdout ?? "").trim().split("\n").filter(Boolean);
    return lines.length === 1 ? JSON.parse(lines[0]) : { ok: false, class: "protocol", message: `no single answer line (status ${out.status})` };
  };
}

const adapters = () => JSON.parse(readFileSync(join(PACK, "adapters.json"), "utf8")).adapters.filter((a) => ["scheduler", "clock", "workload", "worker", "identity"].includes(a.family));
const codeOf = (adapter) => codeDigestOf(join(PACK, dirname(adapter.helper.argv[0])), realIo());

async function main() {
  const dir = assemble("invoice-a", join(mkdtempSync(join(tmpdir(), "orbit-kit-hooks-")), "checkout"), { variant: "correct" });
  const ports = { api: await freePort(), sink: await freePort(), hooks: await freePort(), broker: await freePort() };
  const token = randomBytes(24).toString("hex");
  const stack = stackUp(dir, ports, token);
  try {
    if (stack.up.status !== 0) return void process.stdout.write(`BLOCKED the stack did not come up: ${stack.up.stderr.slice(-400)}\n`, () => (process.exitCode = 3));
    const psql = (sql) => stack.compose(["exec", "-T", "db", "psql", "-U", "invoice", "-d", "invoice", "-X", "-At", "-c", sql]).stdout.trim();
    const witness = { executed: (ref) => psql(`SELECT count(*) FROM billing_jobs WHERE execution_ref = '${String(ref).replace(/'/g, "''")}'`) === "1", authenticates: (token, principal) => psql(`SELECT count(*) FROM tokens WHERE token_hash = '${createHash("sha256").update(String(token)).digest("hex")}' AND principal = '${String(principal).replace(/'/g, "''")}'`) === "1" };
    const credential = { tokenEnv: "ORBIT_KIT_HOOKS_TOKEN" };
    const origin = `http://127.0.0.1:${ports.hooks}`;
    const bound = { schedule: { origin, credential, schedule: "billing-daily" }, clock: { origin, credential }, workload: { origin, credential, workload: "worker" }, identity: { origin, credential, principal: "tenant-a-reader", tenant: "tenant-a" } };
    const receipts = adapters().map((adapter) => receiptOf(adapter, SCENARIOS.filter((s) => s.family === adapter.family).map((s) => scenarioResult({ adapter, ask: askerFor(adapter, token), system: { bound, witness, now: () => Date.now() } }, s))));
    reported(receipts);
  } finally {
    stack.compose(["down", "-v", "--remove-orphans"]);
    rmSync(resolve(dir, ".."), { recursive: true, force: true });
  }
}

const receiptOf = (adapter, results) => ({ kit: adapter.family, adapter: { id: adapter.id, version: adapter.version, fingerprint: fingerprintOf(adapter), code: codeOf(adapter), transport: adapter.transports[0] }, system: { image: "example invoice-a (acceptance/projects)", emulated: false }, at: new Date().toISOString(), results: results.map(({ saw, ...r }) => r), saw: results.map((r) => r.saw) });

function reported(receipts) {
  for (const r of receipts) process.stdout.write(`${r.adapter.id}\n${r.results.map((x) => `  ${x.outcome.padEnd(15)} ${x.id}${x.outcome === "failed" ? `  ${JSON.stringify(r.saw)}` : ""}`).join("\n")}\n`);
  const failed = receipts.some((r) => r.results.some((x) => x.outcome === "failed"));
  if (process.argv.includes("--record") && !failed) recorded(receipts.map(({ saw, ...r }) => r));
  process.exitCode = failed ? 1 : 0;
}

function recorded(fresh) {
  const file = join(ROOT, "docs", "backend-acceptance.json");
  const doc = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { schema: 1, receipts: [] };
  const others = doc.receipts.filter((r) => !fresh.some((f) => f.kit === r.kit && f.adapter.id === r.adapter.id && f.adapter.version === r.adapter.version));
  writeFileSync(file, `${JSON.stringify({ ...doc, receipts: [...others, ...fresh] }, null, 2)}\n`);
}

main().catch((e) => { process.stderr.write(`kit failed: ${e?.stack ?? e}\n`); process.exitCode = 3; });
