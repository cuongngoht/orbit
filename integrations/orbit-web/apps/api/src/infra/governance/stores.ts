// Typed access to governance's tables (governance-db.ts). Each store owns its SQL; nothing else writes these tables.
// Secrets are never stored: a session's or a run's token is kept as its SHA-256, a password as its scrypt hash.
import { createHash } from "node:crypto";
import {
  AUDIT_SCHEMA_VERSION,
  seal,
  type AuditBody,
  type AuditEvent,
  type AuditEventType,
  type AuditPrincipalType,
  type AuditValue,
  type OperatorRole,
  type RevisionState,
  type RiskLevel,
} from "@orbit-web/governance-core";
import type { AgentRuntime, EnforcementProfile, FindingResolution, IsolationCheck, IsolationState, OperatorStatus, RevisionSource } from "@orbit-web/contracts";
import type { GovernanceDatabase } from "./governance-db.js";

type Row = Record<string, unknown>;

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

const str = (v: unknown): string => String(v);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const json = <T>(v: unknown): T => JSON.parse(str(v)) as T;

// ---- the organization and its operators ------------------------------------------------------------------------------

export interface Organization {
  id: string;
  name: string;
  createdAt: string;
}

export interface OperatorRecord {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  status: OperatorStatus;
  createdAt: string;
  createdBy: string;
  passwordChangedAt: string;
  roles: OperatorRole[];
}

export interface OperatorSessionRecord {
  id: string;
  operatorId: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface LoginFailures {
  failures: number;
  firstAt: string;
  lockedUntil: string | null;
}

export class OperatorStore {
  constructor(private readonly database: GovernanceDatabase) {}

  organization(): Organization | null {
    const row = this.database.db.prepare("SELECT id, name, created_at FROM organization WHERE singleton = 1").get() as Row | undefined;
    return row ? { id: str(row.id), name: str(row.name), createdAt: str(row.created_at) } : null;
  }

  createOrganization(o: Organization): void {
    this.database.db.prepare("INSERT INTO organization (singleton, id, name, created_at) VALUES (1, ?, ?, ?)").run(o.id, o.name, o.createdAt);
  }

  private rolesOf(operatorId: string): OperatorRole[] {
    const rows = this.database.db.prepare("SELECT role FROM operator_roles WHERE operator_id = ? ORDER BY role").all(operatorId) as Row[];
    return rows.map((r) => str(r.role) as OperatorRole);
  }

  private operatorOf(row: Row): OperatorRecord {
    return {
      id: str(row.id),
      username: str(row.username),
      displayName: str(row.display_name),
      passwordHash: str(row.password_hash),
      status: str(row.status) as OperatorStatus,
      createdAt: str(row.created_at),
      createdBy: str(row.created_by),
      passwordChangedAt: str(row.password_changed_at),
      roles: this.rolesOf(str(row.id)),
    };
  }

  byId(id: string): OperatorRecord | null {
    const row = this.database.db.prepare("SELECT * FROM operators WHERE id = ?").get(id) as Row | undefined;
    return row ? this.operatorOf(row) : null;
  }

  byUsername(username: string): OperatorRecord | null {
    const row = this.database.db.prepare("SELECT * FROM operators WHERE username = ?").get(username) as Row | undefined;
    return row ? this.operatorOf(row) : null;
  }

  list(): OperatorRecord[] {
    return (this.database.db.prepare("SELECT * FROM operators ORDER BY created_at, username").all() as Row[]).map((r) => this.operatorOf(r));
  }

