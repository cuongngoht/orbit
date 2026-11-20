// THE GOVERNANCE AUDIT RECORD. It is not the chat's event journal: that one is a conversation, deleted with its chat.
// This one is evidence -- who was verified, what was decided under which policy revision, what a person approved --
// and nothing here is ever changed or removed.
//
// Every event type declares the metadata it may carry (AUDIT_EVENTS); a key nobody declared is dropped before the
// record is sealed, so a prompt, a token or a file's contents cannot ride along by accident.
//
// The chain: each record holds the hash of the one before it, and its own hash is taken over everything it says
// together with that link. Changing, removing or reordering a record breaks every hash after it. That is TAMPER
// EVIDENCE inside one threat model -- somebody who can rewrite the whole store and every copy of its head can forge
// a consistent chain, which is why the head is also said out loud where the store's writer cannot reach.
import { canonicalJson, type Sha256 } from "./canonical.js";

export const AUDIT_SCHEMA_VERSION = 1;

export type AuditValue = string | number | boolean | null;

const row = <K extends string>(summary: string, ...data: K[]) => ({ summary, data });

export const AUDIT_EVENTS = {
  "governance.initialized": row("The organization and its first owner were created.", "organizationName"),
  "operator.bootstrap.refused": row("A first-owner enrolment was refused.", "cause"),
  "operator.created": row("An operator was created.", "operatorId", "username", "roles"),
  "operator.suspended": row("An operator was suspended.", "operatorId"),
  "operator.reinstated": row("An operator was reinstated.", "operatorId"),
  "operator.role.granted": row("An operator was given a role.", "operatorId", "role"),
  "operator.role.revoked": row("An operator's role was taken away.", "operatorId", "role"),
  "operator.password.changed": row("An operator's password was changed.", "operatorId"),
  "operator.signed_in": row("An operator signed in.", "sessionId"),
  "operator.sign_in.failed": row("An operator sign-in failed.", "username", "cause"),
  "operator.signed_out": row("An operator signed out.", "sessionId"),
  "operator.session.revoked": row("An operator's sessions were ended.", "operatorId", "sessions"),
  "operator.recovery.issued": row("An owner recovery was issued from the installation's own terminal.", "operatorId"),
  "authz.denied": row("A request was refused for want of a permission.", "permission", "route", "cause"),
  "boundary.violation": row("A caller reached for something outside what it is.", "kind", "route", "target"),
  "constitution.draft.created": row("A draft revision was created.", "revisionId", "digest", "source"),
  "constitution.draft.edited": row("A draft revision was edited.", "revisionId", "digest"),
  "constitution.validated": row("A revision was validated.", "revisionId", "digest"),
  "constitution.approval.requested": row("Approval of a revision was requested.", "revisionId", "digest", "risk"),
  "constitution.withdrawn": row("A revision was taken back to a draft.", "revisionId"),
  "constitution.approved": row("A revision was approved.", "revisionId", "digest", "risk"),
  "constitution.rejected": row("A revision was rejected.", "revisionId", "digest"),
  "constitution.published": row("A revision was published and is in effect.", "revisionId", "revision", "digest", "replaces", "risk"),
  "overlay.set": row("A narrowing overlay was set.", "level", "target", "digest"),
  "overlay.removed": row("A narrowing overlay was removed.", "level", "target"),
  "agent.registered": row("An agent was registered.", "runtime", "name"),
  "agent.suspended": row("An agent was suspended."),
  "agent.reinstated": row("An agent was reinstated."),
  "workspace.governed": row("A workspace was placed under governance.", "profile", "previousAgentId"),
  "workspace.released": row("A workspace was released from governance."),
  "policy.decision": row("A request was decided under the policy in effect.", "action", "resource", "environment", "enforcement", "fingerprint", "scope", "matchedRules"),
  "run.started": row("A governed run started.", "scope", "runtime", "runtimeVersion", "mode", "isolation"),
  "run.refused": row("A governed run was refused before it started.", "scope", "cause"),
  "run.finished": row("A governed run ended.", "status", "exitCode"),
  "approval.requested": row("Approval of one protected action was asked for.", "approvalId", "action", "fingerprint", "expiresAt"),
  "approval.granted": row("A person approved one protected action.", "approvalId", "fingerprint"),
  "approval.rejected": row("A person rejected one protected action.", "approvalId", "fingerprint"),
  "approval.expired": row("An approval ran out of time.", "approvalId"),
  "approval.consumed": row("An approval was spent, before its action started.", "approvalId", "fingerprint"),
  "approval.consume.refused": row("An approval could not be spent.", "approvalId", "fingerprint", "cause"),
  "protected.executing": row("A protected action started.", "approvalId", "action", "fingerprint"),
  "protected.completed": row("A protected action finished.", "approvalId", "action", "fingerprint"),
  "protected.failed": row("A protected action failed.", "approvalId", "action", "fingerprint", "cause"),
  "settings.privileged.changed": row("A privileged setting was changed.", "setting", "value"),
  "settings.privileged.refused": row("A change of a privileged setting was refused.", "setting", "cause"),
  "isolation.attested": row("The agent runtime's isolation was checked and held.", "runner", "checks"),
  "isolation.failed": row("The agent runtime's isolation could not be shown.", "cause"),
  "session.deleted": row("A chat was deleted; its governance records stay.", "scope"),
  "audit.verified": row("The audit chain was checked and held.", "count", "head"),
  "audit.integrity.failed": row("The audit chain does not hold.", "brokenAt", "cause"),
  "finding.status.changed": row("A finding's handling was changed.", "findingId", "resolution"),
  "report.generated": row("A daily audit report was generated.", "reportId", "day", "head"),
} as const satisfies Record<string, { summary: string; data: readonly string[] }>;

