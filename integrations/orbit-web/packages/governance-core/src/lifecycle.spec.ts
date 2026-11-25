import assert from "node:assert/strict";
import { test } from "node:test";
import { askRefusal, consumeRefusal, decideRefusal, fingerprintOf, stateAt, type ActionApproval } from "./approval.js";
import { confirmationRefusal, IMMUTABLE_STATES, LIFECYCLE, LIFECYCLE_OPS, move, REVISION_STATES, type Confirmation, type RevisionState } from "./lifecycle.js";
import { sha256 } from "./testing.spec-helpers.js";

test("a revision moves only along the table: draft, validated, published -- or discarded", () => {
  const path: [RevisionState, Parameters<typeof move>[1], RevisionState][] = [
    ["DRAFT", "validate", "VALIDATED"],
    ["VALIDATED", "publish", "PUBLISHED"],
    ["PUBLISHED", "supersede", "SUPERSEDED"],
    ["VALIDATED", "edit", "DRAFT"],
    ["DRAFT", "edit", "DRAFT"],
    ["DRAFT", "discard", "DISCARDED"],
    ["VALIDATED", "discard", "DISCARDED"],
  ];
  for (const [from, op, to] of path) assert.deepEqual(move(from, op), { ok: true, to }, `${from} ${op}`);
  // Nothing skips a state, and what is published (or thrown away) never changes.
  for (const [from, op] of [["DRAFT", "publish"], ["DRAFT", "supersede"], ["VALIDATED", "validate"]] as const) assert.equal(move(from, op).ok, false, `${from} ${op}`);
  for (const state of IMMUTABLE_STATES) for (const op of LIFECYCLE_OPS.filter((o) => o !== "supersede")) assert.equal(move(state, op).ok, false, `${state} ${op}`);
  assert.deepEqual([...REVISION_STATES], ["DRAFT", "VALIDATED", "PUBLISHED", "SUPERSEDED", "DISCARDED"]);
  // Every move is the owner's but one: the engine supersedes what a new publication replaces.
  assert.deepEqual(LIFECYCLE.filter((t) => t.by === null).map((t) => t.op), ["supersede"]);
  assert.deepEqual(LIFECYCLE.filter((t) => t.by === "owner").map((t) => t.op), ["edit", "validate", "publish", "discard"]);
});

test("one owner confirms a publication alone -- of the content and base they read, the risk acknowledged -- and nothing waits for a second person", () => {
  const c: Confirmation = { actorType: "human", risk: "low", acknowledgedRisk: null, readDigest: "d1", digest: "d1", readBase: "rev-1", base: "rev-1" };
  assert.equal(confirmationRefusal(c), null, "a low-risk change needs no acknowledgement");
  // The author confirms it: there is no separation of duties to pretend with one person, and no approver to wait for.
  assert.equal(confirmationRefusal({ ...c, risk: "high", acknowledgedRisk: "high" }), null);
  assert.equal(confirmationRefusal({ ...c, risk: "high", acknowledgedRisk: null }), "RISK_NOT_ACKNOWLEDGED");
  assert.equal(confirmationRefusal({ ...c, risk: "high", acknowledgedRisk: "elevated" }), "RISK_NOT_ACKNOWLEDGED");
  assert.equal(confirmationRefusal({ ...c, risk: "elevated", acknowledgedRisk: null }), "RISK_NOT_ACKNOWLEDGED");
  assert.equal(confirmationRefusal({ ...c, risk: "elevated", acknowledgedRisk: "high" }), null, "acknowledging more than it is, is acknowledging it");
  assert.equal(confirmationRefusal({ ...c, digest: "d2" }), "STALE_CONTENT");
  assert.equal(confirmationRefusal({ ...c, base: "rev-2" }), "STALE_BASE", "the policy in effect moved since it was compared");
  assert.equal(confirmationRefusal({ ...c, readBase: null }), "STALE_BASE");
  // Only a person confirms: never an agent, a service or Orbit Web itself.
  for (const actorType of ["agent", "service", "system", "anonymous"] as const) assert.equal(confirmationRefusal({ ...c, actorType }), "NOT_A_PERSON", actorType);
});

