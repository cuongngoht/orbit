// Typed access to governance's tables (schema `governance`). Each store owns its SQL; nothing else writes these
// tables. EVERY read and write names the account it is about: nothing here answers across accounts, so a caller that
// forgets the account cannot be given another account's record. Secrets are never stored: a run's token is kept as its
// SHA-256.
import { createHash } from "node:crypto";
import { AUDIT_SCHEMA_VERSION, seal, type AuditBody, type AuditEvent, type AuditEventType, type AuditPrincipalType, type AuditValue, type RevisionState, type RiskLevel } from "@orbit-web/governance-core";
import type { FindingResolution, IsolationCheck, IsolationState, RevisionSource } from "@orbit-web/contracts";
import { Db, jsonParam, type Row } from "../db/db.js";

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

const str = (v: unknown): string => String(v);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

// The chain a record is sealed onto: an account's own, or the deployment's (what concerns no account).
export const DEPLOYMENT_CHAIN = "deployment";
export const chainOf = (accountId: string | null): string => (accountId === null ? DEPLOYMENT_CHAIN : `account:${accountId}`);

// ---- what an account's governance points at ---------------------------------------------------------------------------

// `employee`: an AI employee of the office (its desk is what its runs work on; its runs are bound to it).
export type ResourceKind = "workspace" | "research_workspace" | "employee";

// What an override (a narrowing of the account's policy) can be about: a chat or a research workspace.
export type OverridableKind = "workspace" | "research_workspace";

export interface ResourceRecord {
  accountId: string;
  kind: ResourceKind;
  id: string;
  title: string;
  createdAt: string;
  deletedAt: string | null;
}

const resourceOf = (r: Row): ResourceRecord => ({ accountId: str(r.account_id), kind: str(r.kind) as ResourceKind, id: str(r.id), title: str(r.title), createdAt: str(r.created_at), deletedAt: strOrNull(r.deleted_at) });

export class ResourceStore {
  constructor(private readonly db: Db) {}

  // Registers a chat or a research workspace as its account's (in the transaction that creates it).
  async register(r: Omit<ResourceRecord, "deletedAt">): Promise<void> {
    await this.db.query("INSERT INTO account_resources (account_id, kind, id, title, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (account_id, kind, id) DO UPDATE SET title = excluded.title, deleted_at = NULL", [
      r.accountId,
      r.kind,
      r.id,
      r.title.slice(0, 200),
      r.createdAt,
    ]);
  }

  async retitle(accountId: string, kind: ResourceKind, id: string, title: string): Promise<void> {
    await this.db.query("UPDATE account_resources SET title = $4 WHERE account_id = $1 AND kind = $2 AND id = $3", [accountId, kind, id, title.slice(0, 200)]);
  }

  // The record it names is gone; what concerned it stays.
  async deleted(accountId: string, kind: ResourceKind, id: string, at: string): Promise<void> {
    await this.db.query("UPDATE account_resources SET deleted_at = $4 WHERE account_id = $1 AND kind = $2 AND id = $3 AND deleted_at IS NULL", [accountId, kind, id, at]);
  }

  async get(accountId: string, kind: ResourceKind, id: string): Promise<ResourceRecord | null> {
    const row = await this.db.one("SELECT * FROM account_resources WHERE account_id = $1 AND kind = $2 AND id = $3", [accountId, kind, id]);
    return row === null ? null : resourceOf(row);
  }

  async list(accountId: string, kind: ResourceKind): Promise<ResourceRecord[]> {
    return (await this.db.query("SELECT * FROM account_resources WHERE account_id = $1 AND kind = $2 ORDER BY created_at DESC, id", [accountId, kind])).map(resourceOf);
  }
}

// ---- the audit record ------------------------------------------------------------------------------------------------

export type AuditDraft = Omit<AuditBody, "schemaVersion" | "recordedAt">;

const AUDIT_COLUMNS =
  "seq, event_id, schema_version, event_type, occurred_at, recorded_at, account_id, principal_id, principal_type, agent_id, workspace_id, run_id, correlation_id, causation_id, policy_revision, decision_id, outcome, reason_codes, evidence_refs, data, previous_hash, hash";

