// A sandbox's ROAD, and what the workspace says about it now. The road is a table keyed by kind (so a
// person's environment is untouched by it), and STALE is never written: it is read off the workspace.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { Refused } from "../src/errors.mjs";
import { KINDS, LIFECYCLES, SANDBOX_STATES, SANDBOX_TRANSITIONS, TRANSITIONS, INSTANCE_STATES, createdSandbox, moved, sandboxId } from "../src/runtime/instances.mjs";
import { SANDBOX_NOW, nowRow, sandboxNow } from "../src/runtime/sandbox/model.mjs";
import { leasesFile, leasesRoom, operationsRoom, sandboxLiveRoom, sandboxRoom, sandboxUnderstandingRoom, sandboxesRoom } from "../src/runtime/rooms.mjs";

const CHECKOUT = "c".repeat(64);
const TASK = "tsk-aaaaaaaaaaaa";
const NOW = "2026-10-07T10:00:00.000Z";

const fresh = () => createdSandbox({ checkout: CHECKOUT, task: TASK, workspace: "ws-aaaaaaaaaaaa", baseRevision: "8ce1970" }, NOW);

test("a person's environment road is untouched, and each kind has its own table", () => {
  assert.deepEqual(KINDS, ["human", "sandbox"]);
  assert.deepEqual(LIFECYCLES.human, { states: INSTANCE_STATES, transitions: TRANSITIONS });
  assert.deepEqual(Object.keys(SANDBOX_TRANSITIONS), SANDBOX_STATES);
  assert.ok(Object.values(SANDBOX_TRANSITIONS).flat().every((to) => SANDBOX_STATES.includes(to)), "every move lands on a known state");
});

test("a sandbox is one per task per checkout, and holds ids and a tree -- never a path, a secret or a value", () => {
  const doc = fresh();
  assert.equal(doc.id, sandboxId({ checkout: CHECKOUT, task: TASK }));
  assert.notEqual(doc.id, sandboxId({ checkout: CHECKOUT, task: "tsk-bbbbbbbbbbbb" }));
  assert.notEqual(doc.id, sandboxId({ checkout: "d".repeat(64), task: TASK }));
  assert.deepEqual([doc.kind, doc.provider, doc.state, doc.owner, doc.workspace], ["sandbox", "sandbox", "ALLOCATED", { kind: "task", id: TASK }, "ws-aaaaaaaaaaaa"]);
  assert.deepEqual(doc.source, { baseRevision: "8ce1970", tree: null });
  assert.equal(/\/|\\/.test(JSON.stringify({ ...doc, createdAt: 0, updatedAt: 0 })), false, "nothing in a new document is a path");
});

test("the sandbox road: prepared, ready, left behind, released -- and nothing leaves RELEASED", () => {
  const prepared = moved(moved(fresh(), "PREPARING", NOW), "READY", NOW, { source: { baseRevision: "8ce1970", tree: "t1" } });
  assert.equal(prepared.source.tree, "t1");
  assert.equal(moved(prepared, "STALE", NOW).state, "STALE");
  assert.equal(moved(prepared, "RELEASED", NOW).state, "RELEASED");
});

test("an illegal move is refused in a sentence that says whose it is", () => {
  assert.throws(() => moved(fresh(), "READY", NOW), (e) => e instanceof Refused && /a sandbox that is ALLOCATED cannot become READY/.test(e.message));
  const released = moved(fresh(), "RELEASED", NOW);
  for (const to of SANDBOX_STATES) assert.throws(() => moved(released, to, NOW), Refused);
  assert.throws(() => moved({ ...fresh(), kind: "human", state: "PROPOSED" }, "READY", NOW), /an environment that is PROPOSED cannot become READY/, "a person's keeps its own words");
});

const built = (extra = {}) => ({ ...fresh(), state: "READY", source: { baseRevision: "8ce1970", tree: "t1" }, ...extra });

test("STALE is derived from the workspace on every read -- the document is never the one that says so", () => {
  const doc = built();
  assert.equal(sandboxNow(doc, { tree: "t1", files: {} }).state, "READY");
  const moved2 = sandboxNow(doc, { tree: "t2", files: {} });
  assert.equal(moved2.state, "STALE");
  assert.deepEqual(moved2.stale, { prepared: "t1", current: "t2" });
  assert.equal(doc.state, "READY", "reading changed nothing");
});

test("every row of the table is reachable, in order, and the last always matches", () => {
  const rows = [
    ["RELEASED", { ...built(), state: "RELEASED" }, { tree: null }],
    ["QUARANTINED", { ...built(), state: "QUARANTINED" }, { tree: null }],
    ["UNPREPARED", { ...built(), state: "PREPARING" }, { tree: "t9" }],
    ["NO_TREE", built(), { tree: null }],
    ["MOVED", built(), { tree: "t2" }],
    ["DEFINITION", built({ backing: { devcontainer: { state: "VALIDATED", files: { ".devcontainer/devcontainer.json": "a" } } } }), { tree: "t1", files: { ".devcontainer/devcontainer.json": "b" } }],
    ["CURRENT", built(), { tree: "t1", files: {} }],
  ];
  assert.deepEqual(rows.map(([name, doc, now]) => nowRow(doc, now)), rows.map(([name]) => name));
  assert.deepEqual(SANDBOX_NOW.map((r) => r.name), rows.map(([name]) => name));
  assert.ok(SANDBOX_NOW.every((r) => r.say) && SANDBOX_NOW.at(-1).when({}, {}));
});

test("a workspace that cannot be read is stale, not an error; a released sandbox stays released", () => {
  assert.equal(sandboxNow(built(), { tree: null }).state, "STALE");
  assert.match(sandboxNow(built(), { tree: null }).because, /workspace is not there/);
  assert.equal(sandboxNow({ ...built(), state: "RELEASED" }, { tree: "t2" }).state, "RELEASED");
});

test("the rooms: a sandbox's own directory under the checkout, its live room per host, the leases per host and machine-wide", () => {
  const id = sandboxId({ checkout: CHECKOUT, task: TASK });
  assert.equal(sandboxRoom("/s", CHECKOUT, id), join(sandboxesRoom("/s", CHECKOUT), id));
  assert.equal(sandboxUnderstandingRoom("/s", CHECKOUT, id), join(sandboxRoom("/s", CHECKOUT, id), "understanding"));
  assert.equal(operationsRoom(sandboxLiveRoom("/live", id)), join("/live", "sandboxes", id, "operations"));
  const leases = leasesFile(leasesRoom("/base/control/hosts", "laptop-a"));
  assert.equal(leases, join("/base/control/hosts", "laptop-a", "ports", "leases.json"), "one file per host, in a room of its own");
  assert.ok(!sandboxesRoom("/s", CHECKOUT).includes("instances"), "never in the room every reader of a person's dev container scans");
});
