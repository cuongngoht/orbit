// A GENERATED test's obligation on the loop's frontier (0.1.0): owed from the moment it is derived until what its
// latest execution came to settles it -- through that word's own row, so a contradiction is final, a missing provider
// or a person's decision is waited for, and anything that may safely be tried again is still owed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { loopWorld } from "../src/investigation/loop.mjs";
import { createInvestigations, eventIdOf } from "../src/investigation/store.mjs";
import { fakeContext } from "./fakes/context.mjs";
import { fakeIo } from "./fakes/io.mjs";

const ID = "inv-20261022-140000-abcd";

function world(evaluations = [], obligation = {}) {
  const io = fakeIo();
  const store = createInvestigations("/store/repo-1", io);
  store.create({ id: ID, objective: "owed" });
  store.appendOnce(ID, "obligation", { id: "obr-1", eventId: eventIdOf("obligation", "tob-aaaaaaaaaaaa", 0, "r1"), obligation: "tob-aaaaaaaaaaaa", revision: "r1", shape: "response-conforms", target: "endpoint:x", bindings: ["bnd-1"], expected: ["AC/E1"], authority: "accepted", method: "runtime-test", ...obligation });
  evaluations.forEach((outcome, n) => store.appendOnce(ID, "evaluated", { id: `evl-${n + 1}`, eventId: `e-${n}`, attempt: n + 1, execution: `exe-0000000000000000-${n + 1}`, obligation: "tob-aaaaaaaaaaaa", outcome }));
  const lw = loopWorld({ id: ID, store, io, settings: { limits: { decisions: 50 } }, mode: "fixture-write", ctx: { ...fakeContext(), now: () => 0 } });
  return lw.obligations.find((o) => o.kind === "test-obligation");
}

test("derived and not yet designed, it is owed -- and a generate or a run-version is what may target it", () => {
  const o = world();
  assert.deepEqual([o.status, o.subject, o.can], ["pending", "tob-aaaaaaaaaaaa", ["generate", "run-version", "ask"]]);
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
