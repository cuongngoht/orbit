// The sandbox, end to end over fakes: prepared under a person's trust, placed on the way a person would run it,
// started from the task's workspace on the port it was GIVEN, stale the moment the workspace moves, and ended
// without touching anything it does not own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { PROVIDERS } from "../src/runtime/providers/index.mjs";
import { sandbox as provider } from "../src/runtime/providers/sandbox.mjs";
import { planned } from "../src/runtime/lifecycle/world.mjs";
import { ensure, look } from "../src/runtime/understanding.mjs";
import { ownerOf } from "../src/runtime/sessions.mjs";
import { sandboxId } from "../src/runtime/instances.mjs";
import { CHECKOUT } from "./fakes/runtime-ctx.mjs";
import { OTHER, TASK, fingerprintsIn, prepared, sandboxWorld, trusted } from "./sandbox.harness.mjs";

test("a person's runtime never asks the sandbox provider, and a sandbox asks only it: its candidates are the ways it could place a component", () => {
  const world = sandboxWorld();
  ensure(world.ctx);
  const personsPlan = planned(world.ctx, look(world.ctx), world.ctx.readSettings().settings, { probe: true }).plan;
  assert.deepEqual([...new Set(personsPlan.components.filter((c) => c.state === "ready").map((c) => c.provider))], ["native"]);
  assert.deepEqual(PROVIDERS.map((p) => p.id), ["native", "devcontainer"], "the list a person's context is bound to is unchanged");
  assert.deepEqual([provider.compatibility({}, { sandbox: null }).state, provider.composite, provider.reuses], ["incompatible", true, false]);
});

test("a prepare that needs a restore nobody trusted runs NOTHING, names every fingerprint and who must act, and leaves the sandbox PREPARING", async () => {
  const world = sandboxWorld();
  const answer = await world.run("sandbox-prepare");
  assert.deepEqual([answer.state, answer.blocked.needs], ["BLOCKED", "person"]);
  assert.equal(fingerprintsIn(answer.blocked.because).length, 2, "one for each unit that would be restored");
  assert.deepEqual(world.process.calls.map((c) => c.file), [], "not a single process ran");
  assert.deepEqual([world.sandbox().sandboxDoc().state, world.sandbox().sandboxDoc().blocked.needs], ["PREPARING", "person"]);
});

test("once trusted it restores only in the task's workspace, with the base environment, behind a receipt -- and a second prepare does nothing at all", async () => {
  const world = sandboxWorld(undefined, { env: { PATH: "/usr/bin", SECRET_TOKEN: "s3cr3t-value" } });
  const answer = await prepared(world);
  assert.deepEqual([answer.state, answer.reused, answer.placements], ["READY", false, { "dotnet:api": "native", "node:web": "native" }]);
  const restores = world.process.calls.filter((c) => ["npm", "dotnet"].includes(c.file));
  assert.deepEqual(restores.map((c) => [c.file, ...c.args].join(" ")).sort(), ["dotnet restore", "npm ci"]);
  assert.ok(restores.every((c) => c.opts.cwd.startsWith(resolve(world.workspaces.tasks.get(TASK).path))), "never the checkout's own directory");
  assert.ok(restores.every((c) => !("SECRET_TOKEN" in c.opts.env)), "a variable nobody listed for the component is not handed to it");
  const before = world.process.calls.length;
  const again = await world.run("sandbox-prepare");
  assert.deepEqual([again.state, again.reused, world.process.calls.length], ["READY", true, before]);
});

test("a restore is run on what the workspace holds NOW: a lock file edited after trust was judged is not what a person trusted", async () => {
  const world = sandboxWorld();
  trusted(world, { restore: fingerprintsOf(await world.run("sandbox-prepare")) });
  const source = world.sandbox().source;
  const real = source.fingerprints;
  let looks = 0;
  source.fingerprints = (scopes) => (scopes.includes("web/package-lock.json") && ++looks === 2 ? world.workspaces.edit(TASK, "web/package-lock.json", '{"changed":true}') : null, real(scopes));
  const answer = await world.run("sandbox-prepare");
  assert.equal(answer.state, "BLOCKED");
  assert.match(answer.blocked.because, /changed after trust was checked/);
  assert.deepEqual(world.process.calls.filter((c) => c.file === "npm"), [], "it did not run");
});

const fingerprintsOf = (answer) => [...answer.blocked.because.matchAll(/fingerprint ([a-f0-9]{64})/g)].map((m) => m[1]);

