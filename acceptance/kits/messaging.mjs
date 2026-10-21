#!/usr/bin/env node
// The MESSAGING smoke kit (doc §5.10, §14 #24/#29) that closes PBI 08 on a real broker, until the
// conformance kit holds its scenarios as data in skills/orbit-adapter-kit (PBI 20) and a project's
// own adapter is held to the same rows. One adapter, one real broker, the
// scenarios its declared semantics make applicable -- each asked through the adapter's REAL helper
// program over orbit.helper/v1, exactly as the engine asks it, and each checked against the
// broker's own witness where the claim is about what the broker holds.
//
//   node acceptance/kits/messaging.mjs <adapter-id> [--json]
//
// A scenario whose semantics are unknown or unmet is NOT APPLICABLE, never a pass; a broker that
// will not start is BLOCKED (exit 3), never a skip. The receipt names the adapter's id, version and
// fingerprint and the broker's image digest: support is computed from receipts like it, for that
// version and that fingerprint only (src/adapters/matrix.mjs).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fingerprintOf } from "../../src/adapters/dispatch.mjs";
import { meets } from "../../src/adapters/semantics.mjs";
import { readyWithin, removed, started, witnessed } from "./brokers.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PACK = join(ROOT, "skills", "orbit-backend-test");
const NS = "orbit-kit";

function asked(kit, op, request, bound, deadlineMs = 15_000) {
  const env = { PATH: process.env.PATH, ORBIT_KIT_USER: kit.user, ORBIT_KIT_PASSWORD: kit.broker.secret };
  const out = spawnSync(process.execPath, [join(PACK, kit.adapter.helper.argv[0])], { input: JSON.stringify({ v: "orbit.helper/v1", op, request, bound, limits: {}, deadlineMs }), env, encoding: "utf8", timeout: deadlineMs + 5_000 });
  const line = String(out.stdout ?? "").trim().split("\n").filter(Boolean);
  return line.length === 1 ? JSON.parse(line[0]) : { ok: false, class: "protocol", message: `no single answer line (status ${out.status}): ${String(out.stderr).slice(0, 200)}` };
}

const resource = (kit, over) => ({ transport: kit.adapter.transports[0], endpoint: kit.broker.endpoint, credential: { userEnv: "ORBIT_KIT_USER", passwordEnv: "ORBIT_KIT_PASSWORD" }, ...over });

// Every scenario: what it needs of the adapter's semantics, and the steps that prove it.
const SCENARIOS = [
  { id: "publish-confirmed", needs: { publishAck: ["broker-confirm", "durable-write"] }, run: publishConfirmed },
  { id: "unroutable-returned", needs: { unroutable: "returned" }, run: unroutableReturned },
  { id: "observe-complete-window", needs: { observation: ["shadow-subscription", "independent-cursor", "peek-cursor"] }, run: completeWindow },
  { id: "observer-non-stealing", needs: { observation: ["shadow-subscription", "independent-cursor", "peek-cursor"] }, run: nonStealing },
  { id: "fixture-own-namespace", needs: {}, run: fixtureLifecycle },
];

const channel = (kit, key = "invoice.created") => resource(kit, { alias: "events", exchange: "amq.topic", routingKey: key });
const observer = (kit, id) => resource(kit, { alias: id, adapter: kit.adapter.id, queue: `${NS}.${id}`, bindingKey: "invoice.created" });

// A publication something is bound to receive: the kit's own queue routes it, so the broker's
// confirm is the only thing being judged.
function publishConfirmed(kit) {
  const routed = resource(kit, { alias: "fx-route", namespace: `${NS}.route`, queues: [{ name: `${NS}.route.q` }], bindings: [{ queue: `${NS}.route.q`, exchange: "amq.topic", routingKey: "invoice.routed" }] });
  asked(kit, "fixture.prepare", {}, { fixtureRef: routed });
  const out = asked(kit, "publish", { messageId: "kit-m-1", payload: { invoice: "kit" } }, { channelRef: channel(kit, "invoice.routed") });
  asked(kit, "fixture.cleanup", {}, { fixtureRef: routed });
  return { ok: out.ok && out.value.outcome === "confirmed", saw: out.ok ? out.value : out };
}

function unroutableReturned(kit) {
  const out = asked(kit, "publish", { messageId: "kit-m-2", payload: {} }, { channelRef: channel(kit, "nobody.listens") });
  return { ok: out.ok && out.value.outcome === "returned", saw: out.ok ? out.value : out };
}

