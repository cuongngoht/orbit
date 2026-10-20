// A server a component needs that Orbit does not run is reached from WHERE the component runs: the host reaching it says
// nothing of the container reaching it, and a sandbox keeps both answers apart, never one copied over the other.
import { test } from "node:test";
import assert from "node:assert/strict";
import { definitionFingerprint } from "../src/runtime/sandbox/trust.mjs";
import { filesOn } from "../src/runtime/validate.mjs";
import { NODE_AND_DOTNET } from "./fakes/runtime.mjs";
import { fakeProcess } from "./fakes/process.mjs";
import { fakeReach } from "./fakes/reach.mjs";
import { CONTAINER_TOOLS, fingerprintsIn, sandboxWorld, trusted } from "./sandbox.harness.mjs";

const FILES = { ...NODE_AND_DOTNET, ".devcontainer/devcontainer.json": JSON.stringify({ image: "mcr.microsoft.com/devcontainers/javascript-node:22", appPort: [5173] }) };

// docker is there; a `devcontainer exec` of a connectivity tool answers with the container's OWN network: unreachable.
const process = () => fakeProcess({ docker: { ok: true, out: "abc123\n" }, devcontainer: (args) => (args.includes("up") ? { ok: true, out: "", err: "", status: 0 } : { ok: true, out: "RESOLVED UNREACHABLE\n", err: "", status: 0 }) });

function world() {
  const w = sandboxWorld(FILES, { tools: CONTAINER_TOOLS, process: process(), reachWorld: { tcp: { "db.corp.example:1433": true } } });
  const s = w.ctx.readSettings();
  const target = { label: "Corporate SQL", host: "db.corp.example", port: 1433, requiredBy: ["node:web", "dotnet:api"], checkFrom: ["native", "devcontainer"], beforeStart: true, classification: "shared-development", retry: { attempts: 1, intervalMs: 250, timeoutMs: 250 } };
  w.ctx.writeSettings({ next: { ...s.settings, components: { "node:web": { provider: "devcontainer" }, "dotnet:api": { provider: "native" } }, connectivity: { ...s.settings.connectivity, targets: { "corp-sql": target } } }, revision: s.revision, by: "person" });
  return w;
}

async function trustedWorld() {
  const w = world();
  trusted(w, { restore: fingerprintsIn((await w.run("sandbox-prepare")).blocked.because) });
  trusted(w, { definitions: [definitionFingerprint(filesOn(w.sandbox()))] });
  return w;
}

test("the host reaches the server and the container does not: the sandbox is BLOCKED on the container's answer alone, naming it, and a person is who must act", async () => {
  const w = await trustedWorld();
  const out = await w.run("sandbox-prepare");
  assert.deepEqual([out.state, out.blocked.needs], ["BLOCKED", "person"]);
  assert.match(out.blocked.because, /node:web/);
  assert.match(out.blocked.because, /not reachable from devcontainer/);
  assert.ok(!/dotnet:api/.test(out.blocked.because), "the component that runs on the host is not held back by the container's network");
});

test("both answers are kept, each at its own location -- and the view says so, with the server's classification beside them", async () => {
  const w = await trustedWorld();
  await w.run("sandbox-prepare");
  const view = await w.run("sandbox");
  const byFrom = Object.fromEntries(view.connectivity.map((c) => [c.from, c.state]));
  assert.deepEqual(byFrom, { native: "REACHABLE", devcontainer: "UNREACHABLE" });
  assert.deepEqual([view.dataIsolation.state, view.ownership.external], ["shared-development", 1]);
  assert.match(view.dataIsolation.because, /Corporate SQL/);
});

test("once the container can reach it the same sandbox goes on, with no new sandbox: only the answer changed", async () => {
  const w = await trustedWorld();
  assert.equal((await w.run("sandbox-prepare")).state, "BLOCKED");
  w.process.calls.length = 0;
  const open = fakeProcess({ docker: { ok: true, out: "abc123\n" }, devcontainer: () => ({ ok: true, out: "RESOLVED REACHABLE\n", err: "", status: 0 }) });
  Object.assign(w.process, { run: open.run });
  w.clockState.ms += 10 * 60 * 1000;
  const again = await w.run("sandbox-prepare");
  assert.equal(again.state, "READY", JSON.stringify(again.blocked));
  assert.equal(w.sandbox().sandboxes.list().filter((d) => d.kind === "sandbox").length, 1);
  assert.ok(fakeReach);
});