function eventOf(row: Row): AuditEvent {
  return {
    seq: Number(row.seq),
    eventId: str(row.event_id),
    schemaVersion: Number(row.schema_version),
    eventType: str(row.event_type) as AuditEventType,
    occurredAt: str(row.occurred_at),
    recordedAt: str(row.recorded_at),
    accountId: strOrNull(row.account_id),
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
    reasonCodes: row.reason_codes as string[],
    evidenceRefs: row.evidence_refs as string[],
    data: row.data as Record<string, AuditValue>,
    previousHash: strOrNull(row.previous_hash),
    hash: str(row.hash),
  };
}

export interface AuditPageQuery {
  before?: number;
  limit: number;
  types?: readonly string[];
  workspaceId?: string;
  outcome?: string;
}

export class AuditStore {
  constructor(private readonly db: Db) {}

  // An account's chain is opened with the account (and the deployment's with the schema).
  async openChain(accountId: string): Promise<void> {
    await this.db.query("INSERT INTO audit_chains (id, account_id, head_seq, head_hash) VALUES ($1, $2, 0, NULL) ON CONFLICT (id) DO NOTHING", [chainOf(accountId), accountId]);
  }

  async head(accountId: string | null): Promise<{ seq: number; hash: string } | null> {
    const row = await this.db.one("SELECT head_seq, head_hash FROM audit_chains WHERE id = $1", [chainOf(accountId)]);
    return row === null || Number(row.head_seq) === 0 ? null : { seq: Number(row.head_seq), hash: str(row.head_hash) };
  }

  // Seals the record onto its account's chain and stores it, in one transaction (the caller's, when there is one). The
  // chain's head row is LOCKED first: records of one chain are numbered and linked one after another, however many
  // write at once. The same eventId twice is the record already there (a retried write adds nothing).
  async append(draft: AuditDraft): Promise<AuditEvent> {
    return this.db.tx(async () => {
      const chain = chainOf(draft.accountId);
      const head = await this.db.one("SELECT head_seq, head_hash FROM audit_chains WHERE id = $1 FOR UPDATE", [chain]);
      if (head === null) throw new Error(`no audit chain ${chain}`);
      const existing = await this.get(draft.accountId, draft.eventId);
      if (existing !== null) return existing;
      const seq = Number(head.head_seq) + 1;
      const event = seal({ ...draft, schemaVersion: AUDIT_SCHEMA_VERSION, recordedAt: new Date().toISOString() }, seq, strOrNull(head.head_hash), sha256);
      await this.db.query(
        `INSERT INTO audit_events (chain_id, ${AUDIT_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20::jsonb, $21::jsonb, $22, $23)`,
        [
          chain,
          event.seq,
          event.eventId,
          event.schemaVersion,
          event.eventType,
          event.occurredAt,
          event.recordedAt,
          event.accountId,
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
          jsonParam(event.reasonCodes),
          jsonParam(event.evidenceRefs),
          jsonParam(event.data),
          event.previousHash,
          event.hash,
        ],
      );
      await this.db.query("UPDATE audit_chains SET head_seq = $2, head_hash = $3 WHERE id = $1", [chain, event.seq, event.hash]);
      return event;
    });
  }

  async get(accountId: string | null, eventId: string): Promise<AuditEvent | null> {
    const row = await this.db.one(`SELECT ${AUDIT_COLUMNS} FROM audit_events WHERE chain_id = $1 AND event_id = $2`, [chainOf(accountId), eventId]);
    return row === null ? null : eventOf(row);
  }

  async count(accountId: string | null): Promise<number> {
    return Number((await this.db.one("SELECT head_seq FROM audit_chains WHERE id = $1", [chainOf(accountId)]))?.head_seq ?? 0);
  }

  // Newest first, below `before` (a seq), at most `limit`, of the given types / workspace / outcome when named.
  async page(accountId: string | null, q: AuditPageQuery): Promise<AuditEvent[]> {
    const where = ["chain_id = $1"];
    const args: (string | number | readonly string[])[] = [chainOf(accountId)];
    const add = (sql: string, v: string | number | readonly string[]) => {
      args.push(v);
      where.push(sql.replace("?", `$${args.length}`));
    };
    if (q.before !== undefined) add("seq < ?", q.before);
    if (q.types !== undefined && q.types.length > 0) add("event_type = ANY(?::text[])", q.types);
    if (q.workspaceId !== undefined) add("workspace_id = ?", q.workspaceId);
    if (q.outcome !== undefined) add("outcome = ?", q.outcome);
    args.push(q.limit);
    return (await this.db.query(`SELECT ${AUDIT_COLUMNS} FROM audit_events WHERE ${where.join(" AND ")} ORDER BY seq DESC LIMIT $${args.length}`, args)).map(eventOf);
  }

