// The ports a generated test's lifecycle is handed (skills/orbit-qa/ports.mjs; PBI 11-13): what a
// design is compiled against comes from what the binder will bind -- the frozen graph, the sandbox's
// topology, the adapter selection picks -- and only ACCEPTED expectations bound at their digest may be
// ruled on; a version is prepared with every ref sealed by the host and a grant minted for every
// effect it would have, or a gap that says why not; and what a worker left is read back only inside
// its own output, a link never followed.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { graphDigestOf } from "../src/architecture/graph-view.mjs";
import { loadExtensions } from "../src/extensions/index.mjs";
import { qcToolPaths } from "../src/extensions/store.mjs";
import { generated } from "../src/investigation/generate.mjs";
import { planDigestOf } from "../src/investigation/input.mjs";
import { modelOf } from "../src/investigation/model.mjs";
import { createInvestigations, eventIdOf } from "../src/investigation/store.mjs";
import { WORKER_API } from "../src/run/worker.mjs";
import { dispatchPort, generationPort, keptEvidence } from "../skills/orbit-qa/ports.mjs";
import { fakeContext } from "./fakes/context.mjs";
import { fakeIo } from "./fakes/io.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ID = "inv-20261022-130000-abcd";

const PLAN = { id: "invoice-billing", revision: "r1", criteria: [
  { id: "API-AC-2", says: "another tenant reads not found", about: "invoice-read", obligations: ["permission-enforced"], expects: [{ id: "E1", property: "response.status", op: "eq", value: 404 }] },
  { id: "FIX-ASYNC-1", says: "one reminder request per occurrence", about: "reminders", obligations: ["publication-routed"], expects: [{ id: "E1", property: "message.id", op: "present" }] },
] };

const BARE = { nodes: [
  { key: "component:invoice-app", name: "invoice-app", role: "component", attributes: { hooksPort: "9090" } },
  { key: "interface:invoice-read", name: "invoice-read", role: "interface", of: "component:invoice-app", attributes: { port: "8080", path: "/api" } },
  { key: "channel:reminders", name: "reminders", role: "channel", of: "component:broker", attributes: { exchange: "billing", routingKey: "reminder.requested", host: "evil.example" } },
  { key: "schedule:billing-daily", name: "billing-daily", role: "schedule", of: "component:invoice-app" },
], relations: [] };
const GRAPH = { ...BARE, digest: graphDigestOf(BARE) };

const TOPOLOGY = { mode: "network", fingerprint: "f".repeat(64), nodes: [
  { key: "server:broker", role: "server", name: "broker", alias: "broker", service: "rabbitmq", ports: [5672], argv: [], compose: { env: [["RABBITMQ_DEFAULT_USER", "invoice"], ["RABBITMQ_DEFAULT_PASS", "invoice-pass"]] }, env: { names: [], values: {} } },
  { key: "npm:.", role: "component", name: "invoice-app", alias: "invoice-app", ports: [8080, 9090], argv: [], compose: { env: [] }, env: { names: [], values: {} } },
] };
const SERVICES = { rabbitmq: { id: "rabbitmq", transports: [{ id: "amqp-0-9-1", port: 5672 }], credentials: { user: { env: "RABBITMQ_DEFAULT_USER" }, password: { env: "RABBITMQ_DEFAULT_PASS" } } } };

const call = (capability, input) => ({ do: "call", capability, input });
const ASYNC = { obligation: "tob-000000000001", skeleton: { steps: [call("orbit.messaging.observe", { channelRef: "reminders", observerRef: "seen", fixtureRef: "fx", request: {} }), call("orbit.scheduler.trigger", { scheduleRef: "billing-daily", fixtureRef: "fx", request: {} }), call("orbit.observe.await", { observerRef: "seen", request: {} })] }, assertions: [{ criterionRef: "FIX-ASYNC-1/E1", template: "value-present", step: 3 }], controls: [{ role: "positive" }], fixtureRefs: ["fx"], trigger: { kind: "schedule", ref: "billing-daily", step: 2 }, observationPlan: [], effectScope: "fixture" };

