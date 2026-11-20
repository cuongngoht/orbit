// GOVERNANCE'S OWN DATABASE: /data/governance/governance.db, apart from the chats' database (/data/app/orbit-web.db).
// It holds what a person decided and what the record must keep -- the organization, its operators and their
// sessions, the Constitution's revisions, the agents and the workspaces they govern, approvals, findings, reports --
// and the AUDIT RECORD, which nothing deletes: deleting a chat removes the chat's rows in the other database and
// never a row here.
//
// Two rules are held by the database itself, so that no code path can forget them:
//   - an audit record is never updated or deleted (triggers refuse both);
//   - a published revision of the Constitution never changes, and is never removed (the only move left to it is to
//     SUPERSEDED, when its successor is published); a spent, rejected or expired approval never moves again.
//
// node:sqlite is synchronous and this is ONE connection shared by every request: a transaction must never span an
// `await`, or another request's statements would run inside it. Everything async (hashing a password, asking a
// program) happens before a transaction opens.
import { DatabaseSync } from "node:sqlite";

const MIGRATIONS: string[] = [
  `CREATE TABLE organization (
     singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
     id TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL,
     created_at TEXT NOT NULL
   );
   CREATE TABLE operators (
     id TEXT PRIMARY KEY,
     username TEXT NOT NULL UNIQUE,
     display_name TEXT NOT NULL,
     password_hash TEXT NOT NULL,
     status TEXT NOT NULL CHECK (status IN ('active', 'suspended')),
     created_at TEXT NOT NULL,
     created_by TEXT NOT NULL,
     password_changed_at TEXT NOT NULL
   );
   CREATE TABLE operator_roles (
     operator_id TEXT NOT NULL REFERENCES operators(id),
     role TEXT NOT NULL,
     granted_by TEXT NOT NULL,
     granted_at TEXT NOT NULL,
     PRIMARY KEY (operator_id, role)
   );
   CREATE TABLE operator_sessions (
     id TEXT PRIMARY KEY,
     token_hash TEXT NOT NULL UNIQUE,
     operator_id TEXT NOT NULL REFERENCES operators(id),
     created_at TEXT NOT NULL,
     last_seen_at TEXT NOT NULL,
     expires_at TEXT NOT NULL,
     revoked_at TEXT,
     revoked_reason TEXT
   );
   CREATE INDEX operator_sessions_by_operator ON operator_sessions(operator_id);
   CREATE TABLE login_failures (
     username TEXT PRIMARY KEY,
     failures INTEGER NOT NULL,
     first_at TEXT NOT NULL,
     locked_until TEXT
   );
   CREATE TABLE audit_events (
     seq INTEGER PRIMARY KEY,
     event_id TEXT NOT NULL UNIQUE,
     schema_version INTEGER NOT NULL,
     event_type TEXT NOT NULL,
     occurred_at TEXT NOT NULL,
     recorded_at TEXT NOT NULL,
     organization_id TEXT NOT NULL,
     principal_id TEXT NOT NULL,
     principal_type TEXT NOT NULL,
     agent_id TEXT,
     workspace_id TEXT,
     run_id TEXT,
     correlation_id TEXT NOT NULL,
     causation_id TEXT,
     policy_revision TEXT,
     decision_id TEXT,
     outcome TEXT NOT NULL,
     reason_codes TEXT NOT NULL,
     evidence_refs TEXT NOT NULL,
     data TEXT NOT NULL,
     previous_hash TEXT,
     hash TEXT NOT NULL
   );
   CREATE INDEX audit_by_type ON audit_events(event_type, seq);
   CREATE INDEX audit_by_workspace ON audit_events(workspace_id, seq);
   CREATE INDEX audit_by_time ON audit_events(occurred_at);
   CREATE INDEX audit_by_decision ON audit_events(decision_id);
   CREATE TRIGGER audit_never_updated BEFORE UPDATE ON audit_events
     BEGIN SELECT RAISE(ABORT, 'an audit record is never changed'); END;
   CREATE TRIGGER audit_never_deleted BEFORE DELETE ON audit_events
     BEGIN SELECT RAISE(ABORT, 'an audit record is never removed'); END;
   CREATE TABLE revisions (
     id TEXT PRIMARY KEY,
     revision INTEGER UNIQUE,
     state TEXT NOT NULL,
     document TEXT NOT NULL,
     digest TEXT NOT NULL,
     name TEXT NOT NULL,
     risk TEXT,
     source TEXT NOT NULL,
     based_on TEXT,
     authors TEXT NOT NULL,
     created_at TEXT NOT NULL,
     created_by TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     approved_digest TEXT,
     approved_by TEXT,
     approved_at TEXT,
     published_at TEXT,
     published_by TEXT,
     superseded_at TEXT
   );
   CREATE TRIGGER revision_published_never_changes BEFORE UPDATE ON revisions
     WHEN OLD.state IN ('PUBLISHED', 'SUPERSEDED') AND (
       NEW.document IS NOT OLD.document OR NEW.digest IS NOT OLD.digest OR NEW.revision IS NOT OLD.revision
       OR NEW.approved_digest IS NOT OLD.approved_digest OR NEW.approved_by IS NOT OLD.approved_by
       OR NEW.published_at IS NOT OLD.published_at OR NEW.published_by IS NOT OLD.published_by OR NEW.authors IS NOT OLD.authors
       OR NOT (NEW.state = OLD.state OR (OLD.state = 'PUBLISHED' AND NEW.state = 'SUPERSEDED')))
     BEGIN SELECT RAISE(ABORT, 'a published revision never changes'); END;
   CREATE TRIGGER revision_published_never_removed BEFORE DELETE ON revisions
     WHEN OLD.state IN ('PUBLISHED', 'SUPERSEDED')
     BEGIN SELECT RAISE(ABORT, 'a published revision is never removed'); END;
   CREATE TABLE overlays (
     level TEXT NOT NULL,
     target TEXT NOT NULL,
     document TEXT NOT NULL,
     digest TEXT NOT NULL,
     set_at TEXT NOT NULL,
     set_by TEXT NOT NULL,
     PRIMARY KEY (level, target)
   );
   CREATE TABLE agents (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     runtime TEXT NOT NULL,
     status TEXT NOT NULL CHECK (status IN ('active', 'suspended')),
     created_at TEXT NOT NULL,
     created_by TEXT NOT NULL
   );
   CREATE TABLE governed_workspaces (
     session_id TEXT PRIMARY KEY,
     agent_id TEXT NOT NULL REFERENCES agents(id),
     profile TEXT NOT NULL,
     governed_at TEXT NOT NULL,
     governed_by TEXT NOT NULL
   );
   CREATE TABLE run_bindings (
     run_id TEXT PRIMARY KEY,
     token_hash TEXT NOT NULL UNIQUE,
     session_id TEXT NOT NULL,
     agent_id TEXT NOT NULL,
     organization_id TEXT NOT NULL,
     policy_revision TEXT NOT NULL,
     work_branch TEXT,
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL,
     ended_at TEXT
   );
   CREATE TABLE approvals (
     id TEXT PRIMARY KEY,
     action TEXT NOT NULL,
     environment TEXT NOT NULL,
     fingerprint TEXT NOT NULL,
     params TEXT NOT NULL,
     summary TEXT NOT NULL,
     state TEXT NOT NULL CHECK (state IN ('pending', 'granted', 'rejected', 'expired', 'consumed')),
     requested_at TEXT NOT NULL,
     requested_by TEXT NOT NULL,
     agent_id TEXT,
     workspace_id TEXT,
     run_id TEXT,
     decision_id TEXT,
     expires_at TEXT NOT NULL,
     decided_by TEXT,
     decided_at TEXT,
     consumed_at TEXT,
     outcome TEXT,
     change TEXT
   );
   CREATE INDEX approvals_by_fingerprint ON approvals(fingerprint);
   CREATE TRIGGER approval_fingerprint_fixed BEFORE UPDATE ON approvals
     WHEN NEW.fingerprint IS NOT OLD.fingerprint OR NEW.params IS NOT OLD.params OR NEW.action IS NOT OLD.action
     BEGIN SELECT RAISE(ABORT, 'what an approval is of never changes'); END;
   CREATE TRIGGER approval_settled_stays BEFORE UPDATE ON approvals
     WHEN OLD.state IN ('consumed', 'rejected', 'expired') AND NEW.state IS NOT OLD.state
     BEGIN SELECT RAISE(ABORT, 'a spent, rejected or expired approval never moves again'); END;
   CREATE TABLE finding_resolutions (
     finding_id TEXT PRIMARY KEY,
     resolution TEXT NOT NULL,
     note TEXT,
     resolved_by TEXT NOT NULL,
     resolved_at TEXT NOT NULL
   );
   CREATE TABLE reports (
     id TEXT PRIMARY KEY,
     day TEXT NOT NULL,
     generated_at TEXT NOT NULL,
     generated_by TEXT NOT NULL,
     head TEXT,
     content TEXT NOT NULL,
     markdown TEXT NOT NULL
   );
   CREATE INDEX reports_by_day ON reports(day);
   CREATE TABLE isolation_checks (
     id INTEGER PRIMARY KEY,
     checked_at TEXT NOT NULL,
     state TEXT NOT NULL,
     checks TEXT NOT NULL,
     detail TEXT NOT NULL
   );`,
];