  // Every record of a chain, in the order it was recorded: what a check of the chain reads.
  async all(accountId: string | null): Promise<AuditEvent[]> {
    return (await this.db.query(`SELECT ${AUDIT_COLUMNS} FROM audit_events WHERE chain_id = $1 ORDER BY seq`, [chainOf(accountId)])).map(eventOf);
  }

  // The records of a chain that occurred in [from, to), in order.
  async between(accountId: string | null, from: string, to: string): Promise<AuditEvent[]> {
    return (await this.db.query(`SELECT ${AUDIT_COLUMNS} FROM audit_events WHERE chain_id = $1 AND occurred_at >= $2 AND occurred_at < $3 ORDER BY seq`, [chainOf(accountId), from, to])).map(eventOf);
  }

  // Every chain there is: the deployment's (null) and one per account.
  async chains(): Promise<(string | null)[]> {
    return (await this.db.query("SELECT account_id FROM audit_chains ORDER BY id")).map((r) => strOrNull(r.account_id));
  }

  // The accounts whose chain holds a record that occurred in [from, to).
  async accountsActive(from: string, to: string): Promise<string[]> {
    return (await this.db.query("SELECT DISTINCT account_id FROM audit_events WHERE account_id IS NOT NULL AND occurred_at >= $1 AND occurred_at < $2", [from, to])).map((r) => str(r.account_id));
  }
}

// ---- the account's policy: revisions and overrides ---------------------------------------------------------------

export interface RevisionRecord {
  id: string;
  accountId: string;
  revision: number | null;
  state: RevisionState;
  // The document as it was written (canonical JSON text: its digest is over exactly this).
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
  // The owner's confirmation of exactly this content, against exactly that base, at that risk.
  confirmedDigest: string | null;
  confirmedBase: string | null;
  confirmedRisk: RiskLevel | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
  supersededAt: string | null;
}

function revisionOf(row: Row): RevisionRecord {
  return {
    id: str(row.id),
    accountId: str(row.account_id),
    revision: row.revision === null || row.revision === undefined ? null : Number(row.revision),
    state: str(row.state) as RevisionState,
    document: str(row.document),
    digest: str(row.digest),
    name: str(row.name),
    risk: strOrNull(row.risk) as RiskLevel | null,
    source: str(row.source) as RevisionSource,
    basedOn: strOrNull(row.based_on),
    authors: row.authors as string[],
    createdAt: str(row.created_at),
    createdBy: str(row.created_by),
    updatedAt: str(row.updated_at),
    confirmedDigest: strOrNull(row.confirmed_digest),
    confirmedBase: strOrNull(row.confirmed_base),
    confirmedRisk: strOrNull(row.confirmed_risk) as RiskLevel | null,
    confirmedBy: strOrNull(row.confirmed_by),
    confirmedAt: strOrNull(row.confirmed_at),
    publishedAt: strOrNull(row.published_at),
    publishedBy: strOrNull(row.published_by),
    supersededAt: strOrNull(row.superseded_at),
  };
}

export class RevisionStore {
  constructor(private readonly db: Db) {}

  async get(accountId: string, id: string): Promise<RevisionRecord | null> {
    const row = await this.db.one("SELECT * FROM policy_revisions WHERE account_id = $1 AND id = $2", [accountId, id]);
    return row === null ? null : revisionOf(row);
  }

  async list(accountId: string): Promise<RevisionRecord[]> {
    return (await this.db.query("SELECT * FROM policy_revisions WHERE account_id = $1 ORDER BY created_at DESC, id", [accountId])).map(revisionOf);
  }

