// An ISOLATED sandbox end to end (ADR 0038, 0039), over a scripted container world (test/fakes/isolation.mjs):
// prepared autonomously under a usable provider and a pinned worker image (0.2.0), every container receipted BEFORE it exists, held
// to the isolation profile from what the provider REPORTS, its components started from the topology it was prepared
// with, and torn down in its order -- stopping only what ownership proves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { judge, mayStop } from "../src/runtime/ownership.mjs";
import { released } from "../src/runtime/sandbox/release.mjs";
import { stoppedNode } from "../src/runtime/sandbox/network.mjs";
import { deps } from "../src/runtime/lifecycle/deps.mjs";
import { TASK } from "./sandbox.harness.mjs";
import { FILES, isolatedWorld, isolationSet, pin, readyWorld } from "./isolated.harness.mjs";

const kinds = (iso) => iso.state.calls.map((c) => c.kind);

test("an isolated sandbox is prepared only where a provider answers and a worker image is pinned -- and then at once, with nobody's mark waited for", async () => {
  const down = isolatedWorld({ iso: { doctor: { ok: false, why: "the daemon is not running" } } });
  const none = await down.run("sandbox-prepare");
  assert.deepEqual([none.state, none.blocked.needs], ["BLOCKED", "capability"]);
  assert.match(none.blocked.because, /no isolation provider answers on this machine \(fake: the daemon is not running\) — an active generated test is BLOCKED/);
  const unset = await isolatedWorld({ workerImage: null }).run("sandbox-prepare");
  assert.deepEqual([unset.blocked.needs, /no test worker image is set/.test(unset.blocked.because)], ["person", true]);
  const w = isolatedWorld();
  const ready = await w.run("sandbox-prepare");
  assert.equal(ready.state, "READY", ready.blocked?.because);
  const doc = w.sandbox().sandboxes.read(w.sandbox().envId);
  assert.deepEqual([doc.isolation.attested, doc.isolation.egress], [true, { held: true, host: "example.com", port: 443, address: "93.184.215.14" }]);
});

test("every container is receipted BEFORE it exists, on the task's own internal, labelled network -- and handed its values only through the sandbox's scratch room", async () => {
  const w = isolatedWorld();
  const ctx = w.sandbox();
  const seen = [];
  const create = w.iso.container.create;
  w.iso.container.create = (spec, d) => (seen.push({ name: spec.name, receipt: ctx.sessions.list({ env: ctx.envId, owner: ctx.owner }).find((s) => s.container?.name === spec.name)?.state ?? null, scratch: Boolean(d.scratch) }), create(spec, d));
  assert.equal((await w.run("sandbox-prepare")).state, "READY");
  assert.ok(seen.length >= 1 && seen.every((s) => s.receipt === "STARTING" && s.scratch), JSON.stringify(seen));
  const [[name, net]] = [...w.iso.state.networks.entries()];
  assert.deepEqual([net.internal, net.labels], [true, { "orbit.task": TASK, "orbit.checkout": ctx.checkout, "orbit.env": ctx.envId }]);
  const db = [...w.iso.state.containers.values()].find((c) => c.labels["orbit.node"] === "service:db");
  assert.deepEqual([db.networks, db.aliases, db.published, db.privileged], [[name], ["db"], [], false]);
  assert.ok(db.env.includes("POSTGRES_PASSWORD"), "the compose file's literal reached the container -- by value, through the scratch room the fake insists on");
});

test("the attestation reads what the provider REPORTS: a container that came up publishing a port is refused, whatever it was asked", async () => {
  const w = isolatedWorld({ iso: { honour: (spec, facts) => (spec.labels["orbit.role"] === "service" ? { ...facts, published: ["5432/tcp"] } : facts) } });
  const second = await w.run("sandbox-prepare");
  assert.deepEqual([second.state, second.blocked.needs], ["BLOCKED", "environment"]);
  assert.match(second.blocked.because, /the isolation profile does not hold, so no generated test may run here: service:db: not NO_PUBLISHED_PORTS/);
});

test("egress that cannot be PROVEN blocks the sandbox: a lookup that never answered is not a refusal", async () => {
  const w = isolatedWorld({ iso: { probe: (host) => (host === "example.com" ? "UNKNOWN NOT_ATTEMPTED" : host === "db" ? "RESOLVED REACHABLE" : "RESOLVED UNREACHABLE") } });
  const second = await w.run("sandbox-prepare");
  assert.equal(second.state, "BLOCKED");
  assert.match(second.blocked.because, /egress: not EGRESS_BLOCKED — the lookup of example\.com gave no answer from inside, which proves nothing/);
});

test("a component built from its own Dockerfile is built while preparing, with no network, from inside the workspace -- and an edited Dockerfile is built again at its new fingerprint", async () => {
  const files = { ...FILES, "web/Dockerfile": "FROM node\nCOPY . .\n" };
  const w = await readyWorld({ files });
  assert.equal(w.ready.state, "READY", w.ready.blocked?.because);
  const [build] = w.iso.state.builds;
  const root = w.sandbox().root;
  assert.deepEqual([w.iso.state.builds.length, build.network, build.context, build.dockerfile], [1, "none", resolve(root, "web"), resolve(root, "web", "Dockerfile")], "the paths a build reads, resolved as containment resolves them");
  const started = await w.run("sandbox-start");
  assert.deepEqual(started.started.map((s) => s.component), ["node:web"], JSON.stringify(started.blocked));
  assert.equal(w.iso.state.builds.length, 1, "the image built for this tree is the one started");
  const topologyOf = () => w.sandbox().sandboxes.read(w.sandbox().envId).isolation.topology.fingerprint;
  const fingerprint = topologyOf();
  assert.match(fingerprint, /^[a-f0-9]{64}$/, "what was brought up is named by its fingerprint");
  w.workspaces.edit(TASK, "web/Dockerfile", "FROM node\nRUN echo built-again\n");
  const again = await w.run("sandbox-prepare");
  assert.equal(again.state, "READY", again.blocked?.because);
  assert.equal(w.iso.state.builds.length, 2, "the edited Dockerfile is built again, with no network, waiting for nobody");
  assert.ok(w.iso.state.builds.every((b) => b.network === "none"));
  assert.notEqual(topologyOf(), fingerprint, "what runs now is named by its new fingerprint");
});

