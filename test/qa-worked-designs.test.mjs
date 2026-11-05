// The orbit-qa playbook's WORKED DESIGNS (skills/orbit-qa/references/designs.md; 0.5.0 B7): one generic design per
// obligation shape the engine can design for, so that a host's first design compiles -- on Sonnet as on Opus. Each is
// held here to the engine's own validator for its shape: the QA generation port a host's design is made through
// (skills/orbit-qa/ports.mjs), with the shipped packs loaded, on a generic system graph, against the accepted slots the
// worked design says it assumes, the obligation's own slots derived from them as the engine derives them -- and each
// must come out a draft. None is an acceptance design: those are the benchmark's hidden ground truth.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { graphDigestOf } from "../src/architecture/graph-view.mjs";
import { loadExtensions } from "../src/extensions/index.mjs";
import { qcToolPaths } from "../src/extensions/store.mjs";
import { canonicalJson } from "../src/hash.mjs";
import { planDigestOf } from "../src/investigation/input.mjs";
import { modelOf } from "../src/investigation/model.mjs";
import { createInvestigations, eventIdOf } from "../src/investigation/store.mjs";
import { generatedCase } from "../src/qa/generation/design.mjs";
import { derivedObligations } from "../src/qa/obligations/derive.mjs";
import { OBLIGATION_SHAPES } from "../src/qa/obligations/shapes.mjs";
import { generationPort } from "../skills/orbit-qa/ports.mjs";
import { fakeContext } from "./fakes/context.mjs";
import { fakeIo } from "./fakes/io.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOC = readFileSync(join(ROOT, "skills", "orbit-qa", "references", "designs.md"), "utf8");

