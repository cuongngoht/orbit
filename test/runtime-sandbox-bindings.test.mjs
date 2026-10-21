// The sealed binding table (ADR 0036; doc §6.1; PBI 06): every logical ref a frozen version names is
// resolved by the host, before dispatch, to what the task's own sandbox holds -- a node's alias on
// the task's network, the transport and port its catalog row says, the credential it was STARTED
// with (named in the value, its value only in `secrets`), an observer and a fixture named inside the
// run's namespace by its adapter's own templates, the hooks a component exposes with the token the
// sandbox minted. What nothing declares is a gap with its reason, never a guess.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runtimeCatalog } from "../src/runtime/catalog.mjs";
import { sealedBindings } from "../src/runtime/sandbox/bindings.mjs";
import { sealedBinder } from "../src/run/worker.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVICES = Object.fromEntries(runtimeCatalog(JSON.parse(readFileSync(join(ROOT, "catalog/runtimes.json"), "utf8"))).services.map((s) => [s.id, s]));
const ADAPTERS = JSON.parse(readFileSync(join(ROOT, "skills/orbit-backend-test/adapters.json"), "utf8")).adapters;

const topology = (mode = "aliases") => ({ mode, nodes: [
  { key: "service:broker", role: "service", name: "broker", alias: "broker", service: "rabbitmq", ports: [5672], compose: { env: [["RABBITMQ_DEFAULT_USER", "invoice"], ["RABBITMQ_DEFAULT_PASS", "invoice-pass"]] } },
  { key: "service:nats", role: "service", name: "nats", alias: "nats", service: "nats", ports: [4222], argv: ["-js", "--user", "invoice", "--pass", "nats-pass"], compose: { env: [] } },
  { key: "component:invoice-app", role: "component", name: "invoice-app", alias: "invoice-app", ports: [8080, 8081, 9090] },
] });

const DECLARED = {
  "channel:reminders": { node: "broker", address: { exchange: "billing", routingKey: "billing.reminder.requested" } },
  "channel:stream-reminders": { node: "nats", transport: "nats-jetstream", address: { subject: "billing.reminder.requested", stream: "BILLING" } },
  "observer:obs-1": { channel: "reminders" },
  "observer:obs-js": { channel: "stream-reminders" },
  "endpoint:backend": { node: "invoice-app", port: 8080, path: "/api" },
  "schedule:billing-daily": { node: "invoice-app", port: 9090, address: { schedule: "billing-daily" } },
  "fixture:fx": { channel: "reminders" },
};

const input = (over = {}) => ({
  refs: [{ kind: "channel", alias: "reminders" }, { kind: "observer", alias: "obs-1" }, { kind: "endpoint", alias: "backend" }, { kind: "schedule", alias: "billing-daily" }, { kind: "fixture", alias: "fx" }],
  declarationOf: (kind, alias) => DECLARED[`${kind}:${alias}`] ?? null,
  topology: topology(),
  services: SERVICES,
  namespace: "orbit-ab12",
  adapterFor: (transport) => ADAPTERS.find((a) => a.family === "messaging" && a.transports.includes(transport)) ?? null,
  minted: { hooksToken: "s3cr3t-hooks" },
  ...over,
});

test("a channel is bound to the node's alias, the transport and port its catalog row says, and the credential it was started with -- named, its value apart", () => {
  const out = sealedBindings(input());
  assert.deepEqual(out.gaps, []);
  const ch = out.bindings.channel.reminders;
  assert.deepEqual([ch.transport, ch.endpoint, ch.exchange, ch.routingKey], ["amqp-0-9-1", { host: "broker", port: 5672 }, "billing", "billing.reminder.requested"]);
  assert.deepEqual(ch.credential, { userEnv: "ORBIT_BIND_REMINDERS_USER", passwordEnv: "ORBIT_BIND_REMINDERS_PASSWORD" });
  assert.equal(out.secrets.ORBIT_BIND_REMINDERS_PASSWORD, "invoice-pass");
  assert.equal(JSON.stringify(out.bindings).includes("invoice-pass"), false, "a value never sits in a binding");
});

