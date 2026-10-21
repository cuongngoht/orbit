// A project brings its OWN adapter (ADR 0035, 0036): an extension in its QC-tools room declares
// an adapter for a transport nothing Orbit ships serves, its helper is a program of that
// directory -- a Node script, an executable, or a tool its manifest declared, in any language --
// and the family capability a case calls reaches it through the same selection, helper protocol
// and projection the reference adapters use. Where a helper lives is the loader's to say; a
// program the manifest never declared is not started.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { invokeCapability } from "../src/capability/invoke.mjs";
import { Blocked } from "../src/errors.mjs";
import { loadExtensions } from "../src/extensions/index.mjs";
import { verifyTool } from "../src/extensions/lifecycle.mjs";
import { qcToolPaths } from "../src/extensions/store.mjs";
import { localLauncher } from "../src/run/worker.mjs";
import { realIo } from "../src/store/io.mjs";
import { fakeContext } from "./fakes/context.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const ADAPTER = {
  id: "acme.mq",
  apiVersion: "orbit.adapter/v1",
  version: "1.0.0",
  doc: "the project's own broker, through its own helper",
  family: "messaging",
  transports: ["acme-mq"],
  operations: { publish: { effects: ["publish"], outputs: { messageId: "message.id", outcome: "settlement.outcome" } } },
  semantics: { delivery: "at-least-once", publishAck: "broker-confirm" },
  helper: { argv: ["helper.mjs"], runIn: "host" },
};

// A helper of the project's own, in the protocol and nothing else: it says what it was asked.
const HELPER = `let t = ""; process.stdin.on("data", (c) => (t += c)).on("end", () => { const r = JSON.parse(t); process.stdout.write(JSON.stringify({ v: "orbit.helper/v1", ok: true, value: { messageId: r.request.messageId, outcome: "confirmed", sawExchange: r.bound.channelRef.exchange, sawSecret: process.env.ACME_TOKEN ? "yes" : "no" } }) + "\\n"); });`;

function store(adapter = ADAPTER, manifestOver = {}) {
  const root = mkdtempSync(join(tmpdir(), "orbit-own-adapter-"));
  const dir = join(qcToolPaths(root).root, "acme-mq");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "extension.json"), JSON.stringify({ id: "acme-mq", version: "1.0.0", apiVersion: "orbit.extension/v2", status: "verified", adapters: "./adapters.json", ...manifestOver }));
  writeFileSync(join(dir, "adapters.json"), JSON.stringify({ adapters: [adapter] }));
  writeFileSync(join(dir, "helper.mjs"), HELPER);
  return { root, dir };
}

async function loaded(s) {
  const base = fakeContext();
  const ctx = { ...base, store: () => s.root, config: { ...base.config, packs: ["orbit-backend-test"] }, helpers: localLauncher(ROOT, realIo(), { node: process.execPath, env: { PATH: process.env.PATH ?? "" } }) };
  const out = await loadExtensions(ctx, { pluginRoot: ROOT });
  assert.deepEqual(out.refused, []);
  return ctx;
}

const binder = { resolve: (kind, ref) => ({ ok: true, value: kind === "channel" ? { alias: ref, transport: "acme-mq", exchange: "acme.events" } : { alias: ref }, env: kind === "identity" ? { ACME_TOKEN: "s3cr3t-acme" } : {} }) };
const run = { c: { id: "own-adapter" }, log: { record: () => {} }, budget: { endsAt: Date.now() + 60_000 } };
const publish = { do: "call", capability: "orbit.messaging.publish", input: { channelRef: "invoice-events", identityRef: "publisher", request: { messageId: "m-own" } } };

test("a project's own adapter answers a family operation for its own transport, through its own helper -- held to what it declared", async () => {
  const s = store();
  const ctx = { ...(await loaded(s)), binder, grants: { check: () => null, spend: () => null } };
  const out = invokeCapability(ctx, run, publish);
  assert.deepEqual([out.messageId, out.outcome], ["m-own", "confirmed"]);
  assert.equal(out.sawExchange, undefined, "a field it never declared is dropped");
  assert.deepEqual([out.adapter.id, out.adapter.transport], ["acme.mq", "acme-mq"]);
  assert.equal(ctx.adapters.get("acme.mq").from, "acme-mq");
  rmSync(s.root, { recursive: true, force: true });
});

test("the launcher starts a helper where it lives, by what its first argument is", async () => {
  const s = store();
  const ctx = await loaded(s);
  const node = ctx.helpers.launch({ id: "acme.mq", from: "acme-mq", helper: { argv: ["helper.mjs", "--fast"] } });
  assert.deepEqual([node.file, node.args, node.cwd], [process.execPath, [join(s.dir, "helper.mjs"), "--fast"], s.dir]);
  const program = ctx.helpers.launch({ id: "acme.mq", from: "acme-mq", helper: { argv: ["bin/helper"] } });
  assert.deepEqual([program.file, program.args], [join(s.dir, "bin", "helper"), []]);
  const undeclared = ctx.helpers.launch({ id: "acme.mq", from: "acme-mq", helper: { argv: ["python3", "helper.py"] } });
  assert.equal(undeclared.file, undefined);
  assert.match(undeclared.why, /"python3", which its manifest does not declare in tools/);
  assert.match(ctx.helpers.launch({ id: "x.y", from: "nobody", helper: { argv: ["helper.mjs"] } }).why, /nothing here knows where its helper lives/);
  rmSync(s.root, { recursive: true, force: true });
});