async function packed() {
  const store = mkdtempSync(join(tmpdir(), "orbit-ports-"));
  mkdirSync(qcToolPaths(store).root, { recursive: true });
  const base = fakeContext();
  const ctx = { ...base, store: () => store, config: { ...base.config, packs: ["orbit-api-test", "orbit-backend-test"] } };
  await loadExtensions(ctx, { pluginRoot: ROOT });
  return { ctx, store };
}

function journal(planAuthority = "accepted", plan = PLAN) {
  const io = fakeIo();
  const store = createInvestigations("/store/repo-1", io);
  store.create({ id: ID, objective: "billing" });
  store.appendOnce(ID, "binding", { id: "bnd-1", eventId: eventIdOf("binding", "bnd-p", 0, "d"), binding: "bnd-p", type: "plan", ref: plan.id, revision: "r1", digest: planDigestOf(PLAN), authority: planAuthority, state: "fresh" });
  for (const [obligation, shape, expected] of [["tob-000000000001", "publication-routed", ["FIX-ASYNC-1/E1"]], ["tob-000000000002", "permission-enforced", ["API-AC-2/E1"]]]) store.appendOnce(ID, "obligation", { id: `obr-${obligation.slice(-1)}`, eventId: eventIdOf("obligation", obligation, 0, "d"), obligation, revision: "r1", digest: "d", shape, bindings: ["bnd-p"], expected, authority: planAuthority });
  return { store, io, model: () => modelOf(store.read(ID)) };
}

function ports(ctx, j, over = {}) {
  const drafts = [];
  const b = { ctx, model: j.model, planOf: () => over.plan ?? PLAN, graph: () => GRAPH, topology: () => over.topology ?? TOPOLOGY, services: SERVICES, drafts: { save: (c) => drafts.push(c) }, settings: { limits: { writes: 10, caseSeconds: 120 } }, mode: over.mode ?? "fixture-write", now: () => 1_700_000_000_000, sandbox: { id: "env-1", task: "tsk-1", tree: "tree-a", currentTree: over.currentTree ?? "tree-a", isolated: true }, policy: { revision: "rev-1", writes: over.writes ?? ["trigger", "create-resource", "consume"] }, place: { in: "/work/in", out: "/work/out" }, hooksToken: () => ("hooksToken" in over ? over.hooksToken : "hooks-token-0123456789"), runtime: over.runtime, project: { name: "invoice", packs: ["orbit-backend-test"], graphDir: over.graphDir ?? null }, keep: over.keep ?? (() => "kept") };
  return { generation: generationPort(b), dispatch: dispatchPort(b), drafts };
}

test("a design is compiled against what the binder will bind: the adapter the topology selects, and only accepted expectations at their digest", async () => {
  const { ctx, store } = await packed();
  const j = journal();
  const p = ports(ctx, j);
  const obligation = j.model().obligations.find((o) => o.obligation === "tob-000000000001");
  const cx = p.generation.contextFor(obligation, { design: ASYNC });
  assert.deepEqual([...cx.expectations.keys()], ["API-AC-2/E1", "FIX-ASYNC-1/E1"], "every accepted slot of the plans it is bound to may rule");
  assert.deepEqual(cx.expected, ["FIX-ASYNC-1/E1"], "and the design is held to its own");
  assert.deepEqual(cx.outputsOf(3), JSON.parse(readFileSync(join(ROOT, "skills/orbit-backend-test/adapters.json"), "utf8")).adapters.find((a) => a.id === "amqp.reference").operations["observe.await"].outputs, "the broker's service on the topology chose the adapter, and its declaration says what the await carries");
  assert.equal(cx.semanticsOf(1).delivery, "at-least-once");
  assert.match(cx.caseId, /^gen-00000000-[0-9a-f]{8}$/);
  assert.match(p.generation.versions.dslDigest, /^[0-9a-f]{64}$/);
  const draft = journal("draft");
  assert.equal(ports(ctx, draft).generation.contextFor(draft.model().obligations[0], { design: ASYNC }).expectations.size, 0, "a draft plan states nothing a verdict may rule on");
  assert.equal(ports(ctx, j, { plan: { ...PLAN, revision: "r2" } }).generation.contextFor(obligation, { design: ASYNC }).expectations.size, 0, "a plan that moved since it was bound states nothing here");
  rmSync(store, { recursive: true, force: true });
});

