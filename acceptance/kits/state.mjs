#!/usr/bin/env node
// Runs the STATE conformance kit (skills/orbit-adapter-kit/state.mjs) against a REAL PostgreSQL -- the
// image the example project pins, started with a password, so the adapter authenticates by
// SCRAM-SHA-256 -- through the adapter's REAL helper, with psql inside the database's own container
// as the witness. The table it reads is mixed-case in a schema of its own, so a name that is not
// quoted cannot find it.
//
//   node acceptance/kits/state.mjs [--json] [--record]
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fingerprintOf } from "../../src/adapters/dispatch.mjs";
import { codeDigestOf } from "../../src/adapters/receipts.mjs";
import { realIo } from "../../src/store/io.mjs";
import { SCENARIOS, scenarioResult } from "../../skills/orbit-adapter-kit/state.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PACK = join(ROOT, "skills", "orbit-backend-test");
const IMAGE = /image:\s*(postgres:[^\s]+)/.exec(readFileSync(join(ROOT, "acceptance/projects/invoice-a/compose.yaml"), "utf8"))[1];
const KEY = "tenant-a|inv-a|billing-daily:2026-10-22T09:00:00+07:00";

const freePort = () => new Promise((res, rej) => { const s = createServer(); s.once("error", rej); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });
const docker = (args, input) => spawnSync("docker", args, { encoding: "utf8", input, maxBuffer: 16 * 1024 * 1024 });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// The entrypoint starts the server once to initialise it and again for real: a statement is retried until it holds.
async function settled(name, sql, tries = 120) {
  for (let i = 0; i < tries; i++) {
    const r = docker(["exec", name, "psql", "-h", "127.0.0.1", "-U", "kit", "-d", "kit", "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql]);
    if (r.status === 0) return r.stdout.trim().split("\n").at(-1);
    await pause(500);
  }
  return null;
}

function askerFor(adapter, password) {
  return (op, request, bound, deadlineMs = 15_000) => {
    const out = spawnSync(process.execPath, [join(PACK, adapter.helper.argv[0])], { input: JSON.stringify({ v: "orbit.helper/v1", op, request, bound, limits: {}, deadlineMs }), env: { PATH: process.env.PATH, ORBIT_KIT_DB_USER: "kit", ORBIT_KIT_DB_PASSWORD: password }, encoding: "utf8", timeout: deadlineMs + 5_000 });
    const lines = String(out.stdout ?? "").trim().split("\n").filter(Boolean);
    return lines.length === 1 ? JSON.parse(lines[0]) : { ok: false, class: "protocol", message: `no single answer line (status ${out.status})` };
  };
}

const adapters = () => JSON.parse(readFileSync(join(PACK, "adapters.json"), "utf8")).adapters.filter((a) => a.family === "state");
const codeOf = (adapter) => codeDigestOf(join(PACK, dirname(adapter.helper.argv[0])), realIo());

async function main() {
  const port = await freePort();
  const password = randomBytes(18).toString("hex");
  const name = `orbit-kit-state-${randomBytes(4).toString("hex")}`;
  const up = docker(["run", "-d", "--rm", "--name", name, "--label", "orbit.kit=state", "-e", "POSTGRES_USER=kit", "-e", `POSTGRES_PASSWORD=${password}`, "-e", "POSTGRES_DB=kit", "-p", `127.0.0.1:${port}:5432`, IMAGE]);
  try {
    if (up.status !== 0) return void process.stdout.write(`BLOCKED the database did not start: ${up.stderr.slice(-400)}\n`, () => (process.exitCode = 3));
    const seeded = await settled(name, `CREATE SCHEMA kit; CREATE TABLE kit."Reminders" (business_key text NOT NULL, status text NOT NULL); INSERT INTO kit."Reminders" VALUES ('${KEY}', 'recorded'), ('${KEY}', 'recorded'), ('${KEY}', 'recorded'), ('tenant-b|inv-b|other', 'recorded'); SELECT count(*) FROM kit."Reminders"`);
    if (seeded !== "4") return void process.stdout.write(`BLOCKED the kit's table could not be written: ${seeded}\n`, () => (process.exitCode = 3));
    const witness = { count: (key) => Number(docker(["exec", name, "psql", "-h", "127.0.0.1", "-U", "kit", "-d", "kit", "-X", "-At", "-c", `SELECT count(*) FROM kit."Reminders" WHERE business_key = '${String(key).replace(/'/g, "''")}'`]).stdout.trim()), total: () => Number(docker(["exec", name, "psql", "-h", "127.0.0.1", "-U", "kit", "-d", "kit", "-X", "-At", "-c", 'SELECT count(*) FROM kit."Reminders"']).stdout.trim()) };
    const bound = { key: KEY, state: { alias: "reminders", transport: "postgres-wire", endpoint: { host: "127.0.0.1", port }, credential: { userEnv: "ORBIT_KIT_DB_USER", passwordEnv: "ORBIT_KIT_DB_PASSWORD" }, table: "kit.Reminders", key: "business_key" } };
    const receipts = adapters().map((adapter) => receiptOf(adapter, SCENARIOS.map((s) => scenarioResult({ adapter, ask: askerFor(adapter, password), system: { bound, witness, nonce: randomBytes(6).toString("hex") } }, s))));
    reported(receipts);
  } finally {
    docker(["rm", "-f", name]);
  }
}

const receiptOf = (adapter, results) => ({ kit: adapter.family, adapter: { id: adapter.id, version: adapter.version, fingerprint: fingerprintOf(adapter), code: codeOf(adapter), transport: adapter.transports[0] }, system: { image: IMAGE, emulated: false }, at: new Date().toISOString(), results: results.map(({ saw, ...r }) => r), saw: results.map((r) => r.saw) });

function reported(receipts) {
  for (const r of receipts) process.stdout.write(`${r.adapter.id}\n${r.results.map((x, i) => `  ${x.outcome.padEnd(15)} ${x.id}${x.outcome === "failed" ? `  ${JSON.stringify(r.saw[i])}` : ""}`).join("\n")}\n`);
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