const NOW = "2026-11-20T10:00:00.000Z";
const LATER = "2026-11-20T11:00:00.000Z";
const approval = (over: Partial<ActionApproval> = {}): ActionApproval => ({ id: "apr-1", fingerprint: "f1", state: "pending", expiresAt: "2026-11-20T10:30:00.000Z", ...over });

test("a fingerprint is of exactly one action: any bound parameter that differs makes another", () => {
  const push = { repository: "o/r", remote: "https://github.com/o/r.git", ref: "refs/heads/x", commit: "abc", force: false, expectedRemoteOid: null };
  const f = fingerprintOf("repository.push", "local", push, sha256);
  assert.match(f, /^[0-9a-f]{64}$/);
  assert.equal(fingerprintOf("repository.push", "local", { ...push }, sha256), f);
  assert.equal(fingerprintOf("repository.push", "local", { expectedRemoteOid: null, force: false, commit: "abc", ref: "refs/heads/x", remote: "https://github.com/o/r.git", repository: "o/r" }, sha256), f);
  // A parameter the action does not declare is not part of what is approved, and cannot be smuggled into it.
  assert.equal(fingerprintOf("repository.push", "local", { ...push, comment: "please" }, sha256), f);
  for (const change of [{ commit: "abd" }, { ref: "refs/heads/main" }, { force: true }, { remote: "https://evil.example/o/r.git" }, { repository: "o/other" }, { expectedRemoteOid: "123" }]) assert.notEqual(fingerprintOf("repository.push", "local", { ...push, ...change }, sha256), f, JSON.stringify(change));
  assert.notEqual(fingerprintOf("repository.push", "production", push, sha256), f);
});

test("an approval is asked once, decided once, spent once -- and only on the action it was given for", () => {
  assert.equal(askRefusal([], "f1", NOW), null);
  assert.equal(askRefusal([approval()], "f1", NOW), "ALREADY_ASKED");
  assert.equal(askRefusal([approval({ state: "granted" })], "f1", NOW), "ALREADY_ASKED");
  assert.equal(askRefusal([approval()], "f2", NOW), null);
  for (const state of ["consumed", "rejected", "expired"] as const) assert.equal(askRefusal([approval({ state })], "f1", NOW), null, state);
  assert.equal(askRefusal([approval()], "f1", LATER), null);

  assert.equal(decideRefusal(approval(), NOW, "human"), null);
  assert.equal(decideRefusal(approval(), LATER, "human"), "APPROVAL_EXPIRED");
  for (const state of ["granted", "rejected", "consumed"] as const) assert.equal(decideRefusal(approval({ state }), NOW, "human"), "APPROVAL_DECIDED", state);
  // Only a person decides -- an agent never approves anything, a request of its own run least of all.
  for (const decider of ["agent", "service", "system", "anonymous"] as const) assert.equal(decideRefusal(approval(), NOW, decider), "DECIDER_NOT_A_PERSON", decider);

  const granted = approval({ state: "granted" });
  assert.equal(consumeRefusal(granted, "f1", NOW), null);
  assert.equal(consumeRefusal(granted, "f2", NOW), "FINGERPRINT_MISMATCH");
  assert.equal(consumeRefusal(granted, "f1", LATER), "APPROVAL_EXPIRED");
  assert.equal(consumeRefusal(approval(), "f1", NOW), "APPROVAL_NOT_GRANTED");
  assert.equal(consumeRefusal(approval({ state: "rejected" }), "f1", NOW), "APPROVAL_NOT_GRANTED");
  // The replay: what was spent stays spent, even long after.
  assert.equal(consumeRefusal(approval({ state: "consumed" }), "f1", NOW), "APPROVAL_CONSUMED");
  assert.equal(consumeRefusal(approval({ state: "consumed" }), "f1", LATER), "APPROVAL_CONSUMED");
  assert.equal(stateAt(approval({ state: "granted" }), LATER), "expired");
  assert.equal(stateAt(approval({ state: "rejected" }), LATER), "rejected");
});