export type AuditEventType = keyof typeof AUDIT_EVENTS;

export const isAuditEventType = (v: unknown): v is AuditEventType => typeof v === "string" && Object.hasOwn(AUDIT_EVENTS, v);

// Who an event is about. "system" is Orbit Web itself (a start, a scheduled report); it is never a caller.
export const AUDIT_PRINCIPAL_TYPES = ["human", "agent", "service", "system", "anonymous"] as const;
export type AuditPrincipalType = (typeof AUDIT_PRINCIPAL_TYPES)[number];

export interface AuditBody {
  schemaVersion: number;
  eventId: string;
  eventType: AuditEventType;
  occurredAt: string;
  recordedAt: string;
  organizationId: string;
  principalId: string;
  principalType: AuditPrincipalType;
  agentId: string | null;
  workspaceId: string | null;
  runId: string | null;
  correlationId: string;
  causationId: string | null;
  policyRevision: string | null;
  decisionId: string | null;
  outcome: string;
  reasonCodes: string[];
  evidenceRefs: string[];
  data: Record<string, AuditValue>;
}

export interface AuditEvent extends AuditBody {
  seq: number;
  previousHash: string | null;
  hash: string;
}

const TEXT_LIMIT = 500;

const bounded = (v: unknown): AuditValue => {
  if (v === null || typeof v === "number" || typeof v === "boolean") return v;
  return String(v).slice(0, TEXT_LIMIT);
};

// The allow-list: only the keys the event's own row declares survive, each as one bounded scalar.
export function pickData(type: AuditEventType, data: Record<string, unknown>): Record<string, AuditValue> {
  const declared = AUDIT_EVENTS[type].data as readonly string[];
  return Object.fromEntries(declared.filter((k) => data[k] !== undefined).map((k) => [k, bounded(data[k])]));
}

const hashOf = (body: AuditBody, seq: number, previousHash: string | null, sha256: Sha256): string => sha256(canonicalJson({ ...body, seq, previousHash }));

export function seal(body: AuditBody, seq: number, previousHash: string | null, sha256: Sha256): AuditEvent {
  const clean: AuditBody = { ...body, data: pickData(body.eventType, body.data) };
  return { ...clean, seq, previousHash, hash: hashOf(clean, seq, previousHash, sha256) };
}

export type ChainProblem = "SEQUENCE_GAP" | "LINK_MISMATCH" | "HASH_MISMATCH";

export type ChainCheck =
  | { ok: true; count: number; head: string | null }
  | { ok: false; count: number; brokenAt: number; eventId: string; problem: ChainProblem };

function bodyOf(event: AuditEvent): AuditBody {
  const { seq: _seq, previousHash: _previous, hash: _hash, ...body } = event;
  return body;
}

function problemOf(event: AuditEvent, expectedSeq: number, previousHash: string | null, sha256: Sha256): ChainProblem | null {
  if (event.seq !== expectedSeq) return "SEQUENCE_GAP";
  if (event.previousHash !== previousHash) return "LINK_MISMATCH";
  return hashOf(bodyOf(event), event.seq, event.previousHash, sha256) === event.hash ? null : "HASH_MISMATCH";
}

// `events` in the order they were recorded, from the first one. `after` continues a check from a head already held.
export function verifyChain(events: readonly AuditEvent[], sha256: Sha256, after: { seq: number; hash: string | null } = { seq: 0, hash: null }): ChainCheck {
  let previous = after.hash;
  let expected = after.seq + 1;
  for (const event of events) {
    const problem = problemOf(event, expected, previous, sha256);
    if (problem !== null) return { ok: false, count: events.length, brokenAt: event.seq, eventId: event.eventId, problem };
    previous = event.hash;
    expected += 1;
  }
  return { ok: true, count: events.length, head: previous };
}
