// A task's sandbox over fakes: the person's runtime, a workspace owner with the task's files, and the ports a
// sandbox touches (a process, a probe, a clock, an in-memory store). What a test varies is the WORKSPACE (edited
// the way an editor edits it, which moves its tree), what a person TRUSTED, and what the machine holds.
import { runtimeSandboxContext } from "../src/runtime/sandbox/context.mjs";
import { COMMANDS } from "../src/runtime/index.mjs";
import { NODE_AND_DOTNET } from "./fakes/runtime.mjs";
import { fakeRuntime } from "./fakes/runtime-ctx.mjs";
import { fakeWorkspaces } from "./fakes/workspaces.mjs";

export const TASK = "tsk-aaaaaaaaaaaa";
export const OTHER = "tsk-bbbbbbbbbbbb";
export const TOOLS = { node: "22.1.0", npm: "10.8.1", dotnet: "8.0.100" };
export const CONTAINER_TOOLS = { ...TOOLS, docker: "27.3.1", "docker-daemon": "27.3.1", devcontainer: "0.71.0" };

// -> the person's runtime (`rt`), and `sandbox(task)` which makes that task's sandbox context over the same store.
export function sandboxWorld(files = NODE_AND_DOTNET, opts = {}) {
  const workspaces = fakeWorkspaces();
  workspaces.add(TASK, files);
  // The developer's own working tree holds what the checkout holds: what a sandbox's host-side commands are held to.
  const rt = fakeRuntime(files, { tools: TOOLS, worktree: files, ...opts, workspaces });
  const cache = new Map();
  const sandbox = (task = TASK) => cache.get(task) ?? cache.set(task, runtimeSandboxContext(rt.ctx, { task })).get(task);
  return { ...rt, workspaces, sandbox, run: (name, task = TASK, args = []) => COMMANDS[name].run(sandbox(task), args) };
}

// What a person does in Control: trust what the sandbox said it would run, by the fingerprints it named.
// A person's review marks on fingerprints (src/runtime/sandbox/trust.mjs): evidence a receipt names, never a gate.
export function trusted(rt, { restore = [], definitions = [] } = {}) {
  const current = rt.ctx.readSettings();
  const sandbox = current.settings.sandbox;
  return rt.ctx.writeSettings({ next: { ...current.settings, sandbox: { ...sandbox, restore: { ...sandbox.restore, trusted: [...sandbox.restore.trusted, ...restore] }, trustedDefinitions: [...sandbox.trustedDefinitions, ...definitions] } }, revision: current.revision, by: "person" });
}

// Every fingerprint a blocked answer names, in order.
export const fingerprintsIn = (text) => [...String(text).matchAll(/fingerprint ([a-f0-9]{64})/g)].map((m) => m[1]);

// A sandbox prepared from the first ask: a task's own sandbox restores and builds autonomously (0.2.0), so nobody's
// review mark is waited for.
export const prepared = (world, task = TASK) => world.run("sandbox-prepare", task);