test("a tool the manifest DECLARED is started by name, in the extension's directory -- any language, its own SDK", async () => {
  const s = store({ ...ADAPTER, helper: { argv: ["python3", "helper.py"], runIn: "host" } }, { tools: ["python3"] });
  const ctx = await loaded(s);
  const launch = ctx.helpers.launch({ ...ctx.adapters.get("acme.mq") });
  assert.deepEqual([launch.file, launch.args, launch.cwd], ["python3", ["helper.py"], s.dir]);
  rmSync(s.root, { recursive: true, force: true });
});

test("a helper nothing can launch is BLOCKED with the launcher's own reason, and nothing about the product is claimed", async () => {
  const s = store({ ...ADAPTER, helper: { argv: ["acme-cli", "publish"], runIn: "host" } });
  const ctx = { ...(await loaded(s)), binder, grants: { check: () => null, spend: () => null } };
  assert.throws(() => invokeCapability(ctx, run, publish), (e) => e instanceof Blocked && /"acme-cli", which its manifest does not declare in tools/.test(e.message) && /nothing about the product was observed/.test(e.message));
  rmSync(s.root, { recursive: true, force: true });
});

// What a project's room can never do: stand in for a pack, replace a home already recorded, or --
// as a candidate being verified -- leave a home behind in the context it was judged beside.
test("a room directory that is not its manifest's id is refused, so nothing in a project's room can register as a pack", async () => {
  const s = store();
  const posing = join(qcToolPaths(s.root).root, "pack:orbit-backend-test");
  mkdirSync(posing, { recursive: true });
  writeFileSync(join(posing, "extension.json"), JSON.stringify({ id: "acme-mq", version: "1.0.0", apiVersion: "orbit.extension/v2", status: "verified", adapters: "./adapters.json" }));
  writeFileSync(join(posing, "adapters.json"), JSON.stringify({ adapters: [{ ...ADAPTER, id: "acme.posing" }] }));
  const base = fakeContext();
  const ctx = { ...base, store: () => s.root, helpers: localLauncher(ROOT, realIo(), { node: process.execPath, env: {} }) };
  const out = await loadExtensions(ctx, { pluginRoot: ROOT });
  assert.match(out.refused.find((r) => r.id === "pack:orbit-backend-test").why, /an extension's directory IS its id/);
  assert.equal(ctx.adapters.get("acme.posing"), null);
  rmSync(s.root, { recursive: true, force: true });
});

test("a pack's helper is found only where the plugin's catalog says, and a home is recorded once", () => {
  const launcher = localLauncher(ROOT, realIo(), { node: process.execPath, env: {} });
  launcher.home("pack:orbit-backend-test", { dir: "/tmp/somewhere-else", tools: [] });
  const pack = launcher.launch({ id: "amqp.reference", from: "pack:orbit-backend-test", helper: { argv: ["amqp/helper.mjs"] } });
  assert.equal(pack.args[0], join(ROOT, "skills", "orbit-backend-test", "amqp", "helper.mjs"));
  launcher.home("acme-mq", { dir: "/first", tools: [] });
  launcher.home("acme-mq", { dir: "/second", tools: [] });
  assert.equal(launcher.launch({ id: "acme.mq", from: "acme-mq", helper: { argv: ["helper.mjs"] } }).cwd, "/first");
});

test("verifying a candidate loads it in a throwaway that launches nothing, and leaves no home in the real launcher", async () => {
  const s = store();
  const ctx = await loaded(s);
  const candidate = mkdtempSync(join(tmpdir(), "orbit-candidate-"));
  writeFileSync(join(candidate, "extension.json"), JSON.stringify({ id: "acme-next", version: "1.0.0", apiVersion: "orbit.extension/v2", status: "draft", adapters: "./adapters.json" }));
  writeFileSync(join(candidate, "adapters.json"), JSON.stringify({ adapters: [{ ...ADAPTER, id: "acme.next" }] }));
  await verifyTool(ctx, candidate, realIo(), "acme-next");
  assert.match(ctx.helpers.launch({ id: "acme.next", from: "acme-next", helper: { argv: ["helper.mjs"] } }).why, /nothing here knows where its helper lives/);
  assert.equal(ctx.adapters.get("acme.next"), null, "nor an adapter in the real registry");
  for (const d of [s.root, candidate]) rmSync(d, { recursive: true, force: true });
});
