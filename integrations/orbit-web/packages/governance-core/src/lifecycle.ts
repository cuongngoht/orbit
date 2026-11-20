// A REVISION'S LIFECYCLE, as one table. A revision moves only by an operation of this table, each needing one
// permission; nothing skips a state, and a PUBLISHED revision never moves again except to SUPERSEDED when its
// successor is published.
//
//   DRAFT -> VALIDATED -> PENDING_APPROVAL -> APPROVED -> PUBLISHED -> SUPERSEDED
//                               \-> REJECTED
//
// An approval is of ONE content: it names the digest it read. Editing a revision returns it to DRAFT and its
// approval is gone, because what was approved is no longer what would be published.
import type { Permission } from "./rbac.js";
import type { RiskLevel } from "./risk.js";

export const REVISION_STATES = ["DRAFT", "VALIDATED", "PENDING_APPROVAL", "APPROVED", "PUBLISHED", "SUPERSEDED", "REJECTED"] as const;
export type RevisionState = (typeof REVISION_STATES)[number];

export const LIFECYCLE_OPS = ["edit", "validate", "request_approval", "approve", "reject", "withdraw", "publish", "supersede"] as const;
export type LifecycleOp = (typeof LIFECYCLE_OPS)[number];

export interface Transition {
  op: LifecycleOp;
  from: readonly RevisionState[];
  to: RevisionState;
  // Null: the engine's own move, never asked for by anybody.
  permission: Permission | null;
}

export const LIFECYCLE: readonly Transition[] = [
  { op: "edit", from: ["DRAFT", "VALIDATED", "REJECTED"], to: "DRAFT", permission: "constitution.edit" },
  { op: "validate", from: ["DRAFT"], to: "VALIDATED", permission: "constitution.edit" },
  { op: "request_approval", from: ["VALIDATED"], to: "PENDING_APPROVAL", permission: "constitution.edit" },
  { op: "withdraw", from: ["PENDING_APPROVAL", "APPROVED"], to: "DRAFT", permission: "constitution.edit" },
  { op: "approve", from: ["PENDING_APPROVAL"], to: "APPROVED", permission: "constitution.approve" },
  { op: "reject", from: ["PENDING_APPROVAL"], to: "REJECTED", permission: "constitution.approve" },
  { op: "publish", from: ["APPROVED"], to: "PUBLISHED", permission: "constitution.publish" },
  { op: "supersede", from: ["PUBLISHED"], to: "SUPERSEDED", permission: null },
];

export const transitionOf = (op: LifecycleOp): Transition => LIFECYCLE.find((t) => t.op === op) as Transition;

export type Moved = { ok: true; to: RevisionState } | { ok: false; code: "WRONG_STATE"; message: string };

export function move(state: RevisionState, op: LifecycleOp): Moved {
  const t = transitionOf(op);
  if (t.from.includes(state)) return { ok: true, to: t.to };
  return { ok: false, code: "WRONG_STATE", message: `A revision that is ${state} cannot be moved by "${op}" (it needs ${t.from.join(" or ")}).` };
}

// The states in which a revision's content may no longer change.
export const IMMUTABLE_STATES: readonly RevisionState[] = ["PUBLISHED", "SUPERSEDED"];

export interface ApprovalAttempt {
  risk: RiskLevel;
  // Everybody who wrote any of the content under review: who created the revision and who edited it.
  authors: readonly string[];
  approverId: string;
  // The digest the approver read, and the revision's digest now.
  readDigest: string;
  digest: string;
}

export type ApprovalRefusal = "STALE_CONTENT" | "SELF_APPROVAL";

// SEPARATION OF DUTIES: a high-risk change is approved by somebody who wrote none of it.
export function approvalRefusal(a: ApprovalAttempt): ApprovalRefusal | null {
  if (a.readDigest !== a.digest) return "STALE_CONTENT";
  if (a.risk === "high" && a.authors.includes(a.approverId)) return "SELF_APPROVAL";
  return null;
}