  async effective(accountId: string): Promise<RevisionRecord | null> {
    const row = await this.db.one("SELECT * FROM policy_revisions WHERE account_id = $1 AND state = 'PUBLISHED'", [accountId]);
    return row === null ? null : revisionOf(row);
  }

  // The account's policy head, locked until the transaction ends: publications of one account take turns.
  async lockHead(accountId: string): Promise<number> {
    await this.db.query("INSERT INTO policy_heads (account_id, last_revision) VALUES ($1, 0) ON CONFLICT (account_id) DO NOTHING", [accountId]);
    return Number((await this.db.one("SELECT last_revision FROM policy_heads WHERE account_id = $1 FOR UPDATE", [accountId]))?.last_revision ?? 0);
  }

  // The next revision number of the account (call with the head locked).
  async nextNumber(accountId: string): Promise<number> {
    const row = await this.db.one("UPDATE policy_heads SET last_revision = last_revision + 1 WHERE account_id = $1 RETURNING last_revision", [accountId]);
    if (row === null) throw new Error(`no policy head for ${accountId}`);
    return Number(row.last_revision);
  }

  async insert(r: RevisionRecord): Promise<void> {
    await this.db.query(
      "INSERT INTO policy_revisions (id, account_id, revision, state, document, digest, name, risk, source, based_on, authors, created_at, created_by, updated_at, confirmed_digest, confirmed_base, confirmed_risk, confirmed_by, confirmed_at, published_at, published_by, superseded_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)",
      [r.id, r.accountId, r.revision, r.state, r.document, r.digest, r.name, r.risk, r.source, r.basedOn, jsonParam(r.authors), r.createdAt, r.createdBy, r.updatedAt, r.confirmedDigest, r.confirmedBase, r.confirmedRisk, r.confirmedBy, r.confirmedAt, r.publishedAt, r.publishedBy, r.supersededAt],
    );
  }

  // Writes every field of `r` back (the triggers refuse what may never change), only while it is still in `fromState`
  // with `fromDigest`: two writers racing on one revision cannot both move it. True when this call wrote it.
  async save(r: RevisionRecord, from: { state: RevisionState; digest: string }): Promise<boolean> {
    const n = await this.db.run(
      "UPDATE policy_revisions SET revision = $3, state = $4, document = $5, digest = $6, name = $7, risk = $8, authors = $9::jsonb, updated_at = $10, confirmed_digest = $11, confirmed_base = $12, confirmed_risk = $13, confirmed_by = $14, confirmed_at = $15, published_at = $16, published_by = $17, superseded_at = $18 WHERE account_id = $1 AND id = $2 AND state = $19 AND digest = $20",
      [r.accountId, r.id, r.revision, r.state, r.document, r.digest, r.name, r.risk, jsonParam(r.authors), r.updatedAt, r.confirmedDigest, r.confirmedBase, r.confirmedRisk, r.confirmedBy, r.confirmedAt, r.publishedAt, r.publishedBy, r.supersededAt, from.state, from.digest],
    );
    return n > 0;
  }
}

export interface OverrideRecord {
  accountId: string;
  kind: OverridableKind;
  resourceId: string;
  document: string;
  digest: string;
  setAt: string;
  setBy: string;
}

const overrideOf = (r: Row): OverrideRecord => ({ accountId: str(r.account_id), kind: str(r.kind) as OverridableKind, resourceId: str(r.resource_id), document: str(r.document), digest: str(r.digest), setAt: str(r.set_at), setBy: str(r.set_by) });

export class OverrideStore {
  constructor(private readonly db: Db) {}

  async list(accountId: string): Promise<OverrideRecord[]> {
    return (await this.db.query("SELECT * FROM policy_overrides WHERE account_id = $1 ORDER BY kind, resource_id", [accountId])).map(overrideOf);
  }

  async get(accountId: string, kind: OverridableKind, resourceId: string): Promise<OverrideRecord | null> {
    const row = await this.db.one("SELECT * FROM policy_overrides WHERE account_id = $1 AND kind = $2 AND resource_id = $3", [accountId, kind, resourceId]);
    return row === null ? null : overrideOf(row);
  }

