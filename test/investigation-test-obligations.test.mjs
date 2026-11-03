// A GENERATED test's obligation on the loop's frontier (0.1.0): owed from the moment it is derived until what its
// latest execution came to settles it -- through that word's own row, so a contradiction is final, a missing provider
// or a person's decision is waited for, and anything that may safely be tried again is still owed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { contextOf, loopWorld } from "../src/investigation/loop.mjs";
import { createInvestigations, eventIdOf } from "../src/investigation/store.mjs";
import { fakeContext } from "./fakes/context.mjs";
import { fakeIo } from "./fakes/io.mjs";

const ID = "inv-20261022-140000-abcd";

// The investigation world one derived obligation is owed in, with what its executions came to.
function worldOf(obligation = {}, evaluations = []) {
  const io = fakeIo();
  const store = createInvestigations("/store/repo-1", io);
  store.create({ id: ID, objective: "owed" });
  store.appendOnce(ID, "obligation", { id: "obr-1", eventId: eventIdOf("obligation", "tob-aaaaaaaaaaaa", 0, "r1"), obligation: "tob-aaaaaaaaaaaa", revision: "r1", shape: "response-conforms", target: "endpoint:x", bindings: ["bnd-1"], expected: ["AC/E1"], authority: "accepted", method: "runtime-test", ...obligation });
  evaluations.forEach((outcome, n) => store.appendOnce(ID, "evaluated", { id: `evl-${n + 1}`, eventId: `e-${n}`, attempt: n + 1, execution: `exe-0000000000000000-${n + 1}`, obligation: "tob-aaaaaaaaaaaa", outcome }));
  return { id: ID, store, io, settings: { limits: { decisions: 50, actions: 50, minutes: 20 } }, mode: "fixture-write", ctx: { ...fakeContext(), now: () => 0 } };
}

const world = (evaluations = [], obligation = {}) => loopWorld(worldOf(obligation, evaluations)).obligations.find((o) => o.kind === "test-obligation");

test("derived and not yet designed, it is owed -- and a generate or a run-version is what may target it", () => {
  const o = world();
  assert.deepEqual([o.status, o.subject, o.can], ["pending", "tob-aaaaaaaaaaaa", ["generate", "run-version", "ask"]]);
});

// What the real Claude Code QA rows taught (0.4.0): a design's controls and its assertion templates were learned only
// from refusals (`eq` for value-eq, a permission design with no negative control), each one a repair spent. What the
// shape's own row says a design is held to travels with the obligation.
test("what a design for it is held to travels with it: the controls its shape needs and the templates its slots take", () => {
  const conforms = world().template;
  assert.deepEqual([conforms.controls, conforms.templates], [["positive"], ["value-eq", "value-in", "schema-valid"]]);
  const permission = world([], { shape: "permission-enforced" }).template;
  assert.deepEqual([permission.controls, permission.templates], [["positive", "negative"], ["value-eq", "value-excludes"]]);
  const unknown = world([], { shape: "no-such-shape" }).template;
  assert.deepEqual([unknown.controls, unknown.templates], [undefined, undefined], "a shape nobody declared says nothing");
});

// What a real Claude Code QA row taught (0.4.0, ORBIT-QA-001 on Opus): a crash test that never brought the faulted
// worker back was a false alarm on the clean application, and nothing on the frontier said a fault leaves its workload
// down. An obligation whose shape needs a fault control carries what the rule over that control says, by its id.
test("an obligation whose shape needs a fault control carries what a design must do about the workload the fault stops -- in context, as the host reads it", () => {
  for (const shape of ["crash-before-effect", "crash-after-effect-before-ack"]) {
    const { rules } = world([], { shape }).template;
    assert.deepEqual(rules?.map((r) => [r.rule, r.role]), [["RESTORED_AFTER_FAULT", "fault"]], shape);
    assert.match(rules[0].says, /brings it back — a step orbit\.workload\.control on that workload with request\.action start or restart — after the step that witnesses the fault/);
  }
  assert.equal(world().template.rules, undefined, "a shape with no fault control carries no such rule");
  assert.equal(world([], { shape: "permission-enforced" }).template.rules, undefined, "nor does one whose controls no rule says anything about");
  const ctx = contextOf(worldOf({ shape: "crash-before-effect" }));
  assert.deepEqual(ctx.frontier.find((o) => o.kind === "test-obligation")?.template.rules?.map((r) => r.rule), ["RESTORED_AFTER_FAULT"], "the frontier a host reads before it designs");
});

// What a real Claude Code QA row taught (0.4.0, ORBIT-QA-001 on Opus, three runs of three): its crash-after-effect test
// waited for the redelivery to settle as a success and asserted another criterion's slot on it -- which failed on the
// clean application, ended the test before the obligation's own slot (the effect count) was read, and contradicted the
// obligation. What its own slots are to its verdict, and what the shape says about the delivery that comes back after
// the effect, travel with the obligation.
test("an obligation's template says what its own expected slots are to its verdict, and what its shape says a design must know", async () => {
  const { OWN_SLOTS } = await import("../src/qa/generation/design.mjs");
  const crash = world([], { shape: "crash-after-effect-before-ack", expected: ["FIX-1/E2"] }).template;
  assert.deepEqual([crash.expected, crash.slots], [["FIX-1/E2"], OWN_SLOTS], "its own slots, listed, and what they are to its verdict");
  assert.match(crash.slots, /a run stops at the first assertion that fails — one that fails on a step before them ends the test there: its contradiction is this obligation's, and its own slots are never read/);
  assert.match(crash.says, /the delivery that comes back after the effect committed is not a second effect: how it settles is the system's own word, never a second success to wait for/);
  assert.match(crash.says, /observe it by its delivery attempt or by the message alone, and rule this obligation on its own expected slots \(the effect count\)/);
  assert.deepEqual([world().template.slots, world().template.says], [OWN_SLOTS, undefined], "every shape's template names its own slots; only a shape that says something more says it");
  assert.equal(world([], { shape: "no-such-shape" }).template.slots, undefined, "a shape nobody declared says nothing");
  const ctx = contextOf(worldOf({ shape: "crash-after-effect-before-ack" }));
  assert.match(ctx.frontier.find((o) => o.kind === "test-obligation")?.template.says ?? "", /not a second effect/, "the frontier a host reads before it designs");
});

test("its latest execution's word settles it through that word's own row", () => {
  const status = (words) => world(words).status;
  assert.equal(status(["SATISFIED"]), "satisfied");
  assert.equal(status(["CONTRADICTED"]), "violated");
  assert.equal(status(["REQUIRES_REQUIREMENT"]), "needs-requirement");
  assert.equal(status(["CAPABILITY_MISSING"]), "blocked");
  assert.equal(status(["AMBIGUOUS"]), "blocked", "a write whose end is unknown waits for a person");
  assert.equal(status(["ENVIRONMENT_BLOCKED"]), "pending", "a sandbox made ready again may be tried again");
  assert.equal(status(["INCONCLUSIVE"]), "pending");
  assert.equal(status(["CONTRADICTED", "SATISFIED"]), "blocked", "a contradiction another attempt did not repeat is FLAKY -- the last attempt that passed is never chosen over it");
  assert.equal(status(["ENVIRONMENT_BLOCKED", "SATISFIED"]), "satisfied", "a sandbox that was not ready, then a pass, is a pass");
});

test("a shape that only a contract represents stays a gap, never owed as if it could run", () => {
  const o = world([], { method: "manual", shape: "stream-late-events" });
  assert.deepEqual([o.status, o.blocker], ["blocked", "capability"]);
});
