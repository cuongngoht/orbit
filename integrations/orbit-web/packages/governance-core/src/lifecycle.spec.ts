import assert from "node:assert/strict";
import { test } from "node:test";
import { askRefusal, consumeRefusal, decideRefusal, fingerprintOf, stateAt, type ActionApproval } from "./approval.js";
import { approvalRefusal, IMMUTABLE_STATES, LIFECYCLE, move, REVISION_STATES, type RevisionState } from "./lifecycle.js";
import { can, OPERATOR_ROLES, permissionsOf, PERMISSIONS, ROLE_PERMISSIONS } from "./rbac.js";
import { sha256 } from "./testing.spec-helpers.js";

test("a revision moves only along the table: draft, validated, pending, approved, published", () => {
  const path: [RevisionState, Parameters<typeof move>[1], RevisionState][] = [
    ["DRAFT", "validate", "VALIDATED"],
    ["VALIDATED", "request_approval", "PENDING_APPROVAL"],
    ["PENDING_APPROVAL", "approve", "APPROVED"],
    ["APPROVED", "publish", "PUBLISHED"],
    ["PUBLISHED", "supersede", "SUPERSEDED"],
    ["PENDING_APPROVAL", "reject", "REJECTED"],
    ["REJECTED", "edit", "DRAFT"],
    ["VALIDATED", "edit", "DRAFT"],
    ["APPROVED", "withdraw", "DRAFT"],
  ];
  for (const [from, op, to] of path) assert.deepEqual(move(from, op), { ok: true, to }, `${from} ${op}`);
  // Nothing skips a state, and what is published never changes.
  for (const [from, op] of [["DRAFT", "publish"], ["DRAFT", "approve"], ["VALIDATED", "publish"], ["PENDING_APPROVAL", "publish"], ["DRAFT", "request_approval"]] as const) assert.equal(move(from, op).ok, false, `${from} ${op}`);
  for (const state of IMMUTABLE_STATES) for (const op of ["edit", "validate", "request_approval", "approve", "reject", "withdraw", "publish"] as const) assert.equal(move(state, op).ok, false, `${state} ${op}`);
  assert.equal(REVISION_STATES.length, 7);
  assert.deepEqual(LIFECYCLE.filter((t) => t.permission === null).map((t) => t.op), ["supersede"]);
});

test("a high-risk change is approved by somebody who wrote none of it, and an approval is of the content read", () => {
  const attempt = { risk: "high" as const, authors: ["op-author", "op-editor"], approverId: "op-other", readDigest: "d1", digest: "d1" };
  assert.equal(approvalRefusal(attempt), null);
  assert.equal(approvalRefusal({ ...attempt, approverId: "op-author" }), "SELF_APPROVAL");
  assert.equal(approvalRefusal({ ...attempt, approverId: "op-editor" }), "SELF_APPROVAL");
  assert.equal(approvalRefusal({ ...attempt, risk: "elevated", approverId: "op-author" }), null);
  assert.equal(approvalRefusal({ ...attempt, risk: "low", approverId: "op-author" }), null);
  assert.equal(approvalRefusal({ ...attempt, digest: "d2" }), "STALE_CONTENT");
});

test("roles are a table: an auditor reads evidence and edits nothing, an editor cannot approve or publish", () => {
  assert.deepEqual([...ROLE_PERMISSIONS.organization_owner], [...PERMISSIONS]);
  const auditor = permissionsOf(["auditor"]);
  assert.ok(auditor.includes("audit.read") && auditor.includes("reports.generate") && auditor.includes("governance.read"));
  for (const p of ["constitution.edit", "constitution.approve", "constitution.publish", "roles.manage", "operators.manage", "approvals.decide", "settings.privileged.write", "agents.manage"] as const) assert.equal(can(["auditor"], p), false, p);
  assert.equal(can(["policy_editor"], "constitution.edit"), true);
  assert.equal(can(["policy_editor"], "constitution.approve"), false);
  assert.equal(can(["policy_editor"], "constitution.publish"), false);
  assert.equal(can(["policy_approver"], "constitution.approve"), true);
  assert.equal(can(["policy_approver"], "constitution.edit"), false);
  assert.equal(can(["agent_operator"], "workspaces.govern"), true);
  assert.equal(can(["agent_operator"], "approvals.decide"), false);
  assert.equal(can([], "governance.read"), false);
  assert.equal(can(["policy_editor", "policy_approver"], "constitution.approve"), true);
  // Only the owner manages roles and operators.
  for (const role of OPERATOR_ROLES.filter((r) => r !== "organization_owner")) assert.equal(can([role], "roles.manage") || can([role], "operators.manage"), false, role);
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

  assert.equal(decideRefusal(approval(), NOW), null);
  assert.equal(decideRefusal(approval(), LATER), "APPROVAL_EXPIRED");
  for (const state of ["granted", "rejected", "consumed"] as const) assert.equal(decideRefusal(approval({ state }), NOW), "APPROVAL_DECIDED", state);

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