  create(o: Omit<OperatorRecord, "roles">): void {
    this.database.db
      .prepare("INSERT INTO operators (id, username, display_name, password_hash, status, created_at, created_by, password_changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(o.id, o.username, o.displayName, o.passwordHash, o.status, o.createdAt, o.createdBy, o.passwordChangedAt);
  }

  setStatus(id: string, status: OperatorStatus): void {
    this.database.db.prepare("UPDATE operators SET status = ? WHERE id = ?").run(status, id);
  }

  setPassword(id: string, passwordHash: string, at: string): void {
    this.database.db.prepare("UPDATE operators SET password_hash = ?, password_changed_at = ? WHERE id = ?").run(passwordHash, at, id);
  }

  grant(operatorId: string, role: OperatorRole, by: string, at: string): boolean {
    return Number(this.database.db.prepare("INSERT OR IGNORE INTO operator_roles (operator_id, role, granted_by, granted_at) VALUES (?, ?, ?, ?)").run(operatorId, role, by, at).changes) > 0;
  }

  revoke(operatorId: string, role: OperatorRole): boolean {
    return Number(this.database.db.prepare("DELETE FROM operator_roles WHERE operator_id = ? AND role = ?").run(operatorId, role).changes) > 0;
  }

  activeOwners(): string[] {
    const rows = this.database.db.prepare("SELECT o.id FROM operators o JOIN operator_roles r ON r.operator_id = o.id WHERE r.role = 'organization_owner' AND o.status = 'active'").all() as Row[];
    return rows.map((r) => str(r.id));
  }

  createSession(s: { id: string; tokenHash: string; operatorId: string; createdAt: string; expiresAt: string }): void {
    this.database.db.prepare("INSERT INTO operator_sessions (id, token_hash, operator_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)").run(s.id, s.tokenHash, s.operatorId, s.createdAt, s.createdAt, s.expiresAt);
  }

  sessionByToken(tokenHash: string): OperatorSessionRecord | null {
    const row = this.database.db.prepare("SELECT * FROM operator_sessions WHERE token_hash = ?").get(tokenHash) as Row | undefined;
    return row ? { id: str(row.id), operatorId: str(row.operator_id), createdAt: str(row.created_at), lastSeenAt: str(row.last_seen_at), expiresAt: str(row.expires_at), revokedAt: strOrNull(row.revoked_at) } : null;
  }

  touchSession(id: string, at: string): void {
    this.database.db.prepare("UPDATE operator_sessions SET last_seen_at = ? WHERE id = ? AND revoked_at IS NULL").run(at, id);
  }

  revokeSession(id: string, at: string, reason: string): void {
    this.database.db.prepare("UPDATE operator_sessions SET revoked_at = ?, revoked_reason = ? WHERE id = ? AND revoked_at IS NULL").run(at, reason, id);
  }

  // Ends every open session of an operator but `except`; how many it ended.
  revokeSessions(operatorId: string, at: string, reason: string, except: string | null = null): number {
    return Number(this.database.db.prepare("UPDATE operator_sessions SET revoked_at = ?, revoked_reason = ? WHERE operator_id = ? AND revoked_at IS NULL AND id IS NOT ?").run(at, reason, operatorId, except).changes);
  }

  failures(username: string): LoginFailures | null {
    const row = this.database.db.prepare("SELECT * FROM login_failures WHERE username = ?").get(username) as Row | undefined;
    return row ? { failures: Number(row.failures), firstAt: str(row.first_at), lockedUntil: strOrNull(row.locked_until) } : null;
  }

  setFailures(username: string, f: LoginFailures): void {
    this.database.db
      .prepare("INSERT INTO login_failures (username, failures, first_at, locked_until) VALUES (?, ?, ?, ?) ON CONFLICT(username) DO UPDATE SET failures = excluded.failures, first_at = excluded.first_at, locked_until = excluded.locked_until")
      .run(username, f.failures, f.firstAt, f.lockedUntil);
  }

  clearFailures(username: string): void {
    this.database.db.prepare("DELETE FROM login_failures WHERE username = ?").run(username);
  }
}

// ---- the audit record ------------------------------------------------------------------------------------------------

export type AuditDraft = Omit<AuditBody, "schemaVersion" | "recordedAt">;

const AUDIT_COLUMNS =
  "seq, event_id, schema_version, event_type, occurred_at, recorded_at, organization_id, principal_id, principal_type, agent_id, workspace_id, run_id, correlation_id, causation_id, policy_revision, decision_id, outcome, reason_codes, evidence_refs, data, previous_hash, hash";

function eventOf(row: Row): AuditEvent {
  return {
    seq: Number(row.seq),
    eventId: str(row.event_id),
    schemaVersion: Number(row.schema_version),
    eventType: str(row.event_type) as AuditEventType,
    occurredAt: str(row.occurred_at),
    recordedAt: str(row.recorded_at),
    organizationId: str(row.organization_id),
    principalId: str(row.principal_id),
    principalType: str(row.principal_type) as AuditPrincipalType,
    agentId: strOrNull(row.agent_id),
    workspaceId: strOrNull(row.workspace_id),
    runId: strOrNull(row.run_id),
    correlationId: str(row.correlation_id),
    causationId: strOrNull(row.causation_id),
    policyRevision: strOrNull(row.policy_revision),
    decisionId: strOrNull(row.decision_id),
    outcome: str(row.outcome),
    reasonCodes: json<string[]>(row.reason_codes),
    evidenceRefs: json<string[]>(row.evidence_refs),
    data: json<Record<string, AuditValue>>(row.data),
    previousHash: strOrNull(row.previous_hash),
    hash: str(row.hash),
  };
}

export class AuditStore {
  constructor(private readonly database: GovernanceDatabase) {}