// Each worked design: its `### <shape>` heading and the first JSON block under it.
const WORKED = [...DOC.matchAll(/^### ([a-z-]+)\n[\s\S]*?```json\n([\s\S]*?)```/gm)].map(([, heading, json]) => ({ heading, ...JSON.parse(json) }));

// The generic system the worked designs name: one component with its test hooks, the interfaces, channels, schedule,
// workloads (with the fault points each declares) and tables they bind -- the aliases a host reads under `bindings`.
const node = (key, of, attributes = {}) => ({ key, name: key.split(":")[1], role: key.split(":")[0], ...(of ? { of } : {}), attributes });
const NODES = [
  node("component:shop", null, { hooksPort: "9090" }),
  node("interface:orders-api", "component:shop", { port: "8080", path: "/api" }),
  node("interface:orders-ui", "component:shop", { port: "8080" }),
  ...["order-events", "order-audit", "order-status", "order-confirmed", "order-events-dlq"].map((c) => node(`channel:${c}`, "component:broker", { exchange: "shop", routingKey: c.replaceAll("-", ".") })),
  node("schedule:nightly-settle", "component:shop"),
  node("workload:fulfilment", "component:shop", { faultPoints: "before-effect after-effect-before-ack lease-held reject-always" }),
  node("workload:outbox-relay", "component:shop", { faultPoints: "after-publish-before-mark" }),
  node("workload:settlement-scheduler", "component:shop", { faultPoints: "miss-tick" }),
  node("data-resource:orders-table", "server:db", { table: "shop.orders", key: "order_key" }),
  node("data-resource:payments-table", "server:db", { table: "shop.payments", key: "payment_key" }),
  node("data-resource:settlements-table", "server:db", { table: "shop.settlements", key: "period_key" }),
];
const BARE = { nodes: NODES, relations: [] };
const GRAPH = { ...BARE, digest: graphDigestOf(BARE) };
const server = (name, service, port) => ({ key: `server:${name}`, role: "server", name, alias: name, service, ports: [port], argv: [], compose: { env: [] }, env: { names: [], values: {} } });
const TOPOLOGY = { mode: "network", fingerprint: "f".repeat(64), nodes: [server("broker", "rabbitmq", 5672), server("db", "postgres", 5432), { key: "npm:.", role: "component", name: "shop", alias: "shop", ports: [8080, 9090], argv: [], compose: { env: [] }, env: { names: [], values: {} } }] };
const SERVICES = { rabbitmq: { id: "rabbitmq", transports: [{ id: "amqp-0-9-1", port: 5672 }] }, postgres: { id: "postgres", transports: [{ id: "postgres-wire", port: 5432 }] } };

async function packed() {
  const store = mkdtempSync(join(tmpdir(), "orbit-worked-"));
  mkdirSync(qcToolPaths(store).root, { recursive: true });
  const base = fakeContext();
  const ctx = { ...base, store: () => store, config: { ...base.config, packs: ["orbit-api-test", "orbit-backend-test"] } };
  await loadExtensions(ctx, { pluginRoot: ROOT });
  return { ctx, store };
}

// The plan a worked design assumes: its accepted slots grouped by criterion, the obligation's own criterion naming the shape.
function planOf(w) {
  const byCriterion = Object.entries(w.accepted).reduce((m, [ref, e]) => m.set(ref.split("/")[0], [...(m.get(ref.split("/")[0]) ?? []), { id: ref.split("/")[1], ...e }]), new Map());
  return { id: `worked-${w.shape}`, revision: "r1", criteria: [...byCriterion].map(([id, expects]) => ({ id, says: `what ${id} states`, obligations: id === w.criterion ? [w.shape] : [], expects })) };
}

// The design made through the port, for the obligation the engine derives from that plan, as a host's would be.
function generatedOf(ctx, w) {
  const plan = planOf(w);
  const obligation = derivedObligations({ plan, binding: { id: "bnd-w", authority: "accepted" }, graph: GRAPH }).obligations.find((o) => o.shape === w.shape);
  const store = createInvestigations("/store/repo-1", fakeIo());
  store.create({ id: "inv-20261105-090000-abcd", objective: w.shape });
  store.appendOnce("inv-20261105-090000-abcd", "binding", { id: "bnd-1", eventId: eventIdOf("binding", "bnd-w", 0, "d"), binding: "bnd-w", type: "plan", ref: plan.id, revision: "r1", digest: planDigestOf(plan), authority: "accepted", state: "fresh" });
  const port = generationPort({ ctx, model: () => modelOf(store.read("inv-20261105-090000-abcd")), planOf: () => plan, graph: () => GRAPH, topology: () => TOPOLOGY, services: SERVICES, drafts: { save: () => {} } });
  const design = { ...w.design, obligation: obligation.obligation };
  return { obligation, out: generatedCase(design, port.contextFor(obligation, { design })) };
}

test("the playbook has one worked design for every shape the engine designs for, and none for a shape only a contract represents", () => {
  assert.deepEqual(WORKED.map((w) => w.heading).sort(), OBLIGATION_SHAPES.filter((s) => !s.contractOnly).map((s) => s.id).sort());
  for (const w of WORKED) assert.deepEqual([w.shape, typeof w.criterion, typeof w.accepted, typeof w.design], [w.heading, "string", "object", "object"], w.heading);
  for (const s of OBLIGATION_SHAPES.filter((x) => x.contractOnly)) assert.match(DOC, new RegExp(`\`${s.id}\``), `${s.id} is named as a gap, never designed`);
});

test("every worked design is made a draft by the engine's own validator for its shape, ruling on each of its obligation's own slots", async () => {
  const { ctx, store } = await packed();
  for (const w of WORKED) {
    const { obligation, out } = generatedOf(ctx, w);
    assert.ok(obligation?.expected.length, `${w.shape}: its criterion states a slot the shape rules with`);
    assert.equal(out.ok, true, `${w.shape}: ${out.stage} ${out.outcome} — ${(out.findings ?? []).join(" | ")}`);
  }
  rmSync(store, { recursive: true, force: true });
});

// A reference design pasted in with its aliases renamed would still have its steps: each step's verb, capability, input
// keys, request keys and own keys -- so the playbook's are held apart from every reference design's, each clock's too.
const shapeOfSteps = (d) => canonicalJson((d?.skeleton?.steps ?? []).map((s) => [s.do, s.capability ?? null, Object.keys(s.input ?? {}).sort(), Object.keys(s.input?.request ?? {}).sort(), Object.keys(s).filter((k) => !["do", "capability", "input"].includes(k)).sort()]));
const REFERENCE = readdirSync(join(ROOT, "acceptance", "designs")).flatMap((f) => ((r) => [r.design, ...Object.values(r["by-clock"] ?? {}).map((over) => ({ ...r.design, ...over }))])(JSON.parse(readFileSync(join(ROOT, "acceptance", "designs", f), "utf8"))));

test("no worked design is a reference design: the benchmark's hidden designs are never what the playbook shows", () => {
  for (const w of WORKED) assert.equal(REFERENCE.some((r) => shapeOfSteps(r) === shapeOfSteps(w.design)), false, `${w.shape} has the steps of a reference design`);
});

// Nor with an optional bound added: a `maxItems` on an observation or a `limit` on a read changes no step's job, so the
// steps above were the reference design all the same (0.5.0 review: the crash-after-effect-before-ack design was its own
// reference's, names changed and two such bounds added, and competing-workers was effect-once-per-key's). What a design
// DOES is held apart as well, whatever its names, ids and bounds: each step's verb and capability in order, what rules
// it (each assertion's template and step), its controls (each role and the step that witnesses one) and its trigger.
const doneBy = (d) => canonicalJson({ steps: (d?.skeleton?.steps ?? []).map((s) => [s.do, s.capability ?? null]), rulings: (d?.assertions ?? []).map((a) => [a.template, a.step]), controls: (d?.controls ?? []).map((c) => [c.role, c.step ?? null]), trigger: [d?.trigger?.kind ?? null, d?.trigger?.step ?? null] });

test("no worked design does what a reference design does -- the same steps, ruled and controlled the same way -- whatever its names or optional bounds", () => {
  const copies = WORKED.filter((w) => REFERENCE.some((r) => doneBy(r) === doneBy(w.design))).map((w) => w.shape);
  assert.deepEqual(copies, [], "a worked design that does what a reference design does is that reference design, renamed");
});
