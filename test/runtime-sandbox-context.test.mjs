// A sandbox context INHERITS the project and re-roots on the workspace. What matters is what it keeps (one
// identity, one store, one registry, a person's settings) and what it replaces (root, source, rooms,
// environment, owner) -- and that building one reads, and never writes, anything.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Refused } from "../src/errors.mjs";
import { runtimeSandboxContext } from "../src/runtime/sandbox/context.mjs";
import { sandboxId } from "../src/runtime/instances.mjs";
import { sessionsNow } from "../src/runtime/lifecycle/start.mjs";
import { NODE_AND_DOTNET } from "./fakes/runtime.mjs";
import { CHECKOUT, STORE_ROOT, fakeRuntime } from "./fakes/runtime-ctx.mjs";
import { fakeWorkspaces } from "./fakes/workspaces.mjs";

const TASK = "tsk-aaaaaaaaaaaa";
const TOOLS = { node: "22.1.0", npm: "10.8.1", dotnet: "8.0.100" };

function setup() {
  const workspaces = fakeWorkspaces();
  workspaces.add(TASK, { ...NODE_AND_DOTNET, "web/package.json": '{"scripts":{"dev":"vite --port 5999"}}' });
  const rt = fakeRuntime(NODE_AND_DOTNET, { tools: TOOLS, workspaces });
  return { ...rt, workspaces, sandbox: () => runtimeSandboxContext(rt.ctx, { task: TASK }) };
}

test("a sandbox inherits the project, the store, the checkout and a person's settings -- it is never a second project", () => {
  const { ctx, sandbox } = setup();
  const sb = sandbox();
  for (const key of ["project", "storeBase", "storeRoot", "checkout", "registry", "host", "catalog", "machine", "process", "probe", "reach", "readSettings", "ecosystems"]) assert.strictEqual(sb[key], ctx[key], `${key} is the person's`);
  assert.deepEqual(sb.providers.map((p) => p.id), ["native", "devcontainer", "isolated", "sandbox"], "the ways a component runs, what an isolated sandbox's containers are, and the one that places a component on them");
  assert.equal(sb.checkout, CHECKOUT);
  assert.equal(sb.storeRoot, STORE_ROOT);
  assert.equal(sb.rooms.live, ctx.rooms.live, "the live room is shared: port ownership is read from it host-wide");
});

test("what it replaces: the workspace as root, what it holds as source, its own room, its own environment and owner", () => {
  const { ctx, workspaces, sandbox } = setup();
  const sb = sandbox();
  const ws = workspaces.tasks.get(TASK);
  assert.equal(sb.root, ws.path);
  assert.equal(sb.primaryRoot, ctx.root);
  assert.strictEqual(sb.source, ws.source, "the workspace's own source, not the checkout's HEAD");
  assert.strictEqual(sb.tree, ws.worktree);
  assert.notEqual(sb.rooms.understanding, ctx.rooms.understanding);
  assert.match(sb.rooms.understanding.replaceAll("\\", "/"), new RegExp(`/checkouts/${CHECKOUT}/sandboxes/${sandboxId({ checkout: CHECKOUT, task: TASK })}/understanding$`));
  assert.equal(sb.envId, sandboxId({ checkout: CHECKOUT, task: TASK }));
  assert.deepEqual(Object.values(sb.envs), [sb.envId, sb.envId, sb.envId, sb.envId], "for every provider the environment IS the sandbox");
  assert.deepEqual(sb.owner, { kind: "task", id: TASK });
  assert.notEqual(sb.observations, ctx.observations, "a container's answer is kept per sandbox");
});

test("it adopts nothing and writes no settings: a person's alone", () => {
  const { sandbox } = setup();
  const sb = sandbox();
  assert.throws(() => sb.writeSettings({ next: {}, revision: null, by: "person" }), (e) => e instanceof Refused && /inherits a person's settings/.test(e.message));
  assert.deepEqual([sb.proposals.list(), sb.proposals.read("x")], [[], null]);
  assert.throws(() => sb.proposals.write({}), Refused);
  assert.throws(() => sb.instances.write({}), /written by its own preparation/);
});

test("building it writes nothing -- no sandbox document, no room -- and reading its state is a read", () => {
  const { io, sandbox } = setup();
  const before = JSON.stringify([...io.files.entries()]);
  const sb = sandbox();
  const now = sb.sandboxNow();
  assert.deepEqual([now.state, now.kind, now.owner.id], ["ALLOCATED", "sandbox", TASK]);
  assert.equal(JSON.stringify([...io.files.entries()]), before, "not one file was written");
  assert.deepEqual(sb.sandboxes.list(), [], "no document until a preparation writes one");
});

test("no workspace owner, or no workspace for this task, is Refused with what to do", () => {
  const rt = fakeRuntime(NODE_AND_DOTNET, { tools: TOOLS });
  assert.throws(() => runtimeSandboxContext(rt.ctx, { task: TASK }), (e) => e instanceof Refused && /no workspace owner bound/.test(e.message));
  const withOwner = fakeRuntime(NODE_AND_DOTNET, { tools: TOOLS, workspaces: fakeWorkspaces() });
  assert.throws(() => runtimeSandboxContext(withOwner.ctx, { task: TASK }), /has no workspace of its own here — prepare-workspace comes first/);
});

test("a sandbox sees sessions of its own environment and nothing else of the live room", () => {
  const { ctx, sandbox } = setup();
  const sb = sandbox();
  ctx.sessions.write({ id: "rs-aaaaaaaaaaaa", env: ctx.envId, component: "node:web", provider: "native", state: "RUNNING", pid: 1, requestedAt: "2026-10-07T10:00:00.000Z" });
  assert.deepEqual([sessionsNow(sb).length, sessionsNow(ctx).length], [0, 1]);
});

test("its dev container backing is the one instance the container provider asks of ctx.instances, made from the document", () => {
  const { sandbox } = setup();
  const sb = sandbox();
  sb.sandboxes.write({ ...sb.sandboxDoc(), state: "READY", backing: { devcontainer: { state: "VALIDATED", files: { ".devcontainer/devcontainer.json": "fp" }, validation: null } } });
  const [instance] = sb.instances.list();
  assert.deepEqual([instance.provider, instance.state, instance.id], ["devcontainer", "VALIDATED", sb.envId]);
  assert.deepEqual(instance.files, { ".devcontainer/devcontainer.json": "fp" });
});
