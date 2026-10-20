// src/memory/support.mjs is the ONE definition of how independent sessions
// make a record certain -- engineering and project knowledge both reconcile by
// it, each consumer imports it directly.
import assert from "node:assert/strict";
import { test } from "node:test";
import { NO_SUPPORT, counted, derive, settled, supportOf } from "../src/memory/support.mjs";

const at = (day) => ({ host: "laptop-a", at: `2026-09-${day}T10:00:00.000Z` });


test("two independent sessions and nothing against is certain; a contradiction keeps it possible", () => {
  const one = counted(NO_SUPPORT, at("20"), "seen");
  const two = counted(one, at("21"), "seen");
  assert.deepEqual([derive(one), derive(two)], ["possible", "certain"]);
  assert.equal(derive(counted(two, at("22"), "contested")), "possible");
});

test("A, B, A is two sessions and never three", () => {
  const s = [at("20"), at("21"), at("20")].reduce((support, seen) => counted(support, seen, "seen"), NO_SUPPORT);
  assert.equal(s.sessions, 2);
});

test("unsupported record support is refused without seeding historical observations", () => {
  assert.throws(() => supportOf({ evidence: ["a"], lastSeenBy: at("20") }), /Unsupported record support schema/);
});

test("settled says why, and never claims more than the support shows", () => {
  const out = settled({ id: "x" }, counted(NO_SUPPORT, at("20"), "seen"), "said once");
  assert.deepEqual([out.confidence, out.because], ["possible", "said once"]);
});