test("an observer is its OWN: named inside the run's namespace by its adapter's template, and pinned to that adapter", () => {
  const out = sealedBindings(input());
  const obs = out.bindings.observer["obs-1"];
  assert.deepEqual([obs.queue, obs.namespace, obs.bindingKey, obs.exchange, obs.adapter], ["orbit-ab12.obs-1", "orbit-ab12", "billing.reminder.requested", "billing", "amqp.reference"]);
  const js = sealedBindings(input({ refs: [{ kind: "observer", alias: "obs-js" }] })).bindings.observer["obs-js"];
  assert.deepEqual([js.stream, js.consumer, js.adapter, js.endpoint.port], ["BILLING", "orbit-ab12-obs-js", "jetstream.reference", 4222]);
  assert.equal(sealedBindings(input({ refs: [{ kind: "observer", alias: "obs-js" }] })).secrets.ORBIT_BIND_STREAM_REMINDERS_PASSWORD, "nats-pass", "a credential a flag declared");
});

test("an endpoint and a component's hooks are reached on the task's network; the hooks with the token the sandbox minted", () => {
  const out = sealedBindings(input());
  assert.equal(out.bindings.endpoint.backend.origin, "http://invoice-app:8080/api");
  const s = out.bindings.schedule["billing-daily"];
  assert.deepEqual([s.transport, s.origin, s.schedule, s.credential.tokenEnv], ["orbit-scheduler-v1", "http://invoice-app:9090", "billing-daily", "ORBIT_BIND_HOOKS_TOKEN"]);
  assert.equal(out.secrets.ORBIT_BIND_HOOKS_TOKEN, "s3cr3t-hooks");
  assert.equal(sealedBindings(input({ topology: topology("pod") })).bindings.endpoint.backend.origin, "http://localhost:8080/api", "one shared namespace is localhost");
});

test("a fixture lives in the run's namespace; what nothing declares, or a node the sandbox does not run, is a gap with its reason", () => {
  const out = sealedBindings(input({ refs: [{ kind: "fixture", alias: "fx" }, { kind: "channel", alias: "nowhere" }, { kind: "endpoint", alias: "ghost" }, { kind: "teleport", alias: "x" }, { kind: "schedule", alias: "billing-daily" }], declarationOf: (kind, alias) => ({ ...DECLARED, "endpoint:ghost": { node: "not-running" } })[`${kind}:${alias}`] ?? null, minted: {} }));
  assert.equal(out.bindings.fixture.fx.namespace, "orbit-ab12");
  assert.deepEqual(out.gaps.map((g) => [g.kind, g.alias]), [["channel", "nowhere"], ["endpoint", "ghost"], ["teleport", "x"], ["schedule", "billing-daily"]]);
  assert.match(out.gaps.find((g) => g.alias === "ghost").why, /does not run/);
  assert.match(out.gaps.find((g) => g.kind === "schedule").why, /minted no hooks token/);
});

test("the worker hands a helper every secret its bound value names, and no other", () => {
  const out = sealedBindings(input());
  const binder = sealedBinder({ bindings: out.bindings, secrets: { ...out.secrets, UNRELATED: "x" } });
  const got = binder.resolve("channel", "reminders");
  assert.deepEqual(got.env, { ORBIT_BIND_REMINDERS_USER: "invoice", ORBIT_BIND_REMINDERS_PASSWORD: "invoice-pass" });
  assert.deepEqual(binder.resolve("schedule", "billing-daily").env, { ORBIT_BIND_HOOKS_TOKEN: "s3cr3t-hooks" });
});

// What a ref IS comes from the system graph and the design's own plan -- never from a case.
import { aliasOf, declarationsFrom } from "../src/runtime/sandbox/declarations.mjs";

const GRAPH = { nodes: [
  { key: "component:broker", role: "component", name: "broker", attributes: {} },
  { key: "component:invoice-app", role: "component", name: "invoice-app", attributes: { hooksPort: 9090 } },
  { key: "exchange:billing.reminder.requested", role: "channel", name: "billing.reminder.requested", of: "component:broker", transport: "amqp-0-9-1", attributes: { exchange: "billing", routingKey: "billing.reminder.requested" } },
  { key: "endpoint:invoices-api", role: "interface", name: "invoices-api", of: "component:invoice-app", attributes: { port: 8080, path: "/api" } },
  { key: "schedule:billing-daily", role: "schedule", name: "billing-daily", of: "component:invoice-app", attributes: {} },
  { key: "worker:reminder-worker", role: "workload", name: "worker", of: "component:invoice-app", attributes: {} },
] };

