// What a sandbox owns it may end, and nothing else: a person's running application, another task's sandbox and a
// holder Orbit cannot prove is its own stay exactly as they were, through a whole prepare, start and release.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionsNow } from "../src/runtime/lifecycle/start.mjs";
import { ownerOf } from "../src/runtime/sessions.mjs";
import { OTHER, TASK, prepared, sandboxWorld } from "./sandbox.harness.mjs";

// A person's own running server, as Orbit would have recorded it had they started it with `runtime start`.
function developers(world) {
  const launched = world.process.launch("npm", ["run", "dev"]);
  world.ctx.sessions.write({ id: "rs-dddddddddddd", env: world.ctx.envId, component: "node:web", provider: "native", state: "RUNNING", pid: launched.pid, requestedAt: "2026-10-03T09:00:00.000Z", startedAt: launched.startedAt, pidStartedAt: launched.startedAt, ports: [5173], command: { declaredAs: "dev", argv: ["npm", "run", "dev"], cwd: "web" } });
  return launched.pid;
}

async function two(world) {
  world.workspaces.add(OTHER, world.workspaces.tasks.get(TASK).files);
  await prepared(world, TASK);
  await prepared(world, OTHER);
  await world.run("sandbox-start", TASK, ["--wait=0"]);
  world.clockState.ms += 5000;
  await world.run("sandbox-start", OTHER, ["--wait=0"]);
}

test("releasing one task's sandbox ends ITS sessions and lets go of ITS leases -- the other task and the developer keep theirs, answering", async () => {
  const world = sandboxWorld();
  const developer = developers(world);
  await two(world);
  const bPids = sessionsNow(world.sandbox(OTHER)).map((s) => s.session.pid);
  const leasesBefore = world.sandbox(OTHER).sandboxDoc().endpoints.map((e) => e.port);
  const aPids = sessionsNow(world.sandbox(TASK)).map((s) => s.session.pid).sort();
  const out = await world.run("sandbox-release", TASK);
  assert.equal(out.released, true);
  assert.deepEqual(out.leases, [42000], "its own lease, and only that");
  assert.deepEqual(world.process.signals.map((s) => s.pid).sort(), aPids, "every signal was to a process of the released sandbox, and to nothing else");
  assert.ok(world.process.alive(developer), "the developer's server was never signalled");
  assert.ok(bPids.every((p) => world.process.alive(p)), "nor the other task's");
  assert.deepEqual(world.sandbox(OTHER).sandboxDoc().endpoints.map((e) => e.port), leasesBefore);
  assert.equal(world.sandbox().sandboxes.read(world.sandbox(OTHER).envId).state, "READY");
});

test("a task sees only its own sessions, so asking to stop everything stops its own and the sessions of others are not even listed", async () => {
  const world = sandboxWorld();
  developers(world);
  await two(world);
  const mine = sessionsNow(world.sandbox(TASK)).map((s) => ownerOf(s.session).id);
  assert.deepEqual([...new Set(mine)], [TASK]);
  const out = await world.run("sandbox-stop", TASK);
  assert.ok(out.stopped.length > 0);
  assert.equal(sessionsNow(world.sandbox(OTHER)).filter((s) => s.judgement.state === "RUNNING").length, 2);
  assert.equal(sessionsNow(world.ctx).filter((s) => s.judgement.state === "RUNNING").length, 1, "the person's one");
});

test("a released sandbox is not revived: asking again is a NEW allocation under the same id, and the first release is not repeated", async () => {
  const world = sandboxWorld();
  await prepared(world);
  assert.equal((await world.run("sandbox-release")).released, true);
  const twice = await world.run("sandbox-release");
  assert.deepEqual([twice.released, twice.reason], [false, "RELEASED"]);
  const again = await prepared(world);
  assert.equal(again.state, "READY");
  assert.equal(world.sandbox().sandboxes.read(world.sandbox().envId).state, "READY");
});

test("a sandbox command on a person's context says to name the task -- it never acts on the person's runtime instead", async () => {
  const world = sandboxWorld();
  const { COMMANDS } = await import("../src/runtime/index.mjs");
  for (const name of ["sandbox", "sandbox-prepare", "sandbox-start", "sandbox-stop", "sandbox-release", "sandbox-logs"]) await assert.rejects(async () => COMMANDS[name].run(world.ctx, []), /ONE task's sandbox/, name);
});

test("only so many sandboxes are active at once, and a person's switch turns them off: a refusal a person lifts, before anything is read", async () => {
  const world = sandboxWorld();
  const settings = world.ctx.readSettings();
  world.ctx.writeSettings({ next: { ...settings.settings, sandbox: { ...settings.settings.sandbox, limits: { active: 1 } } }, revision: settings.revision, by: "person" });
  await prepared(world);
  world.workspaces.add(OTHER, world.workspaces.tasks.get(TASK).files);
  const second = await world.run("sandbox-prepare", OTHER);
  assert.deepEqual([second.state, second.blocked.needs], ["BLOCKED", "person"]);
  assert.match(second.blocked.because, /1 sandboxes are active already/);
  const off = world.ctx.readSettings();
  world.ctx.writeSettings({ next: { ...off.settings, sandbox: { ...off.settings.sandbox, enabled: false } }, revision: off.revision, by: "person" });
  assert.match((await world.run("sandbox-prepare")).blocked.because, /turned off for this checkout/);
});

test("a sandbox's start the OS will not date is ended at once and said, rather than left running where nobody can stop it", async () => {
  const world = sandboxWorld();
  await prepared(world);
  world.process.startedAtOf = () => null;
  const out = await world.run("sandbox-start", TASK, ["--component=dotnet:api", "--wait=0"]);
  assert.deepEqual([out.started.length, out.blocked.length], [0, 1]);
  assert.match(out.blocked[0].because, /could never prove it its own[\s\S]*ended at once/);
  assert.equal(world.process.signals.length, 1, "the process it just launched was asked to end");
  assert.equal(world.ctx.sessions.all().find((s) => s.component === "dotnet:api").state, "LOST");
  const person = world.process.launch("npm", ["run", "dev"]);
  assert.ok(world.process.alive(person.pid), "nothing else was touched");
});

test("a release does not let go of the port, the lease or the container of something that would not stop: it says so, and a person clears the receipt", async () => {
  const world = sandboxWorld();
  await prepared(world);
  await world.run("sandbox-start", TASK, ["--component=dotnet:api", "--wait=0"]);
  const session = world.ctx.sessions.all().find((s) => s.component === "dotnet:api");
  assert.ok(session.pid);
  world.process.startedAtOf = () => null;
  const out = await world.run("sandbox-release");
  assert.deepEqual([out.released, out.reason, out.leases], [false, "REFUSED", []]);
  assert.equal(world.sandbox().sandboxes.read(world.sandbox().envId).state, "READY", "it is not released, and its port is still its lease");
  assert.equal(world.sandbox().sandboxDoc().endpoints.length, 1);
});