test("a generated HTTP case is drafted through the port, validated by the real grammar with the packs it calls", async () => {
  const { ctx, store } = await packed();
  const j = journal();
  const p = ports(ctx, j);
  const design = { obligation: "tob-000000000002", skeleton: { steps: [call("orbit.http.read", { endpointRef: "invoice-read", identityRef: "tenant-b-reader", method: "GET", path: "/invoices/inv-a" })] }, assertions: [{ criterionRef: "API-AC-2/E1", template: "value-eq", step: 1 }], controls: [{ role: "positive" }, { role: "negative" }] };
  const out = generated({ id: ID, store: j.store, io: j.io, generation: p.generation }, { obligation: "tob-000000000002", design });
  assert.equal(out.outcome, "DRAFT_CREATED", JSON.stringify(out));
  assert.equal(p.drafts.length, 1);
  assert.match(p.drafts[0].steps[0].expect, /^compiled:/);
  rmSync(store, { recursive: true, force: true });
});

test("a version is prepared with every ref sealed by the host and a grant for every effect it would have", async () => {
  const { ctx, store } = await packed();
  const j = journal();
  const p = ports(ctx, j);
  const frozen = { case: { id: "gen-x", steps: ASYNC.skeleton.steps } };
  const x = { frozen, design: { ...ASYNC, id: "tds-1" }, obligation: j.model().obligations[0], attempt: 1, execution: "exe-0123456789abcdef-1" };
  const out = p.dispatch.prepare(x);
  assert.deepEqual(out.gaps, []);
  assert.deepEqual(out.refused, []);
  assert.equal(out.bindings.channel.reminders.endpoint.host, "broker", "the topology's alias, never a host a checkout's attribute said");
  assert.equal(out.bindings.channel.reminders.exchange, "billing");
  assert.match(out.bindings.observer.seen.queue, /^o[0-9a-f]{10}\.seen$/, "the observer is named inside the run's own namespace");
  assert.equal(out.bindings.schedule["billing-daily"].origin, "http://invoice-app:9090");
  assert.deepEqual(Object.values(out.secrets).sort(), ["hooks-token-0123456789", "invoice", "invoice-pass"].sort());
  assert.deepEqual(out.grants.map((g) => [g.capability.id, g.operation.class]), [["orbit.messaging.observe", "create-resource"], ["orbit.scheduler.trigger", "trigger"], ["orbit.observe.await", "consume"]]);
  assert.ok(out.grants.every((g) => g.run === x.execution && g.sandbox.tree === "tree-a"));
  assert.deepEqual([out.place, out.deadlineMs, out.fixture.namespace], [{ case: "/work/in/gen-x.json", out: "/work/out" }, 120000, out.bindings.observer.seen.namespace]);
  rmSync(store, { recursive: true, force: true });
});

test("what a person's policy does not allow, a stale tree, an observer nothing arms and a sandbox that cannot be composed stop it before anything runs", async () => {
  const { ctx, store } = await packed();
  const j = journal();
  const frozen = { case: { id: "gen-x", steps: ASYNC.skeleton.steps } };
  const x = { frozen, design: { ...ASYNC, id: "tds-1" }, obligation: j.model().obligations[0], attempt: 1, execution: "exe-0123456789abcdef-1" };
  const narrow = ports(ctx, j, { writes: ["create-resource", "consume"] }).dispatch.prepare(x);
  assert.deepEqual(narrow.refused.map((r) => r.id), ["POLICY"]);
  assert.deepEqual(ports(ctx, j, { currentTree: "tree-b" }).dispatch.prepare(x).refused.map((r) => r.id), ["TREE", "TREE", "TREE"]);
  assert.ok(ports(ctx, j, { mode: "observe" }).dispatch.prepare(x).refused.every((r) => r.id === "MODE"));
  const planned = ports(ctx, j).dispatch.prepare({ ...x, design: { ...x.design, observationPlan: [{ observerRef: "other", channelRef: "reminders" }] } });
  assert.match(planned.gaps.map((g) => g.why).join(), /armed only by a step of the test/);
  assert.match(ports(ctx, j, { hooksToken: null }).dispatch.prepare(x).gaps.map((g) => g.why).join(), /minted no hooks token/);
  const none = ports(ctx, j, { topology: { needs: "person", say: "a person trusts the topology first" } }).dispatch.prepare(x);
  assert.deepEqual(none.gaps, [{ kind: "sandbox", alias: "env-1", why: "a person trusts the topology first" }]);
  rmSync(store, { recursive: true, force: true });
});

