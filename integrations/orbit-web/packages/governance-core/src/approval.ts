// AN APPROVAL OF ONE PROTECTED ACTION. It is bound to a FINGERPRINT of exactly that action, decided once by a PERSON --
// the account's owner, never an agent and never the run that asked for it -- spent once (consumed BEFORE the action
// starts), and never a standing permission. The words follow the Orbit
// engine's own approvals (requested, granted, rejected, expired, consumed) without importing them.
//
// These are the rules only; who stores an approval applies them inside one transaction.
import type { AuditPrincipalType } from "./audit.js";
import { canonicalJson, type Sha256 } from "./canonical.js";
import { ACTIONS, type ActionKind, type Environment } from "./vocabulary.js";

export const APPROVAL_STATES = ["pending", "granted", "rejected", "expired", "consumed"] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];

export interface ActionApproval {
  id: string;
  fingerprint: string;
  state: ApprovalState;
  // ISO time after which a pending or granted approval is expired.
  expiresAt: string;
}

// What is hashed: the action, where, and ONLY the parameters the action's row declares -- in a fixed order, so that
// the same action asked twice has the same fingerprint and any other action has another.
export function fingerprintOf(action: ActionKind, environment: Environment, params: Record<string, unknown>, sha256: Sha256): string {
  const bound = Object.fromEntries(ACTIONS[action].fingerprint.map((field) => [field, params[field] ?? null]));
  return sha256(canonicalJson({ action, environment, params: bound }));
}

// A stored state is what was last written; a pending or granted approval past its time IS expired, whatever is stored.
export function stateAt(a: ActionApproval, now: string): ApprovalState {
  const open = a.state === "pending" || a.state === "granted";
  return open && now >= a.expiresAt ? "expired" : a.state;
}

export const isOpen = (a: ActionApproval, now: string): boolean => ["pending", "granted"].includes(stateAt(a, now));

export type AskRefusal = "ALREADY_ASKED";

// One open request per fingerprint: asking again for the same action does not make a second one.
export const askRefusal = (existing: readonly ActionApproval[], fingerprint: string, now: string): AskRefusal | null =>
  existing.some((a) => a.fingerprint === fingerprint && isOpen(a, now)) ? "ALREADY_ASKED" : null;

export type DecideRefusal = "DECIDER_NOT_A_PERSON" | "APPROVAL_EXPIRED" | "APPROVAL_DECIDED";

// `decider`: who decides. Only a person does -- an agent (whatever run it is, the asking one included) or a service never.
export function decideRefusal(a: ActionApproval, now: string, decider: AuditPrincipalType): DecideRefusal | null {
  if (decider !== "human") return "DECIDER_NOT_A_PERSON";
  const state = stateAt(a, now);
  if (state === "expired") return "APPROVAL_EXPIRED";
  return state === "pending" ? null : "APPROVAL_DECIDED";
}

export type ConsumeRefusal = "APPROVAL_EXPIRED" | "APPROVAL_NOT_GRANTED" | "APPROVAL_CONSUMED" | "FINGERPRINT_MISMATCH";

// `fingerprint` is taken again from the action as it is about to run: an approval of one action spends on no other.
export function consumeRefusal(a: ActionApproval, fingerprint: string, now: string): ConsumeRefusal | null {
  const state = stateAt(a, now);
  if (state === "consumed") return "APPROVAL_CONSUMED";
  if (state === "expired") return "APPROVAL_EXPIRED";
  if (state !== "granted") return "APPROVAL_NOT_GRANTED";
  return a.fingerprint === fingerprint ? null : "FINGERPRINT_MISMATCH";
}
