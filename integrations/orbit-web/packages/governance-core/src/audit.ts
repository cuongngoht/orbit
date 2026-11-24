// THE GOVERNANCE AUDIT RECORD. It is not the chat's event journal: that one is a conversation, deleted with its chat.
// This one is evidence -- who was verified, what was decided under which revision of the account's policy, what the
// account's owner confirmed or approved -- and nothing here is ever changed or removed.
//
// Every event type declares the metadata it may carry (AUDIT_EVENTS); a key nobody declared is dropped before the
// record is sealed, so a prompt, a token or a file's contents cannot ride along by accident.
//
// The chain: each record holds the hash of the one before it, and its own hash is taken over everything it says
// together with that link. Changing, removing or reordering a record breaks every hash after it. That is TAMPER
// EVIDENCE inside one threat model -- somebody who can rewrite the whole store and every copy of its head can forge
// a consistent chain, which is why the head is also said out loud where the store's writer cannot reach. Each account
// has a chain of its own; what concerns no account (a refused stranger, the deployment's own checks) has the
// deployment's.
import { canonicalJson, type Sha256 } from "./canonical.js";

export const AUDIT_SCHEMA_VERSION = 2;

export type AuditValue = string | number | boolean | null;

const row = <K extends string>(summary: string, ...data: K[]) => ({ summary, data });

export const AUDIT_EVENTS = {
  "account.created": row("An account was created for a verified Claude identity, the first time it signed in.", "provider"),
  "auth.signed_in": row("A browser finished the Claude sign-in and was given a session of the account.", "sessionId"),
  "auth.signed_out": row("A browser's session of the account ended.", "sessionId", "reason"),
  "auth.account.ended": row("The account stopped being the runtime's: every browser session of it ended.", "reason"),
  "auth.sessions.revoked": row("Browser sessions of the account were revoked from the installation's own terminal.", "sessions", "reason"),
  "authz.denied": row("A request was refused at the gate.", "route", "cause", "action"),
  "boundary.violation": row("A caller reached for something outside what it is.", "kind", "route", "target"),
  "policy.provisioned": row("The account's default policy was published by Orbit Web when the account was created (no person's confirmation).", "revisionId", "revision", "digest", "deployment"),
  "policy.draft.created": row("A draft revision of the account's policy -- or of one department's -- was created.", "revisionId", "digest", "source", "departmentId", "proposedBy"),
  "policy.draft.edited": row("A draft revision was edited.", "revisionId", "digest", "departmentId"),
  "policy.validated": row("A revision was validated.", "revisionId", "digest", "departmentId"),
  "policy.discarded": row("A draft revision was discarded.", "revisionId", "digest", "departmentId"),
  "policy.confirmed": row("The account's owner confirmed exactly this content, against exactly that revision in effect (and, for a department, that company policy), at that risk.", "revisionId", "digest", "base", "risk", "departmentId", "companyBase"),
  "policy.published": row("A revision was published and is in effect (the company's, or one department's).", "revisionId", "revision", "digest", "replaces", "risk", "departmentId", "companyBase"),
  "override.set": row("A narrowing override was set for a chat or a research workspace.", "kind", "target", "digest"),
  "override.removed": row("A narrowing override was removed.", "kind", "target"),
  "policy.decision": row("A request was decided under the account's policy in effect (and, for an employee, its department's).", "action", "resource", "environment", "enforcement", "fingerprint", "scope", "matchedRules", "employeeId", "assignmentId", "missionId", "departmentId", "departmentRevision", "grant"),
  "run.started": row("A run of an agent started, bound to the account's policy in effect.", "scope", "runtime", "runtimeVersion", "mode", "isolation", "startedBy", "employeeId", "assignmentId", "missionId", "departmentId"),
  "run.refused": row("A run was refused before it started.", "scope", "cause"),
  "run.finished": row("A run ended.", "status", "exitCode"),
  "approval.requested": row("Approval of one protected action was asked for.", "approvalId", "action", "fingerprint", "expiresAt"),
  "approval.granted": row("The account's owner approved one protected action.", "approvalId", "fingerprint"),
  "approval.rejected": row("The account's owner rejected one protected action.", "approvalId", "fingerprint"),
  "approval.expired": row("An approval ran out of time.", "approvalId"),
  "approval.consumed": row("An approval was spent, before its action started.", "approvalId", "fingerprint"),
  "approval.consume.refused": row("An approval could not be spent.", "approvalId", "fingerprint", "cause"),
  "protected.executing": row("A protected action started.", "approvalId", "action", "fingerprint"),
  "protected.completed": row("A protected action finished.", "approvalId", "action", "fingerprint"),
  "protected.failed": row("A protected action failed.", "approvalId", "action", "fingerprint", "cause"),
  "settings.privileged.changed": row("A privileged setting was changed.", "setting", "value"),
  "settings.privileged.refused": row("A change of a privileged setting was refused.", "setting", "cause"),
  "egress.sign_in": row("A connection of Orbit Web's own Claude sign-in, decided by its fixed channel: the Claude account's hosts, nothing else.", "resource"),
  "isolation.attested": row("The agent runtime's isolation was checked and held.", "runner", "checks"),
  "isolation.failed": row("The agent runtime's isolation could not be shown.", "cause"),
  "resource.deleted": row("A chat or a research workspace was deleted; its governance records stay.", "kind"),
  "audit.verified": row("The audit chain was checked and held.", "count", "head"),
  "audit.integrity.failed": row("The audit chain does not hold.", "brokenAt", "cause"),
  "finding.status.changed": row("A finding's handling was changed.", "findingId", "resolution"),
  "report.generated": row("A daily audit report was generated.", "reportId", "day", "head"),
  "office.command": row("A command of the virtual office changed what an account's office keeps.", "command", "aggregate", "aggregateId", "version", "detail"),
  "office.refused": row("A command of the virtual office was refused.", "command", "aggregateId", "cause"),
  "office.desk.read": row("A person looked into an employee's desk: a folder's listing or a file (what was looked at, never what it holds).", "employeeId", "path", "kind", "bytes", "deskVersion"),
  "office.resources.changed": row("An employee's resources or the account's budget changed (they apply to future attempts).", "scope", "target", "before", "after"),
  "office.run.admitted": row("An employee's attempt was admitted with the resources it reserved.", "runId", "cpuMillis", "memoryMiB", "scratchMiB", "resourceRevision"),
  "office.run.released": row("An attempt's reserved resources were released once its containers were verified gone.", "runId", "reason"),
  "office.run.inputs": row("What one employee attempt was given to read, and why each (its mission, its lead's share, supervision of its parts, its own grants): the manifest staged before it started.", "runId", "assignmentId", "inputs", "digest"),
  "office.access.revoked": row("An employee attempt was stopped because something it had been given to read is no longer its to read.", "runId", "assignmentId", "cause"),
  "office.data.shared": row("A lead shared data with a part of its team: a source revision or a predecessor's hand-in (summary or full), by revision, recipient and origin.", "missionId", "recipient", "kind", "ref", "mode", "origin"),
  "office.run.network": row("What an employee's attempt reached on the network, summed up from the egress proxy's log of it (its digest seals the log).", "runId", "connections", "allowed", "refused", "limited", "hosts", "bytesIn", "bytesOut", "digest"),
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
  // The account whose chain the record is on (null: the deployment's own chain).
  accountId: string | null;
  principalId: string;
  principalType: AuditPrincipalType;
  agentId: string | null;
  // The chat (Claude Code workspace) or research workspace the record is about.
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