test("a component that can be told its port is LEASED one, never the declared port a developer may be using", async () => {
  const world = sandboxWorld();
  world.probe.listen(5000);
  const answer = await prepared(world);
  assert.deepEqual(answer.endpoints, [{ component: "dotnet:api", kind: "http", port: 42000, source: "lease" }]);
  assert.deepEqual(world.sandbox().sandboxDoc().endpoints, answer.endpoints, "kept on the document, so a status says where to look");
});

test("two tasks of one checkout lease two ports, and a port something answers on is passed over, never taken", async () => {
  const world = sandboxWorld();
  world.workspaces.add(OTHER, world.workspaces.tasks.get(TASK).files);
  world.probe.listen(42000);
  const a = await prepared(world);
  const b = await prepared(world, OTHER);
  assert.deepEqual([a.endpoints[0].port, b.endpoints[0].port], [42001, 42002], "42000 answers: it is somebody's");
  assert.equal(world.sandbox().sandboxDoc().endpoints[0].port, 42001);
});

test("a start runs the declared command from the workspace, told the port it was given, behind a session that names its owner and its tree", async () => {
  const world = sandboxWorld();
  await prepared(world);
  const out = await world.run("sandbox-start", TASK, ["--wait=0"]);
  assert.deepEqual(out.started.map((s) => [s.component, s.executionProvider]).sort(), [["dotnet:api", "native"], ["node:web", "native"]]);
  const api = world.process.launches.find((l) => l.file === "dotnet");
  assert.deepEqual(api.args, ["run", "--launch-profile", "http", "--", "--urls", "http://127.0.0.1:42000"]);
  assert.equal(api.opts.cwd, resolve(world.workspaces.tasks.get(TASK).path, "api"));
  const session = world.ctx.sessions.all().find((s) => s.component === "dotnet:api");
  assert.deepEqual([session.provider, session.executionProvider, ownerOf(session), session.env, session.ports, session.leasedPorts], ["sandbox", "native", { kind: "task", id: TASK }, sandboxId({ checkout: CHECKOUT, task: TASK }), [42000], [42000]]);
  assert.equal(session.sourceTree, world.workspaces.port.tree(TASK));
});

test("the workspace moving makes the sandbox STALE, and the next start REPLACES what ran an older tree -- never reuses it", async () => {
  const world = sandboxWorld();
  await prepared(world);
  await world.run("sandbox-start", TASK, ["--wait=0"]);
  const older = world.ctx.sessions.all().filter((s) => s.state === "RUNNING");
  world.workspaces.edit(TASK, "api/Program.cs", "class Program { /* a fix */ }");
  world.clockState.ms += 60000;
  assert.equal(world.sandbox().sandboxNow().state, "STALE");
  const out = await world.run("sandbox-start", TASK, ["--wait=0"]);
  assert.deepEqual(out.replaced.map((r) => r.component).sort(), ["dotnet:api", "node:web"]);
  assert.ok(older.every((s) => world.ctx.sessions.read(s.id).state === "STOPPED"), "the old ones were stopped through the ownership proof");
  assert.equal(out.started.length, 2);
  const current = world.ctx.sessions.all().filter((s) => s.state === "RUNNING");
  assert.ok(current.length === 2 && current.every((s) => s.sourceTree === world.workspaces.port.tree(TASK)));
  assert.equal(out.tree, world.workspaces.port.tree(TASK));
});

test("a developer's server on a FIXED port a sandbox's component declares is never REUSED, even when reuse is on and a person's readiness probe answers", async () => {
  const world = sandboxWorld();
  const settings = world.ctx.readSettings();
  world.ctx.writeSettings({ next: { ...settings.settings, reuseExternal: true, sandbox: { ...settings.settings.sandbox, ports: { ...settings.settings.sandbox.ports, mode: "fixed" } }, components: { "dotnet:api": { readiness: { kind: "tcp", target: 5000 } } } }, revision: settings.revision, by: "person" });
  await prepared(world);
  world.probe.listen(5000);
  const out = await world.run("sandbox-start", TASK, ["--component=dotnet:api", "--wait=0"]);
  assert.deepEqual([out.started.length, out.reused.length], [0, 0], "nothing was started into the developer's port, and nothing was taken for the task's own");
  assert.match(out.blocked[0].because, /port 5000 is in use by something that is not Orbit's/);
  assert.equal(out.blocked[0].needs, "person");
});