  async set(o: OverrideRecord): Promise<void> {
    await this.db.query(
      "INSERT INTO policy_overrides (account_id, kind, resource_id, document, digest, set_at, set_by) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (account_id, kind, resource_id) DO UPDATE SET document = excluded.document, digest = excluded.digest, set_at = excluded.set_at, set_by = excluded.set_by",
      [o.accountId, o.kind, o.resourceId, o.document, o.digest, o.setAt, o.setBy],
    );
  }

  async remove(accountId: string, kind: OverridableKind, resourceId: string): Promise<boolean> {
    return (await this.db.run("DELETE FROM policy_overrides WHERE account_id = $1 AND kind = $2 AND resource_id = $3", [accountId, kind, resourceId])) > 0;
  }
}

// ---- run bindings -------------------------------------------------------------------------------------------------------

export interface RunBinding {
  runId: string;
  accountId: string;
  kind: "chat" | "research" | "assignment";
  // What it works in: a chat (`workspace`), or a research workspace with the research session it answers.
  resourceKind: ResourceKind;
  resourceId: string;
  researchSessionId: string | null;
  // The agent profile it runs as: `claude-code` for a chat, `claude-research` for research.
  agentId: string;
  policyRevision: string;
  // Who started it (an owner's label): what its records name as their cause.
  startedBy: string;
  workBranch: string | null;
  createdAt: string;
  expiresAt: string;
  endedAt: string | null;
}

const bindingOf = (r: Row): RunBinding => ({
  runId: str(r.run_id),
  accountId: str(r.account_id),
  kind: str(r.kind) as RunBinding["kind"],
  resourceKind: str(r.resource_kind) as ResourceKind,
  resourceId: str(r.resource_id),
  researchSessionId: strOrNull(r.research_session_id),
  agentId: str(r.agent_id),
  policyRevision: str(r.policy_revision),
  startedBy: str(r.started_by),
  workBranch: strOrNull(r.work_branch),
  createdAt: str(r.created_at),
  expiresAt: str(r.expires_at),
  endedAt: strOrNull(r.ended_at),
});

export class RunBindingStore {
  constructor(private readonly db: Db) {}

  async insert(b: RunBinding & { tokenHash: string }): Promise<void> {
    await this.db.query(
      "INSERT INTO run_bindings (run_id, token_hash, account_id, kind, resource_kind, resource_id, research_session_id, agent_id, policy_revision, started_by, work_branch, created_at, expires_at, ended_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NULL)",
      [b.runId, b.tokenHash, b.accountId, b.kind, b.resourceKind, b.resourceId, b.researchSessionId, b.agentId, b.policyRevision, b.startedBy, b.workBranch, b.createdAt, b.expiresAt],
    );
  }

  // A token's binding, whoever's it is: the token itself is the proof (only its own run holds it).
  async byToken(tokenHash: string): Promise<RunBinding | null> {
    const row = await this.db.one("SELECT * FROM run_bindings WHERE token_hash = $1", [tokenHash]);
    return row === null ? null : bindingOf(row);
  }

  async get(accountId: string, runId: string): Promise<RunBinding | null> {
    const row = await this.db.one("SELECT * FROM run_bindings WHERE account_id = $1 AND run_id = $2", [accountId, runId]);
    return row === null ? null : bindingOf(row);
  }

  async running(accountId: string): Promise<RunBinding[]> {
    return (await this.db.query("SELECT * FROM run_bindings WHERE account_id = $1 AND ended_at IS NULL AND expires_at > $2 ORDER BY created_at DESC", [accountId, new Date().toISOString()])).map(bindingOf);
  }

  async end(runId: string, at: string): Promise<void> {
    await this.db.query("UPDATE run_bindings SET ended_at = $2 WHERE run_id = $1 AND ended_at IS NULL", [runId, at]);
  }

  // At a start nothing runs: every binding still open is ended.
  async endAll(at: string): Promise<number> {
    return this.db.run("UPDATE run_bindings SET ended_at = $1 WHERE ended_at IS NULL", [at]);
  }
}

// ---- approvals -----------------------------------------------------------------------------------------------------