test("a run lays its inputs where the worker reads them, and reads back only what lies inside its own output", async () => {
  const { ctx, store } = await packed();
  const room = mkdtempSync(join(tmpdir(), "orbit-dispatch-"));
  const dirs = { in: join(room, "in"), out: join(room, "out") };
  const graphDir = join(room, "graph");
  mkdirSync(graphDir, { recursive: true });
  writeFileSync(join(graphDir, "edges.json"), "[]");
  const worker = (request) => {
    const ev = join(dirs.out, "store", "evidence", "run-1");
    if (existsSync(ev)) return { ok: true };
    mkdirSync(ev, { recursive: true });
    writeFileSync(join(ev, "run-log.jsonl"), `${JSON.stringify({ kind: "run", case_digest: "c" })}\n`);
    writeFileSync(join(ev, "shot.png"), "png");
    symlinkSync("/etc/hosts", join(ev, "planted"));
    writeFileSync(join(dirs.out, "envelope.json"), JSON.stringify({ v: WORKER_API, runId: request.runId, nonce: request.nonce, status: "PASS", evidence: "store/evidence/run-1" }));
    return { ok: true };
  };
  const p = ports(ctx, journal(), { runtime: { dirs: () => dirs, dispatch: worker }, graphDir });
  const r = p.dispatch.run({ request: { runId: "exe-1", nonce: "n" }, frozen: { case: { id: "gen-x", steps: [] } } });
  assert.deepEqual(JSON.parse(readFileSync(join(dirs.in, "gen-x.json"), "utf8")), { id: "gen-x", steps: [] }, "named by its id, as a case file is");
  assert.deepEqual(JSON.parse(readFileSync(join(dirs.in, "ui-tests", "project.json"), "utf8")), { name: "invoice", packs: ["orbit-backend-test"] });
  assert.equal(readFileSync(join(dirs.in, "ui-tests", "graph", "edges.json"), "utf8"), "[]");
  assert.deepEqual([...r.listed.keys()].sort(), ["store/evidence/run-1/run-log.jsonl", "store/evidence/run-1/shot.png"], "the host lists files, and a planted link is not one");
  assert.deepEqual(r.records, [{ kind: "run", case_digest: "c" }]);
  const kept = join(room, "kept");
  assert.equal(keptEvidence(r.evidence, join(kept, "exe-1"), room), "kept/exe-1");
  assert.equal(readFileSync(join(kept, "exe-1", "shot.png"), "utf8"), "png");
  writeFileSync(join(dirs.out, "envelope.json"), JSON.stringify({ v: WORKER_API, runId: "exe-1", status: "PASS", evidence: "../../outside" }));
  const escaped = p.dispatch.run({ request: { runId: "exe-1", nonce: "n" }, frozen: { case: { id: "gen-x", steps: [] } } });
  assert.deepEqual([escaped.records, escaped.listed.size, escaped.evidence], [[], 0, null], "evidence outside the worker's own output is never read");
  const silent = ports(ctx, journal(), { runtime: { dirs: () => ({ in: join(room, "in2"), out: join(room, "out2") }), dispatch: () => ({ ok: false, why: "the sandbox is not ready" }) } });
  assert.deepEqual(silent.dispatch.run({ request: { runId: "exe-2" }, frozen: { case: { id: "gen-x", steps: [] } } }), { why: "the sandbox is not ready" });
  rmSync(room, { recursive: true, force: true });
  rmSync(store, { recursive: true, force: true });
});
