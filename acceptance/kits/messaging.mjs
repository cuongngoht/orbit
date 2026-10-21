#!/usr/bin/env node
// Runs the MESSAGING conformance kit (skills/orbit-adapter-kit/messaging.mjs) against a REAL broker
// in Docker, for one of this plugin's reference adapters, through its REAL helper program over
// orbit.helper/v1 -- exactly as the engine asks it -- with the broker's own tooling as the witness.
//
//   node acceptance/kits/messaging.mjs <adapter-id> [--json] [--record]
//
// A scenario whose semantics are unknown or unmet is NOT APPLICABLE, never a pass; a broker that
// will not start is BLOCKED (exit 3), never a skip. The receipt names the adapter's id, version,
// fingerprint and code digest and the broker's image digest; `--record` keeps it in
// docs/backend-acceptance.json, which the support matrix is computed from (src/adapters/matrix.mjs).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fingerprintOf } from "../../src/adapters/dispatch.mjs";
import { codeDigestOf } from "../../src/adapters/receipts.mjs";
import { realIo } from "../../src/store/io.mjs";
import { SCENARIOS, scenarioResult } from "../../skills/orbit-adapter-kit/messaging.mjs";
import { readyWithin, removed, started, witnessOf } from "./brokers.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PACK = join(ROOT, "skills", "orbit-backend-test");

function askerFor(adapter, broker) {
  const env = { PATH: process.env.PATH, ORBIT_KIT_USER: broker.row.user, ORBIT_KIT_PASSWORD: broker.secret };
  return (op, request, bound, deadlineMs = 15_000) => {
    const out = spawnSync(process.execPath, [join(PACK, adapter.helper.argv[0])], { input: JSON.stringify({ v: "orbit.helper/v1", op, request, bound, limits: {}, deadlineMs }), env, encoding: "utf8", timeout: deadlineMs + 5_000 });
    const lines = String(out.stdout ?? "").trim().split("\n").filter(Boolean);
    return lines.length === 1 ? JSON.parse(lines[0]) : { ok: false, class: "protocol", message: `no single answer line (status ${out.status}): ${String(out.stderr).slice(0, 200)}` };
  };
}

function adapterOf(id) {
  const adapter = JSON.parse(readFileSync(join(PACK, "adapters.json"), "utf8")).adapters.find((a) => a.id === id);
  if (!adapter) throw new Error(`no adapter ${id} in skills/orbit-backend-test/adapters.json`);
  return adapter;
}

const codeOf = (adapter) => codeDigestOf(join(PACK, dirname(adapter.helper.argv[0])), realIo());

async function main() {
  const adapter = adapterOf(process.argv[2] ?? "amqp.reference");
  const broker = started(adapter.transports[0]);
  try {
    if (!(await readyWithin(broker, 90_000))) return void report({ adapter, broker, blocked: "the broker did not become ready within 90 s" }, 3);
    const kit = { adapter, params: adapter.conformance?.params ?? {}, ns: "orbitkit", ask: askerFor(adapter, broker), system: { endpoint: broker.endpoint, credential: { userEnv: "ORBIT_KIT_USER", passwordEnv: "ORBIT_KIT_PASSWORD" }, witness: witnessOf(broker) } };
    const results = SCENARIOS.map((s) => scenarioResult(kit, s));
    report({ adapter, broker, results }, results.some((r) => r.outcome === "failed") ? 1 : 0);
  } finally {
    removed(broker);
  }
}

// --record: the receipt joins docs/backend-acceptance.json, replacing any earlier one for the same
// kit, adapter and version (an older fingerprint counts for nothing anyway) -- written only from a
// real run that passed, which this is.
function recorded(receipt) {
  const file = join(ROOT, "docs", "backend-acceptance.json");
  const doc = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { schema: 1, receipts: [] };
  const others = doc.receipts.filter((r) => !(r.kit === receipt.kit && r.adapter.id === receipt.adapter.id && r.adapter.version === receipt.adapter.version));
  writeFileSync(file, `${JSON.stringify({ ...doc, receipts: [...others, receipt] }, null, 2)}\n`);
}

function report({ adapter, broker, results, blocked }, code) {
  const receipt = { kit: "messaging", adapter: { id: adapter.id, version: adapter.version, fingerprint: fingerprintOf(adapter), code: codeOf(adapter), transport: adapter.transports[0] }, system: { image: broker.image, emulated: false }, at: new Date().toISOString(), ...(blocked ? { blocked } : { results: results.map(({ saw, ...r }) => r) }) };
  if (process.argv.includes("--record") && !blocked && code === 0) recorded(receipt);
  const human = !process.argv.includes("--json");
  process.stdout.write(human ? `${(results ?? []).map((r) => `${r.outcome.padEnd(15)} ${r.id}${r.outcome === "failed" ? `  ${JSON.stringify(r.saw)}` : ""}`).join("\n")}${blocked ? `BLOCKED ${blocked}` : ""}\n${JSON.stringify(receipt.adapter)} on ${receipt.system.image}\n` : `${JSON.stringify(receipt, null, 2)}\n`);
  process.exitCode = code;
}

main().catch((e) => { process.stderr.write(`kit failed: ${e?.stack ?? e}\n`); process.exitCode = 3; });