export interface ApprovalRecord {
  id: string;
  accountId: string;
  action: string;
  environment: string;
  fingerprint: string;
  params: Record<string, string | number | boolean | null>;
  summary: string;
  state: "pending" | "granted" | "rejected" | "expired" | "consumed";
  requestedAt: string;
  requestedBy: string;
  requestedByType: AuditPrincipalType;
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
  accountId: str(r.account_id),
  action: str(r.action),
  environment: str(r.environment),
  fingerprint: str(r.fingerprint),
  params: r.params as ApprovalRecord["params"],
  summary: str(r.summary),
  state: str(r.state) as ApprovalRecord["state"],
  requestedAt: str(r.requested_at),
  requestedBy: str(r.requested_by),
  requestedByType: str(r.requested_by_type) as AuditPrincipalType,
  agentId: strOrNull(r.agent_id),
  workspaceId: strOrNull(r.workspace_id),
  runId: strOrNull(r.run_id),
  decisionId: strOrNull(r.decision_id),
  expiresAt: str(r.expires_at),
  decidedBy: strOrNull(r.decided_by),
  decidedAt: strOrNull(r.decided_at),
  consumedAt: strOrNull(r.consumed_at),
  outcome: strOrNull(r.outcome),
  change: (r.change ?? null) as ApprovalRecord["change"],
});

export class ApprovalStore {
  constructor(private readonly db: Db) {}

  async get(accountId: string, id: string): Promise<ApprovalRecord | null> {
    const row = await this.db.one("SELECT * FROM approvals WHERE account_id = $1 AND id = $2", [accountId, id]);
    return row === null ? null : approvalOf(row);
  }

  async list(accountId: string, o: { limit?: number; workspaceId?: string; action?: string } = {}): Promise<ApprovalRecord[]> {
    const where = ["account_id = $1"];
    const args: (string | number)[] = [accountId];
    if (o.workspaceId !== undefined) {
      args.push(o.workspaceId);
      where.push(`workspace_id = $${args.length}`);
    }
    if (o.action !== undefined) {
      args.push(o.action);
      where.push(`action = $${args.length}`);
    }
    args.push(o.limit ?? 200);
    return (await this.db.query(`SELECT * FROM approvals WHERE ${where.join(" AND ")} ORDER BY requested_at DESC, id LIMIT $${args.length}`, args)).map(approvalOf);
  }

  // The approvals of one action of an account, oldest first; the rows are locked until the transaction ends, so two
  // asks of one action cannot both find none.
  async byFingerprint(accountId: string, fingerprint: string): Promise<ApprovalRecord[]> {
    await this.db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`approval:${accountId}:${fingerprint}`]);
    return (await this.db.query("SELECT * FROM approvals WHERE account_id = $1 AND fingerprint = $2 ORDER BY requested_at", [accountId, fingerprint])).map(approvalOf);
  }

  async insert(a: ApprovalRecord): Promise<void> {
    await this.db.query(
      "INSERT INTO approvals (id, account_id, action, environment, fingerprint, params, summary, state, requested_at, requested_by, requested_by_type, agent_id, workspace_id, run_id, decision_id, expires_at, decided_by, decided_at, consumed_at, outcome, change) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21::jsonb)",
      [a.id, a.accountId, a.action, a.environment, a.fingerprint, jsonParam(a.params), a.summary, a.state, a.requestedAt, a.requestedBy, a.requestedByType, a.agentId, a.workspaceId, a.runId, a.decisionId, a.expiresAt, a.decidedBy, a.decidedAt, a.consumedAt, a.outcome, a.change === null ? null : jsonParam(a.change)],
    );
  }

  // Moves an approval from `from` to `to` only if it is still `from`: true when this call moved it. Two callers racing
  // for one approval cannot both move it. A decision is a person's (`decidedByType` is held to "human" by the database).
  async transition(accountId: string, id: string, from: ApprovalRecord["state"], to: ApprovalRecord["state"], fields: { decidedBy?: string; decidedByType?: "human"; decidedAt?: string; consumedAt?: string }): Promise<boolean> {
    const n = await this.db.run(
      "UPDATE approvals SET state = $3, decided_by = COALESCE($4, decided_by), decided_by_type = COALESCE($5, decided_by_type), decided_at = COALESCE($6, decided_at), consumed_at = COALESCE($7, consumed_at) WHERE account_id = $1 AND id = $2 AND state = $8",
      [accountId, id, to, fields.decidedBy ?? null, fields.decidedByType ?? null, fields.decidedAt ?? null, fields.consumedAt ?? null, from],
    );
    return n > 0;
  }

  async setOutcome(accountId: string, id: string, outcome: string): Promise<void> {
    await this.db.query("UPDATE approvals SET outcome = $3 WHERE account_id = $1 AND id = $2", [accountId, id, outcome]);
  }

  async pendingCount(accountId: string, now: string): Promise<number> {
    return Number((await this.db.one("SELECT count(*) AS n FROM approvals WHERE account_id = $1 AND state = 'pending' AND expires_at > $2", [accountId, now]))?.n ?? 0);
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
  constructor(private readonly db: Db) {}

  async all(accountId: string): Promise<Map<string, FindingResolutionRecord>> {
    const rows = await this.db.query("SELECT * FROM finding_resolutions WHERE account_id = $1", [accountId]);
    return new Map(rows.map((r) => [str(r.finding_id), { findingId: str(r.finding_id), resolution: str(r.resolution) as FindingResolution, note: strOrNull(r.note), resolvedBy: str(r.resolved_by), resolvedAt: str(r.resolved_at) }]));
  }

  async set(accountId: string, r: FindingResolutionRecord): Promise<void> {
    await this.db.query(
      "INSERT INTO finding_resolutions (account_id, finding_id, resolution, note, resolved_by, resolved_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (account_id, finding_id) DO UPDATE SET resolution = excluded.resolution, note = excluded.note, resolved_by = excluded.resolved_by, resolved_at = excluded.resolved_at",
      [accountId, r.findingId, r.resolution, r.note, r.resolvedBy, r.resolvedAt],
    );
  }
}