export class GovernanceDatabase {
  readonly db: DatabaseSync;
  private depth = 0;
  private pending: (() => void)[] = [];

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.migrate();
  }

  private migrate(): void {
    const row = this.db.prepare("PRAGMA user_version").get() as { user_version: number };
    for (let v = row.user_version; v < MIGRATIONS.length; v += 1) {
      this.transaction(() => {
        this.db.exec(MIGRATIONS[v] as string);
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
      });
    }
  }

  // One transaction, taken at once (BEGIN IMMEDIATE); a transaction inside another joins it. `work` is synchronous.
  transaction<T>(work: () => T): T {
    if (this.depth > 0) {
      this.depth += 1;
      try {
        return work();
      } finally {
        this.depth -= 1;
      }
    }
    this.db.exec("BEGIN IMMEDIATE");
    this.depth = 1;
    try {
      const result = work();
      this.db.exec("COMMIT");
      this.depth = 0;
      this.flush();
      return result;
    } catch (err) {
      this.depth = 0;
      this.pending = [];
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  // Runs once what is being written is committed (at once outside a transaction); never when it is rolled back. What a
  // notification says is therefore always already stored.
  afterCommit(work: () => void): void {
    if (this.depth === 0) work();
    else this.pending.push(work);
  }

  private flush(): void {
    const pending = this.pending;
    this.pending = [];
    for (const work of pending) {
      try {
        work();
      } catch {
        // A notification that fails changes nothing that was stored.
      }
    }
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }
}