test("the graph's nodes declare what each ref is: placed on the component that holds them, hooks where it says", () => {
  const decl = declarationsFrom({ graph: GRAPH, design: { observationPlan: [{ observerRef: "obs-1", channelRef: "billing-reminder-requested" }], fixtureRefs: ["fx"] } });
  assert.equal(aliasOf("billing.reminder.requested"), "billing-reminder-requested");
  assert.deepEqual(decl("channel", "billing-reminder-requested"), { node: "broker", transport: "amqp-0-9-1", address: { exchange: "billing", routingKey: "billing.reminder.requested" } });
  assert.deepEqual(decl("endpoint", "invoices-api"), { node: "invoice-app", port: 8080, path: "/api" });
  assert.deepEqual(decl("schedule", "billing-daily"), { node: "invoice-app", port: 9090, address: { schedule: "billing-daily" } });
  assert.deepEqual(decl("workload", "worker"), { node: "invoice-app", port: 9090, address: { workload: "worker" } });
  assert.deepEqual(decl("clock", "invoice-app"), { node: "invoice-app", port: 9090 });
  assert.deepEqual(decl("observer", "obs-1"), { channel: "billing-reminder-requested" });
  assert.deepEqual(decl("fixture", "fx"), {});
  assert.equal(decl("channel", "nowhere"), null, "what the graph does not hold is null -- the binder says it is a gap");
  const sealed = sealedBindings(input({ refs: [{ kind: "channel", alias: "billing-reminder-requested" }, { kind: "observer", alias: "obs-1" }], declarationOf: decl }));
  assert.deepEqual(sealed.gaps, []);
  assert.equal(sealed.bindings.observer["obs-1"].bindingKey, "billing.reminder.requested");
});

test("an address read from a checkout can never say where to connect or as whom -- the host's own values win", () => {
  const hostile = { ...DECLARED, "channel:reminders": { node: "broker", address: { exchange: "billing", transport: "evil-mq", endpoint: "attacker:1", host: "attacker", credential: "x" } }, "schedule:billing-daily": { node: "invoice-app", port: 9090, address: { schedule: "billing-daily", origin: "http://attacker:80" } } };
  const out = sealedBindings(input({ declarationOf: (kind, alias) => hostile[`${kind}:${alias}`] ?? null }));
  const ch = out.bindings.channel.reminders;
  assert.deepEqual([ch.transport, ch.endpoint, ch.exchange, ch.host], ["amqp-0-9-1", { host: "broker", port: 5672 }, "billing", undefined]);
  assert.equal(out.bindings.schedule["billing-daily"].origin, "http://invoice-app:9090", "the hooks token never goes anywhere else");
  const graphDecl = declarationsFrom({ graph: { nodes: [{ key: "queue:q", role: "channel", name: "q", of: "component:broker", attributes: { queue: "q", origin: "http://attacker" } }] } })("channel", "q");
  assert.deepEqual(graphDecl.address, { queue: "q" });
});

test("a declared base path is only ever a plain path -- never a userinfo, a host or a scheme", () => {
  const hostile = { ...DECLARED, "endpoint:backend": { node: "invoice-app", port: 8080, path: "@attacker.example/x" } };
  const out = sealedBindings(input({ refs: [{ kind: "endpoint", alias: "backend" }], declarationOf: (kind, alias) => hostile[`${kind}:${alias}`] ?? null }));
  assert.equal(out.bindings.endpoint, undefined);
  assert.match(out.gaps[0].why, /not a plain path/);
  const graphDecl = declarationsFrom({ graph: { nodes: [{ key: "endpoint:e", role: "interface", name: "e", of: "component:app", attributes: { port: 8080, path: "//attacker.example" } }] } })("endpoint", "e");
  assert.equal(graphDecl.path, undefined);
});