function completeWindow(kit) {
  const obs = observer(kit, "obs-window");
  const armed = asked(kit, "observe", {}, { channelRef: channel(kit), observerRef: obs });
  const pub = asked(kit, "publish", { messageId: "kit-m-3", correlationId: "kit-c-3", payload: { n: 3 } }, { channelRef: channel(kit) });
  const seen = asked(kit, "observe.await", { waitMs: 1500 }, { observerRef: obs });
  const again = asked(kit, "observe.await", { waitMs: 500 }, { observerRef: obs });
  return { ok: armed.ok && pub.ok && seen.ok && seen.value.completeness === "complete" && seen.value.messages.map((m) => m.id).join() === "kit-m-3" && again.ok && again.value.messages.length === 0 && again.value.completeness === "complete", saw: { armed: armed.value ?? armed, seen: seen.value ?? seen, again: again.value ?? again } };
}

// The application's own queue keeps its message while the observer reads its copy: the broker's
// witness, not the adapter, says so.
function nonStealing(kit) {
  const appQueue = `${NS}.app-work`;
  asked(kit, "fixture.prepare", {}, { fixtureRef: resource(kit, { alias: "fx", namespace: NS, queues: [{ name: appQueue }], bindings: [{ queue: appQueue, exchange: "amq.topic", routingKey: "invoice.created" }] }) });
  const obs = observer(kit, "obs-steal");
  asked(kit, "observe", {}, { channelRef: channel(kit), observerRef: obs });
  asked(kit, "publish", { messageId: "kit-m-4", payload: {} }, { channelRef: channel(kit) });
  const seen = asked(kit, "observe.await", { count: 1, waitMs: 1500 }, { observerRef: obs });
  const held = witnessed(kit.broker).find((q) => q.name === appQueue);
  return { ok: seen.ok && seen.value.messages.some((m) => m.id === "kit-m-4") && held?.messages >= 1, saw: { observed: seen.value?.messages?.map((m) => m.id), appQueueByWitness: held } };
}

function fixtureLifecycle(kit) {
  const fx = resource(kit, { alias: "fx2", namespace: `${NS}.fx2`, queues: [{ name: `${NS}.fx2.work` }] });
  const prepared = asked(kit, "fixture.prepare", {}, { fixtureRef: fx });
  const before = witnessed(kit.broker).some((q) => q.name === `${NS}.fx2.work`);
  const outside = asked(kit, "fixture.cleanup", {}, { fixtureRef: { ...fx, queues: [{ name: "someone.elses" }] } });
  const cleaned = asked(kit, "fixture.cleanup", {}, { fixtureRef: fx });
  const after = witnessed(kit.broker).some((q) => q.name === `${NS}.fx2.work`);
  return { ok: prepared.ok && before && !outside.ok && outside.class === "refused" && cleaned.ok && !after, saw: { prepared: prepared.value ?? prepared, before, outside: outside.class, cleaned: cleaned.value ?? cleaned, after } };
}

function adapterOf(id) {
  const doc = JSON.parse(readFileSync(join(PACK, "adapters.json"), "utf8"));
  const adapter = doc.adapters.find((a) => a.id === id);
  if (!adapter) throw new Error(`no adapter ${id} in skills/orbit-backend-test/adapters.json`);
  return adapter;
}

const verdictOf = (kit, s) => {
  const fit = meets(kit.adapter.semantics, s.needs);
  if (fit.unknown.length || fit.unmet.length) return { id: s.id, outcome: "not-applicable", why: { unknown: fit.unknown, unmet: fit.unmet.map((u) => u.field) } };
  const r = s.run(kit);
  return { id: s.id, outcome: r.ok ? "passed" : "failed", saw: r.saw };
};

async function main() {
  const adapter = adapterOf(process.argv[2] ?? "amqp.reference");
  const broker = started(adapter.transports[0]);
  try {
    if (!(await readyWithin(broker, 90_000))) return void report({ adapter, broker, blocked: "the broker did not become ready within 90 s" }, 3);
    const kit = { adapter, broker, user: broker.row.env(broker.secret).RABBITMQ_DEFAULT_USER };
    const results = SCENARIOS.map((s) => verdictOf(kit, s));
    report({ adapter, broker, results }, results.some((r) => r.outcome === "failed") ? 1 : 0);
  } finally {
    removed(broker);
  }
}

function report({ adapter, broker, results, blocked }, code) {
  const receipt = { kit: "messaging", adapter: { id: adapter.id, version: adapter.version, fingerprint: fingerprintOf(adapter), transport: adapter.transports[0] }, system: { image: broker.image }, at: new Date().toISOString(), ...(blocked ? { blocked } : { results }) };
  const human = !process.argv.includes("--json");
  process.stdout.write(human ? `${(results ?? []).map((r) => `${r.outcome.padEnd(15)} ${r.id}${r.outcome === "failed" ? `  ${JSON.stringify(r.saw)}` : ""}`).join("\n")}${blocked ? `BLOCKED ${blocked}` : ""}\n${JSON.stringify(receipt.adapter)} on ${receipt.system.image}\n` : `${JSON.stringify(receipt, null, 2)}\n`);
  process.exitCode = code;
}

main().catch((e) => { process.stderr.write(`kit failed: ${e?.stack ?? e}\n`); process.exitCode = 3; });
