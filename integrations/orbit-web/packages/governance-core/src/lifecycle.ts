// A REVISION'S LIFECYCLE, as one table. A revision of an account's policy moves only by an operation of this table;
// nothing skips a state, and a PUBLISHED revision never moves again except to SUPERSEDED when its successor is
// published.
//
//   DRAFT -> VALIDATED -> PUBLISHED -> SUPERSEDED
//      \---------\-----> DISCARDED
//
// ONE OWNER. An account has one person who owns it, so publishing is the OWNER'S CONFIRMATION of exactly the content
// they read, against exactly the revision in effect they compared it with, at the risk the server worked out -- never a
// second person's approval, and never presented as one. There is no approver to wait for, so nothing here can be stuck
// waiting for one; and there is no separation of duties to pretend: `confirmationRefusal` refuses what is not the
// owner's informed word (somebody who is not a person, content or a base that moved, a risk not acknowledged), and the
// old self-approval rule is gone on purpose -- with one person, every confirmation is their own.
//
// An agent may hand in a draft (the agent gateway), and that is all: it never edits, validates or publishes anything.
import type { AuditPrincipalType } from "./audit.js";
import { RISK_LEVELS, type RiskLevel } from "./risk.js";

export const REVISION_STATES = ["DRAFT", "VALIDATED", "PUBLISHED", "SUPERSEDED", "DISCARDED"] as const;
export type RevisionState = (typeof REVISION_STATES)[number];

export const LIFECYCLE_OPS = ["edit", "validate", "publish", "discard", "supersede"] as const;
export type LifecycleOp = (typeof LIFECYCLE_OPS)[number];

export interface Transition {
  op: LifecycleOp;
  from: readonly RevisionState[];
  to: RevisionState;
  // "owner": the account's owner asks for it; null: the engine's own move, never asked for by anybody.
  by: "owner" | null;
}

export const LIFECYCLE: readonly Transition[] = [
  { op: "edit", from: ["DRAFT", "VALIDATED"], to: "DRAFT", by: "owner" },
  { op: "validate", from: ["DRAFT"], to: "VALIDATED", by: "owner" },
  { op: "publish", from: ["VALIDATED"], to: "PUBLISHED", by: "owner" },
  { op: "discard", from: ["DRAFT", "VALIDATED"], to: "DISCARDED", by: "owner" },
  { op: "supersede", from: ["PUBLISHED"], to: "SUPERSEDED", by: null },
];

export const transitionOf = (op: LifecycleOp): Transition => LIFECYCLE.find((t) => t.op === op) as Transition;

export type Moved = { ok: true; to: RevisionState } | { ok: false; code: "WRONG_STATE"; message: string };

export function move(state: RevisionState, op: LifecycleOp): Moved {
  const t = transitionOf(op);
  if (t.from.includes(state)) return { ok: true, to: t.to };
  return { ok: false, code: "WRONG_STATE", message: `A revision that is ${state} cannot be moved by "${op}" (it needs ${t.from.join(" or ")}).` };
}

// The states in which a revision's content may no longer change (a discarded draft is never edited again either).
export const IMMUTABLE_STATES: readonly RevisionState[] = ["PUBLISHED", "SUPERSEDED", "DISCARDED"];

export interface Confirmation {
  // Who confirms: only a person (the account's owner) ever does.
  actorType: AuditPrincipalType;
  // The risk the server works out NOW, against the revision in effect now.
  risk: RiskLevel;
  // The risk the person said they read (null: none acknowledged).
  acknowledgedRisk: RiskLevel | null;
  // The digest the person read, and the revision's digest now.
  readDigest: string;
  digest: string;
  // The revision in effect the person compared it with, and the one in effect now (null: none).
  readBase: string | null;
  base: string | null;
  // A department's revision: the COMPANY policy in effect the person read it against, and the one in effect now (its
  // delegation decides what the department may say). Absent for the company's own policy.
  readCompanyBase?: string | null;
  companyBase?: string | null;
}

export type ConfirmationRefusal = "NOT_A_PERSON" | "STALE_CONTENT" | "STALE_BASE" | "STALE_COMPANY_POLICY" | "RISK_NOT_ACKNOWLEDGED";

const rank = (r: RiskLevel): number => RISK_LEVELS.indexOf(r);

// THE OWNER'S CONFIRMATION: of the content read, against the base read, having acknowledged at least the risk the change
// carries (a low-risk change needs no acknowledgement; an elevated or high one names it).
export function confirmationRefusal(c: Confirmation): ConfirmationRefusal | null {
  if (c.actorType !== "human") return "NOT_A_PERSON";
  if (c.readDigest !== c.digest) return "STALE_CONTENT";
  if (c.readBase !== c.base) return "STALE_BASE";
  if (c.companyBase !== undefined && c.readCompanyBase !== c.companyBase) return "STALE_COMPANY_POLICY";
  if (rank(c.risk) > rank(c.acknowledgedRisk ?? "low")) return "RISK_NOT_ACKNOWLEDGED";
  return null;
}