export interface ReportRecord {
  id: string;
  accountId: string;
  day: string;
  generatedAt: string;
  generatedBy: string;
  head: string | null;
  content: string;
  markdown: string;
}

const reportOf = (r: Row): ReportRecord => ({ id: str(r.id), accountId: str(r.account_id), day: str(r.day), generatedAt: str(r.generated_at), generatedBy: str(r.generated_by), head: strOrNull(r.head), content: str(r.content), markdown: str(r.markdown) });

export class ReportStore {
  constructor(private readonly db: Db) {}

  async list(accountId: string, limit = 100): Promise<ReportRecord[]> {
    return (await this.db.query("SELECT * FROM reports WHERE account_id = $1 ORDER BY day DESC, generated_at DESC LIMIT $2", [accountId, limit])).map(reportOf);
  }

  async get(accountId: string, id: string): Promise<ReportRecord | null> {
    const row = await this.db.one("SELECT * FROM reports WHERE account_id = $1 AND id = $2", [accountId, id]);
    return row === null ? null : reportOf(row);
  }

  async ofDay(accountId: string, day: string): Promise<ReportRecord[]> {
    return (await this.db.query("SELECT * FROM reports WHERE account_id = $1 AND day = $2 ORDER BY generated_at DESC", [accountId, day])).map(reportOf);
  }

  async insert(r: ReportRecord): Promise<void> {
    await this.db.query("INSERT INTO reports (id, account_id, day, generated_at, generated_by, head, content, markdown) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", [r.id, r.accountId, r.day, r.generatedAt, r.generatedBy, r.head, r.content, r.markdown]);
  }
}

export interface IsolationRecord {
  checkedAt: string;
  state: IsolationState;
  checks: IsolationCheck[];
  detail: string;
}

// Isolation is the DEPLOYMENT's fact (how the agent's container is placed), not any account's.
export class IsolationStore {
  constructor(private readonly db: Db) {}

  async latest(): Promise<IsolationRecord | null> {
    const row = await this.db.one("SELECT * FROM isolation_checks ORDER BY id DESC LIMIT 1");
    return row === null ? null : { checkedAt: str(row.checked_at), state: str(row.state) as IsolationState, checks: row.checks as IsolationCheck[], detail: str(row.detail) };
  }

  async insert(r: IsolationRecord): Promise<void> {
    await this.db.query("INSERT INTO isolation_checks (checked_at, state, checks, detail) VALUES ($1, $2, $3::jsonb, $4)", [r.checkedAt, r.state, jsonParam(r.checks), r.detail]);
  }
}