test("its components start in containers of their own, with the supervisor; started again, what runs is attested by its own spec and reused", async () => {
  const w = await readyWorld();
  const started = await w.run("sandbox-start");
  assert.deepEqual(started.started.map((s) => [s.component, s.executionProvider]), [["node:web", "isolated"]]);
  const web = [...w.iso.state.containers.values()].find((c) => c.labels["orbit.node"] === "node:web");
  assert.deepEqual([web.running, web.mounts.map((m) => m.target), web.capDrop], [true, ["/work/app"], ["ALL"]]);
  assert.equal(started.supervisor.session !== null, true);
  assert.deepEqual(w.process.launches.map((l) => l.args.at(-1)), [`--task=${TASK}`]);
  const again = await w.run("sandbox-start");
  assert.deepEqual([again.state, again.started, again.skipped.map((s) => s.component)], [undefined, [], ["node:web"]], JSON.stringify(again.blocked));
  assert.equal(w.iso.state.stopped.length, 0, "nothing was ended to start it again");
});

test("a topology a person changed is brought up as changed, and what ran under the earlier one is ended and replaced -- never reused", async () => {
  const w = await readyWorld();
  await w.run("sandbox-start");
  isolationSet(w, () => ({ networkMode: "pod" }));
  const again = await w.run("sandbox-start");
  assert.deepEqual(again.started.map((s) => s.component), ["node:web"], JSON.stringify(again.blocked));
  const live = [...w.iso.state.containers.values()].filter((c) => c.running);
  assert.deepEqual(live.map((c) => c.labels["orbit.node"]).sort(), ["node:web", "pod", "service:db"]);
  assert.ok(live.filter((c) => c.labels["orbit.node"] !== "pod").every((c) => c.networkMode.startsWith("container:")), "each now shares the pod's namespace");
  assert.equal(w.iso.state.stopped.length, 2, "the web and the db of the earlier topology were ended first");
});

test("a container is stopped only when its receipt, its id and its labels agree: a reused name is somebody else's", async () => {
  const w = await readyWorld();
  const ctx = w.sandbox();
  const db = ctx.sessions.list({ env: ctx.envId, owner: ctx.owner }).find((s) => s.component === "service:db");
  const facts = w.iso.state.containers.get(db.container.id);
  w.iso.state.containers.delete(db.container.id);
  w.iso.state.containers.set("stranger", { ...facts, id: "stranger" });
  const judged = judge(db, { alive: true, startedAt: facts.startedAt, container: { id: "stranger", labels: facts.labels } });
  assert.deepEqual([judged.rule, mayStop(judged)], ["CONTAINER_MISMATCH", false]);
  const answer = stoppedNode(ctx, w.iso, { ...db, container: { ...db.container, id: db.container.name } }, deps(ctx));
  assert.deepEqual([answer.ok, answer.unproven, w.iso.state.stopped], [false, true, []]);
  const relabelled = judge(db, { alive: true, startedAt: facts.startedAt, container: { id: db.container.id, labels: { ...facts.labels, "orbit.task": "tsk-other" } } });
  assert.equal(mayStop(relabelled), false, "labels that do not say this sandbox's are not its");
});

test("a release tears down in its order and removes the network last; what cannot be proven leaves it QUARANTINED, released only through Control", async () => {
  const w = await readyWorld();
  await w.run("sandbox-start");
  const ctx = w.sandbox();
  const before = w.iso.state.calls.length;
  const done = await released(ctx, deps(ctx));
  assert.deepEqual([done.released, done.reason], [true, "RELEASED"]);
  assert.deepEqual(done.teardown.map((s) => s.step), ["STOP_MINTING", "STOP_TRIGGERS", "STOP_WORKERS", "AWAIT_WINDOWS", "FREEZE_EVIDENCE", "CLOSE_OBSERVERS", "CLEANUP_FIXTURES", "STOP_CONTAINERS", "REMOVE_NETWORK", "RELEASE_LEASES"]);
  const after = w.iso.state.calls.slice(before).filter((c) => ["stop", "network.remove"].includes(c.kind));
  const labelOf = (id) => w.iso.state.calls.find((c) => c.kind === "create" && c.id === id)?.spec.labels["orbit.node"];
  assert.deepEqual(after.map((c) => (c.kind === "stop" ? labelOf(c.id) : c.kind)), ["node:web", "service:db", "network.remove"], "components before services, the network after both");
  const q = await readyWorld();
  const qctx = q.sandbox();
  const db = qctx.sessions.list({ env: qctx.envId, owner: qctx.owner }).find((s) => s.component === "service:db");
  q.iso.state.containers.get(db.container.id).labels = {};
  const left = await released(qctx, deps(qctx));
  assert.deepEqual([left.released, left.reason], [false, "QUARANTINED"]);
  await assert.rejects(() => released(qctx, deps(qctx)), /only a person releases it, in Orbit Control/);
  const byPerson = await released({ ...qctx, door: "control" }, deps(qctx));
  assert.deepEqual([byPerson.released, byPerson.reason], [true, "RELEASED_BY_PERSON"]);
});