  head(): { seq: number; hash: string } | null {
    const row = this.database.db.prepare("SELECT seq, hash FROM audit_events ORDER BY seq DESC LIMIT 1").get() as Row | undefined;
    return row ? { seq: Number(row.seq), hash: str(row.hash) } : null;
  }

  // Seals the record onto the chain and stores it, in one transaction. The same eventId twice is the record already
  // there (idempotent): a retried write adds nothing.
  append(draft: AuditDraft): AuditEvent {
    return this.database.transaction(() => {
      const existing = this.get(draft.eventId);
      if (existing !== null) return existing;
      const head = this.head();
      const event = seal({ ...draft, schemaVersion: AUDIT_SCHEMA_VERSION, recordedAt: new Date().toISOString() }, (head?.seq ?? 0) + 1, head?.hash ?? null, sha256);
      this.database.db
        .prepare(`INSERT INTO audit_events (${AUDIT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          event.seq,
          event.eventId,
          event.schemaVersion,
          event.eventType,
          event.occurredAt,
          event.recordedAt,
          event.organizationId,
          event.principalId,
          event.principalType,
          event.agentId,
          event.workspaceId,
          event.runId,
          event.correlationId,
          event.causationId,
          event.policyRevision,
          event.decisionId,
          event.outcome,
          JSON.stringify(event.reasonCodes),
          JSON.stringify(event.evidenceRefs),
          JSON.stringify(event.data),
          event.previousHash,
          event.hash,
        );
      return event;
    });
  }

  get(eventId: string): AuditEvent | null {
    const row = this.database.db.prepare(`SELECT ${AUDIT_COLUMNS} FROM audit_events WHERE event_id = ?`).get(eventId) as Row | undefined;
    return row ? eventOf(row) : null;
  }

  count(): number {
    return Number((this.database.db.prepare("SELECT COUNT(*) AS n FROM audit_events").get() as Row).n);
  }

  // Newest first, below `before` (a seq), at most `limit`, of the given types when named.
  page(o: { before?: number; limit: number; types?: readonly string[] }): AuditEvent[] {
    const types = o.types ?? [];
    const where = [...(o.before !== undefined ? ["seq < ?"] : []), ...(types.length > 0 ? [`event_type IN (${types.map(() => "?").join(", ")})`] : [])];
    const sql = `SELECT ${AUDIT_COLUMNS} FROM audit_events ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY seq DESC LIMIT ?`;
    const args = [...(o.before !== undefined ? [o.before] : []), ...types, o.limit];
    return (this.database.db.prepare(sql).all(...args) as Row[]).map(eventOf);
  }

  // Every record, in the order it was recorded: what a check of the chain reads.
  all(): AuditEvent[] {
    return (this.database.db.prepare(`SELECT ${AUDIT_COLUMNS} FROM audit_events ORDER BY seq`).all() as Row[]).map(eventOf);
  }

  // The records that occurred in [from, to), in order.
  between(from: string, to: string): AuditEvent[] {
    return (this.database.db.prepare(`SELECT ${AUDIT_COLUMNS} FROM audit_events WHERE occurred_at >= ? AND occurred_at < ? ORDER BY seq`).all(from, to) as Row[]).map(eventOf);
  }

  ofTypes(types: readonly string[], limit: number): AuditEvent[] {
    return this.page({ limit, types });
  }

  byDecision(decisionId: string): AuditEvent | null {
    const row = this.database.db.prepare(`SELECT ${AUDIT_COLUMNS} FROM audit_events WHERE decision_id = ? AND event_type = 'policy.decision' ORDER BY seq LIMIT 1`).get(decisionId) as Row | undefined;
    return row ? eventOf(row) : null;
  }

  ofWorkspace(workspaceId: string, limit: number): AuditEvent[] {
    return (this.database.db.prepare(`SELECT ${AUDIT_COLUMNS} FROM audit_events WHERE workspace_id = ? ORDER BY seq DESC LIMIT ?`).all(workspaceId, limit) as Row[]).map(eventOf);
  }
}

// ---- the Constitution's revisions and overlays ---------------------------------------------------------------------

export interface RevisionRecord {
  id: string;
  revision: number | null;
  state: RevisionState;
  // The document as it was written (JSON text).
  document: string;
  digest: string;
  name: string;
  risk: RiskLevel | null;
  source: RevisionSource;
  basedOn: string | null;
  authors: string[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  approvedDigest: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
  supersededAt: string | null;
}

function revisionOf(row: Row): RevisionRecord {
  return {
    id: str(row.id),
    revision: row.revision === null || row.revision === undefined ? null : Number(row.revision),
    state: str(row.state) as RevisionState,
    document: str(row.document),
    digest: str(row.digest),
    name: str(row.name),
    risk: strOrNull(row.risk) as RiskLevel | null,
    source: str(row.source) as RevisionSource,
    basedOn: strOrNull(row.based_on),
    authors: json<string[]>(row.authors),
    createdAt: str(row.created_at),
    createdBy: str(row.created_by),
    updatedAt: str(row.updated_at),
    approvedDigest: strOrNull(row.approved_digest),
    approvedBy: strOrNull(row.approved_by),
    approvedAt: strOrNull(row.approved_at),
    publishedAt: strOrNull(row.published_at),
    publishedBy: strOrNull(row.published_by),
    supersededAt: strOrNull(row.superseded_at),
  };
}

export class RevisionStore {
  constructor(private readonly database: GovernanceDatabase) {}

  get(id: string): RevisionRecord | null {
    const row = this.database.db.prepare("SELECT * FROM revisions WHERE id = ?").get(id) as Row | undefined;
    return row ? revisionOf(row) : null;
  }

  list(): RevisionRecord[] {
    return (this.database.db.prepare("SELECT * FROM revisions ORDER BY created_at DESC, id").all() as Row[]).map(revisionOf);
  }

  effective(): RevisionRecord | null {
    const row = this.database.db.prepare("SELECT * FROM revisions WHERE state = 'PUBLISHED' ORDER BY revision DESC LIMIT 1").get() as Row | undefined;
    return row ? revisionOf(row) : null;
  }

  nextNumber(): number {
    return Number((this.database.db.prepare("SELECT COALESCE(MAX(revision), 0) + 1 AS n FROM revisions").get() as Row).n);
  }

  insert(r: RevisionRecord): void {
    this.database.db
      .prepare(
        "INSERT INTO revisions (id, revision, state, document, digest, name, risk, source, based_on, authors, created_at, created_by, updated_at, approved_digest, approved_by, approved_at, published_at, published_by, superseded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(r.id, r.revision, r.state, r.document, r.digest, r.name, r.risk, r.source, r.basedOn, JSON.stringify(r.authors), r.createdAt, r.createdBy, r.updatedAt, r.approvedDigest, r.approvedBy, r.approvedAt, r.publishedAt, r.publishedBy, r.supersededAt);
  }

  // Writes every field of `r` back (the triggers refuse what may never change).
  save(r: RevisionRecord): void {
    this.database.db
      .prepare(
        "UPDATE revisions SET revision = ?, state = ?, document = ?, digest = ?, name = ?, risk = ?, authors = ?, updated_at = ?, approved_digest = ?, approved_by = ?, approved_at = ?, published_at = ?, published_by = ?, superseded_at = ? WHERE id = ?",
      )
      .run(r.revision, r.state, r.document, r.digest, r.name, r.risk, JSON.stringify(r.authors), r.updatedAt, r.approvedDigest, r.approvedBy, r.approvedAt, r.publishedAt, r.publishedBy, r.supersededAt, r.id);
  }
}

export interface OverlayRecord {
  level: string;
  target: string;
  document: string;
  digest: string;
  setAt: string;
  setBy: string;
}

export class OverlayStore {
  constructor(private readonly database: GovernanceDatabase) {}

  list(): OverlayRecord[] {
    const rows = this.database.db.prepare("SELECT * FROM overlays ORDER BY level, target").all() as Row[];
    return rows.map((r) => ({ level: str(r.level), target: str(r.target), document: str(r.document), digest: str(r.digest), setAt: str(r.set_at), setBy: str(r.set_by) }));
  }

  set(o: OverlayRecord): void {
    this.database.db
      .prepare("INSERT INTO overlays (level, target, document, digest, set_at, set_by) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(level, target) DO UPDATE SET document = excluded.document, digest = excluded.digest, set_at = excluded.set_at, set_by = excluded.set_by")
      .run(o.level, o.target, o.document, o.digest, o.setAt, o.setBy);
  }

  remove(level: string, target: string): boolean {
    return Number(this.database.db.prepare("DELETE FROM overlays WHERE level = ? AND target = ?").run(level, target).changes) > 0;
  }
}

// ---- agents, governed workspaces, run bindings -------------------------------------------------------------------------

export interface AgentRecord {
  id: string;
  name: string;
  runtime: AgentRuntime;
  status: OperatorStatus;
  createdAt: string;
  createdBy: string;
}

const agentOf = (r: Row): AgentRecord => ({ id: str(r.id), name: str(r.name), runtime: str(r.runtime) as AgentRuntime, status: str(r.status) as OperatorStatus, createdAt: str(r.created_at), createdBy: str(r.created_by) });

export class AgentStore {
  constructor(private readonly database: GovernanceDatabase) {}

  list(): AgentRecord[] {
    return (this.database.db.prepare("SELECT * FROM agents ORDER BY created_at, id").all() as Row[]).map(agentOf);
  }

  get(id: string): AgentRecord | null {
    const row = this.database.db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as Row | undefined;
    return row ? agentOf(row) : null;
  }

  insert(a: AgentRecord): void {
    this.database.db.prepare("INSERT INTO agents (id, name, runtime, status, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)").run(a.id, a.name, a.runtime, a.status, a.createdAt, a.createdBy);
  }

  setStatus(id: string, status: OperatorStatus): void {
    this.database.db.prepare("UPDATE agents SET status = ? WHERE id = ?").run(status, id);
  }
}

export interface GovernedWorkspaceRecord {
  sessionId: string;
  agentId: string;
  profile: EnforcementProfile;
  governedAt: string;
  governedBy: string;
}

const governedOf = (r: Row): GovernedWorkspaceRecord => ({ sessionId: str(r.session_id), agentId: str(r.agent_id), profile: str(r.profile) as EnforcementProfile, governedAt: str(r.governed_at), governedBy: str(r.governed_by) });

export class GovernedWorkspaceStore {
  constructor(private readonly database: GovernanceDatabase) {}

  get(sessionId: string): GovernedWorkspaceRecord | null {
    const row = this.database.db.prepare("SELECT * FROM governed_workspaces WHERE session_id = ?").get(sessionId) as Row | undefined;
    return row ? governedOf(row) : null;
  }

  list(): GovernedWorkspaceRecord[] {
    return (this.database.db.prepare("SELECT * FROM governed_workspaces ORDER BY governed_at").all() as Row[]).map(governedOf);
  }

  set(w: GovernedWorkspaceRecord): void {
    this.database.db
      .prepare("INSERT INTO governed_workspaces (session_id, agent_id, profile, governed_at, governed_by) VALUES (?, ?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET agent_id = excluded.agent_id, profile = excluded.profile, governed_at = excluded.governed_at, governed_by = excluded.governed_by")
      .run(w.sessionId, w.agentId, w.profile, w.governedAt, w.governedBy);
  }

  remove(sessionId: string): boolean {
    return Number(this.database.db.prepare("DELETE FROM governed_workspaces WHERE session_id = ?").run(sessionId).changes) > 0;
  }
}

export interface RunBinding {
  runId: string;
  sessionId: string;
  agentId: string;
  organizationId: string;
  policyRevision: string;
  workBranch: string | null;
  createdAt: string;
  expiresAt: string;
  endedAt: string | null;
}

const bindingOf = (r: Row): RunBinding => ({
  runId: str(r.run_id),
  sessionId: str(r.session_id),
  agentId: str(r.agent_id),
  organizationId: str(r.organization_id),
  policyRevision: str(r.policy_revision),
  workBranch: strOrNull(r.work_branch),
  createdAt: str(r.created_at),
  expiresAt: str(r.expires_at),
  endedAt: strOrNull(r.ended_at),
});

export class RunBindingStore {
  constructor(private readonly database: GovernanceDatabase) {}

  insert(b: RunBinding & { tokenHash: string }): void {
    this.database.db
      .prepare("INSERT INTO run_bindings (run_id, token_hash, session_id, agent_id, organization_id, policy_revision, work_branch, created_at, expires_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)")
      .run(b.runId, b.tokenHash, b.sessionId, b.agentId, b.organizationId, b.policyRevision, b.workBranch, b.createdAt, b.expiresAt);
  }

  byToken(tokenHash: string): RunBinding | null {
    const row = this.database.db.prepare("SELECT * FROM run_bindings WHERE token_hash = ?").get(tokenHash) as Row | undefined;
    return row ? bindingOf(row) : null;
  }

  get(runId: string): RunBinding | null {
    const row = this.database.db.prepare("SELECT * FROM run_bindings WHERE run_id = ?").get(runId) as Row | undefined;
    return row ? bindingOf(row) : null;
  }

  end(runId: string, at: string): void {
    this.database.db.prepare("UPDATE run_bindings SET ended_at = ? WHERE run_id = ? AND ended_at IS NULL").run(at, runId);
  }

  // At a start nothing runs: every binding still open is ended.
  endAll(at: string): number {
    return Number(this.database.db.prepare("UPDATE run_bindings SET ended_at = ? WHERE ended_at IS NULL").run(at).changes);
  }
}

// ---- approvals -----------------------------------------------------------------------------------------------------

export interface ApprovalRecord {
  id: string;
  action: string;
  environment: string;
  fingerprint: string;
  params: Record<string, string | number | boolean | null>;
  summary: string;
  state: "pending" | "granted" | "rejected" | "expired" | "consumed";
  requestedAt: string;
  requestedBy: string;
  agentId: string | null;
  workspaceId: string | null;
  runId: string | null;
  decisionId: string | null;
  expiresAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  consumedAt: string | null;
  outcome: string | null;
  change: { files: number; insertions: number; deletions: number; commits: number; diffstat: string } | null;
}

const approvalOf = (r: Row): ApprovalRecord => ({
  id: str(r.id),
  action: str(r.action),
  environment: str(r.environment),
  fingerprint: str(r.fingerprint),
  params: json(r.params),
  summary: str(r.summary),
  state: str(r.state) as ApprovalRecord["state"],
  requestedAt: str(r.requested_at),
  requestedBy: str(r.requested_by),
  agentId: strOrNull(r.agent_id),
  workspaceId: strOrNull(r.workspace_id),
  runId: strOrNull(r.run_id),
  decisionId: strOrNull(r.decision_id),
  expiresAt: str(r.expires_at),
  decidedBy: strOrNull(r.decided_by),
  decidedAt: strOrNull(r.decided_at),
  consumedAt: strOrNull(r.consumed_at),
  outcome: strOrNull(r.outcome),
  change: r.change === null || r.change === undefined ? null : json(r.change),
});

export class ApprovalStore {
  constructor(private readonly database: GovernanceDatabase) {}

  get(id: string): ApprovalRecord | null {
    const row = this.database.db.prepare("SELECT * FROM approvals WHERE id = ?").get(id) as Row | undefined;
    return row ? approvalOf(row) : null;
  }

  list(limit = 200): ApprovalRecord[] {
    return (this.database.db.prepare("SELECT * FROM approvals ORDER BY requested_at DESC, id LIMIT ?").all(limit) as Row[]).map(approvalOf);
  }

  byFingerprint(fingerprint: string): ApprovalRecord[] {
    return (this.database.db.prepare("SELECT * FROM approvals WHERE fingerprint = ? ORDER BY requested_at").all(fingerprint) as Row[]).map(approvalOf);
  }

  insert(a: ApprovalRecord): void {
    this.database.db
      .prepare(
        "INSERT INTO approvals (id, action, environment, fingerprint, params, summary, state, requested_at, requested_by, agent_id, workspace_id, run_id, decision_id, expires_at, decided_by, decided_at, consumed_at, outcome, change) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(a.id, a.action, a.environment, a.fingerprint, JSON.stringify(a.params), a.summary, a.state, a.requestedAt, a.requestedBy, a.agentId, a.workspaceId, a.runId, a.decisionId, a.expiresAt, a.decidedBy, a.decidedAt, a.consumedAt, a.outcome, a.change === null ? null : JSON.stringify(a.change));
  }

  // Moves an approval from `from` to `to` only if it is still `from`: true when this call moved it. Two callers racing
  // for one approval cannot both move it.
  transition(id: string, from: ApprovalRecord["state"], to: ApprovalRecord["state"], fields: { decidedBy?: string; decidedAt?: string; consumedAt?: string }): boolean {
    const r = this.database.db
      .prepare("UPDATE approvals SET state = ?, decided_by = COALESCE(?, decided_by), decided_at = COALESCE(?, decided_at), consumed_at = COALESCE(?, consumed_at) WHERE id = ? AND state = ?")
      .run(to, fields.decidedBy ?? null, fields.decidedAt ?? null, fields.consumedAt ?? null, id, from);
    return Number(r.changes) > 0;
  }

  setOutcome(id: string, outcome: string): void {
    this.database.db.prepare("UPDATE approvals SET outcome = ? WHERE id = ?").run(outcome, id);
  }

  pendingCount(now: string): number {
    return Number((this.database.db.prepare("SELECT COUNT(*) AS n FROM approvals WHERE state = 'pending' AND expires_at > ?").get(now) as Row).n);
  }
}

// ---- findings, reports, isolation checks ----------------------------------------------------------------------------------

export interface FindingResolutionRecord {
  findingId: string;
  resolution: FindingResolution;
  note: string | null;
  resolvedBy: string;
  resolvedAt: string;
}

export class FindingStore {
  constructor(private readonly database: GovernanceDatabase) {}

  all(): Map<string, FindingResolutionRecord> {
    const rows = this.database.db.prepare("SELECT * FROM finding_resolutions").all() as Row[];
    return new Map(rows.map((r) => [str(r.finding_id), { findingId: str(r.finding_id), resolution: str(r.resolution) as FindingResolution, note: strOrNull(r.note), resolvedBy: str(r.resolved_by), resolvedAt: str(r.resolved_at) }]));
  }

  set(r: FindingResolutionRecord): void {
    this.database.db
      .prepare("INSERT INTO finding_resolutions (finding_id, resolution, note, resolved_by, resolved_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(finding_id) DO UPDATE SET resolution = excluded.resolution, note = excluded.note, resolved_by = excluded.resolved_by, resolved_at = excluded.resolved_at")
      .run(r.findingId, r.resolution, r.note, r.resolvedBy, r.resolvedAt);
  }
}

export interface ReportRecord {
  id: string;
  day: string;
  generatedAt: string;
  generatedBy: string;
  head: string | null;
  content: string;
  markdown: string;
}

const reportOf = (r: Row): ReportRecord => ({ id: str(r.id), day: str(r.day), generatedAt: str(r.generated_at), generatedBy: str(r.generated_by), head: strOrNull(r.head), content: str(r.content), markdown: str(r.markdown) });

export class ReportStore {
  constructor(private readonly database: GovernanceDatabase) {}

  list(limit = 100): ReportRecord[] {
    return (this.database.db.prepare("SELECT * FROM reports ORDER BY day DESC, generated_at DESC LIMIT ?").all(limit) as Row[]).map(reportOf);
  }

  get(id: string): ReportRecord | null {
    const row = this.database.db.prepare("SELECT * FROM reports WHERE id = ?").get(id) as Row | undefined;
    return row ? reportOf(row) : null;
  }

  ofDay(day: string): ReportRecord[] {
    return (this.database.db.prepare("SELECT * FROM reports WHERE day = ? ORDER BY generated_at DESC").all(day) as Row[]).map(reportOf);
  }

  insert(r: ReportRecord): void {
    this.database.db.prepare("INSERT INTO reports (id, day, generated_at, generated_by, head, content, markdown) VALUES (?, ?, ?, ?, ?, ?, ?)").run(r.id, r.day, r.generatedAt, r.generatedBy, r.head, r.content, r.markdown);
  }
}

export interface IsolationRecord {
  checkedAt: string;
  state: IsolationState;
  checks: IsolationCheck[];
  detail: string;
}

export class IsolationStore {
  constructor(private readonly database: GovernanceDatabase) {}

  latest(): IsolationRecord | null {
    const row = this.database.db.prepare("SELECT * FROM isolation_checks ORDER BY id DESC LIMIT 1").get() as Row | undefined;
    return row ? { checkedAt: str(row.checked_at), state: str(row.state) as IsolationState, checks: json(row.checks), detail: str(row.detail) } : null;
  }

  insert(r: IsolationRecord): void {
    this.database.db.prepare("INSERT INTO isolation_checks (checked_at, state, checks, detail) VALUES (?, ?, ?, ?)").run(r.checkedAt, r.state, JSON.stringify(r.checks), r.detail);
  }
}
