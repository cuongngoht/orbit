// RUNTIME SECURITY, as the API serves it and the page shows it: a green word only for protection proven and still fresh,
// an outcome that never calls a detection a prevention, and a person's review held to its words.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkReviewIncident, INCIDENT_SEVERITIES, outcomeOf, PROTECTION_STATES, protectionBadge, protectionHolds, RUNTIME_OUTCOMES } from "./runtime-security.js";
import type { Checked } from "./validate.js";

const errorsOf = <T>(c: Checked<T>): string[] => (c.ok ? [] : c.errors);
const NOW = Date.parse("2026-11-26T12:00:00.000Z");
const later = new Date(NOW + 60_000).toISOString();
const earlier = new Date(NOW - 1).toISOString();

test("only PROTECTED with fresh evidence is shown as protected: stale evidence is UNKNOWN, never green", () => {
  assert.equal(protectionBadge({ state: "PROTECTED", freshUntil: later }, NOW), "protected");
  assert.equal(protectionBadge({ state: "PROTECTED", freshUntil: earlier }, NOW), "unknown");
  assert.equal(protectionBadge({ state: "PROTECTED", freshUntil: null }, NOW), "unknown");
  assert.equal(protectionBadge({ state: "VERIFIED", freshUntil: later }, NOW), "verifying");
  assert.equal(protectionBadge({ state: "OBSERVING", freshUntil: later }, NOW), "observing");
  assert.equal(protectionBadge({ state: "DEGRADED", freshUntil: later }, NOW), "degraded");
  assert.equal(protectionBadge({ state: "CONTAINED", freshUntil: null }, NOW), "contained");
  assert.equal(protectionBadge({ state: "UNKNOWN", freshUntil: later }, NOW), "unknown");
  // Every state has a word; none of them but PROTECTED is "protected".
  for (const state of PROTECTION_STATES) {
    const word = protectionBadge({ state, freshUntil: later }, NOW);
    assert.equal(word === "protected", state === "PROTECTED", state);
  }
});

test("an enforced attempt may act only on proof that is VERIFIED or PROTECTED and fresh; observe and disabled hold nothing back", () => {
  assert.equal(protectionHolds({ mode: "enforce", state: "PROTECTED", freshUntil: later }, NOW), true);
  assert.equal(protectionHolds({ mode: "enforce", state: "VERIFIED", freshUntil: later }, NOW), true);
  assert.equal(protectionHolds({ mode: "enforce", state: "PROTECTED", freshUntil: earlier }, NOW), false, "stale proof is no proof");
  assert.equal(protectionHolds({ mode: "enforce", state: "PROTECTED", freshUntil: null }, NOW), false);
  for (const state of PROTECTION_STATES.filter((s) => s !== "PROTECTED" && s !== "VERIFIED")) assert.equal(protectionHolds({ mode: "enforce", state, freshUntil: later }, NOW), false, state);
  for (const state of PROTECTION_STATES) {
    assert.equal(protectionHolds({ mode: "observe", state, freshUntil: null }, NOW), true, `observe ${state}`);
    assert.equal(protectionHolds({ mode: "disabled", state, freshUntil: null }, NOW), true, `disabled ${state}`);
  }
});

test("an outcome is decided from the policy's mode as READ BACK, never from the event's own action word", () => {
  // The sensor names the rule's action (OVERRIDE) even in monitor mode: only enforce makes it a prevention.
  assert.equal(outcomeOf({ matched: true, policyMode: "enforce", action: "override" }), "OPERATION_PREVENTED");
  assert.equal(outcomeOf({ matched: true, policyMode: "monitor", action: "override" }), "VIOLATION_DETECTED");
  assert.equal(outcomeOf({ matched: true, policyMode: "unknown", action: "override" }), "VIOLATION_DETECTED");
  assert.equal(outcomeOf({ matched: true, policyMode: "enforce", action: "sigkill" }), "PROCESS_TERMINATED");
  assert.equal(outcomeOf({ matched: true, policyMode: "enforce", action: "post" }), "VIOLATION_DETECTED");
  assert.equal(outcomeOf({ matched: false, policyMode: "enforce", action: "override" }), "OBSERVED");
  assert.deepEqual([...RUNTIME_OUTCOMES], ["OBSERVED", "VIOLATION_DETECTED", "OPERATION_PREVENTED", "PROCESS_TERMINATED", "WORKLOAD_CONTAINED"]);
  assert.deepEqual([...INCIDENT_SEVERITIES], ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]);
});

test("a person's review names one decision and says why; anything else is refused", () => {
  assert.deepEqual(checkReviewIncident({ decision: "resolve", note: "A dependency's postinstall, expected." }), { ok: true, value: { decision: "resolve", note: "A dependency's postinstall, expected." } });
  assert.deepEqual(checkReviewIncident({ decision: "investigate", note: "" }), { ok: true, value: { decision: "investigate", note: "" } });
  assert.equal(checkReviewIncident({ decision: "authorize_retry", note: "Reviewed the process tree." }).ok, true);
  assert.ok(errorsOf(checkReviewIncident({ decision: "authorize_retry", note: "  " })).some((e) => /note/.test(e)), "a retry is authorized with a reason");
  assert.ok(errorsOf(checkReviewIncident({ decision: "ignore", note: "x" })).some((e) => /decision/.test(e)));
  assert.ok(errorsOf(checkReviewIncident({ decision: "resolve", note: "x".repeat(2001) })).some((e) => /note/.test(e)));
  assert.ok(errorsOf(checkReviewIncident({ decision: "resolve", note: "x", publishPolicy: true })).some((e) => /publishPolicy/.test(e)));
  assert.ok(errorsOf(checkReviewIncident(null)).length > 0);
});
