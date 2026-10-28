// An environment instance moves along a short road, and only one end of it can
// start anything. Governance says what every command is, and no command is a
// test run, a write to an API, a seed or a reset.
import { test } from "node:test";
import assert from "node:assert/strict";
import { INSTANCE_STATES, TRANSITIONS, createInstances, created, instanceId, moved } from "../src/runtime/instances.mjs";
import { NOT_RUNTIME, OPERATIONS, classOf, needsHuman } from "../src/runtime/governance.mjs";
import { instancesRoom } from "../src/runtime/rooms.mjs";
import { Refused } from "../src/errors.mjs";
import { fakeIo } from "./fakes/io.mjs";

const NOW = "2026-10-03T10:00:00.000Z";
const ROOM = instancesRoom("/store/repo", "c".repeat(64));

test("an instance id is the checkout's, the kind's and the name's -- the same every time, and different for another checkout", () => {
  const base = { checkout: "c".repeat(64), kind: "human", name: "devcontainer" };
  assert.equal(instanceId(base), instanceId({ ...base }));
  assert.match(instanceId(base), /^env-[a-f0-9]{12}$/);
  assert.notEqual(instanceId(base), instanceId({ ...base, checkout: "d".repeat(64) }));
  assert.notEqual(instanceId(base), instanceId({ ...base, name: "other" }), "one checkout may have several environments");
});

test("the road is PROPOSED, ADOPTED, VALIDATING, then VALIDATED or FAILED -- and nothing jumps", () => {
  assert.deepEqual(Object.keys(TRANSITIONS), INSTANCE_STATES);
  const proposed = created({ checkout: "c".repeat(64), name: "devcontainer", provider: "devcontainer" }, NOW);
  assert.equal(proposed.state, "PROPOSED");
  const adopted = moved(proposed, "ADOPTED", NOW);
  assert.throws(() => moved(proposed, "VALIDATED", NOW), (e) => e instanceof Refused && /PROPOSED cannot become VALIDATED/.test(e.message));
  assert.throws(() => moved(adopted, "VALIDATED", NOW), /ADOPTED cannot become VALIDATED/, "files that were written are not an environment that was built");
  const validating = moved(adopted, "VALIDATING", NOW);
  assert.equal(moved(validating, "VALIDATED", NOW).state, "VALIDATED");
  assert.equal(moved(validating, "VALIDATION_FAILED", NOW, { validation: { state: "VALIDATION_FAILED" } }).validation.state, "VALIDATION_FAILED");
});

test("a failed validation can be tried again, and a change to the files starts the road over", () => {
  const failed = { ...created({ checkout: "c".repeat(64), name: "devcontainer", provider: "devcontainer" }, NOW), state: "VALIDATION_FAILED" };
  assert.equal(moved(failed, "VALIDATING", NOW).state, "VALIDATING");
  assert.equal(moved({ ...failed, state: "VALIDATED" }, "ADOPTED", NOW).state, "ADOPTED");
});

test("instances are kept one document each, read back, and an id that is not one is never a path", () => {
  const io = fakeIo();
  const instances = createInstances(ROOM, io);
  const doc = created({ checkout: "c".repeat(64), name: "devcontainer", provider: "devcontainer", files: { ".devcontainer/devcontainer.json": "abc" } }, NOW);
  instances.write(doc);
  assert.deepEqual(instances.list().map((i) => i.id), [doc.id]);
  assert.equal(instances.read(doc.id).files[".devcontainer/devcontainer.json"], "abc");
  assert.equal(instances.read("../x"), null);
});

test("every runtime command is in exactly one governance class, and the classes QA and people own are not runtime's", () => {
  const all = OPERATIONS.flatMap((o) => o.commands);
  assert.equal(new Set(all).size, all.length, "a command is one class");
  for (const name of NOT_RUNTIME) assert.equal(OPERATIONS.some((o) => o.class === name), false, `${name} is not something a runtime command is`);
  assert.deepEqual(NOT_RUNTIME, ["RUN_TEST", "API_WRITE", "SEED_DATA", "DESTRUCTIVE_RESET"]);
  assert.deepEqual(OPERATIONS.filter((o) => o.mutates === "repository").map((o) => o.commands), [["adopt"]], "one command writes the repository");
});

test("autonomous by default: only writing the checkout crosses a protected boundary (a person's own act), only settings are a person's word; bringing an environment up and forgetting a checkout ask nobody", () => {
  assert.deepEqual(all("protected"), ["adopt"]);
  assert.deepEqual(all("human"), ["configure"]);
  assert.deepEqual(all("control"), ["trust"], "a review mark is Control's to write, and gates nothing");
  assert.ok(["validate", "prepare", "forget", "sandbox-prepare", "start", "sandbox-start"].every((c) => classOf(c).approval === "none"));
  assert.equal(needsHuman("start"), false);
  assert.equal(classOf("stop").class, "STOP_OWNED_RUNTIME");
  assert.equal(classOf("nonesuch"), null);
  assert.match(classOf("stop").says, /ends a process Orbit proved is its own; refuses anything else/);
});

const all = (approval) => OPERATIONS.filter((o) => o.approval === approval).flatMap((o) => o.commands);
