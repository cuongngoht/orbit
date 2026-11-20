// Orbit Web's own state: one SQLite file under /data/app, through Node's built-in node:sqlite (no native module).
// It holds settings, sessions, their messages, their durable events, their runs, their projects' inventories and their
// shared copies --
// never a credential: the CLIs keep their own sign-ins in their own directories. MIGRATIONS only ever grows: a data
// volume of an earlier Orbit Web is brought forward in order, each step in one transaction.
import { DatabaseSync } from "node:sqlite";

const MIGRATIONS: string[] = [
  `CREATE TABLE settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE sessions (
     id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     repository TEXT NOT NULL,
     branch TEXT NOT NULL,
     work_branch TEXT,
     base_commit TEXT,
     model TEXT NOT NULL,
     workspace_path TEXT NOT NULL,
     claude_session_id TEXT NOT NULL,
     turns INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL,
     status_reason TEXT,
     last_seq INTEGER NOT NULL DEFAULT 0,
     pending_prompt TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE messages (
     id TEXT PRIMARY KEY,
     session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
     run_id TEXT,
     role TEXT NOT NULL,
     text TEXT NOT NULL,
     created_at TEXT NOT NULL
   );
   CREATE INDEX messages_by_session ON messages(session_id);
   CREATE TABLE events (
     session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
     seq INTEGER NOT NULL,
     run_id TEXT,
     type TEXT NOT NULL,
     data TEXT NOT NULL,
     at TEXT NOT NULL,
     PRIMARY KEY (session_id, seq)
   );
   CREATE TABLE runs (
     id TEXT PRIMARY KEY,
     session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
     status TEXT NOT NULL,
     model TEXT NOT NULL,
     resumed INTEGER NOT NULL,
     started_at TEXT NOT NULL,
     ended_at TEXT,
     exit_code INTEGER,
     signal TEXT,
     cost_usd REAL
   );
   CREATE INDEX runs_by_session ON runs(session_id);`,
  // 0.8.0: a chat's repository has a source (GitHub or Azure DevOps) and may be none at all ('' in the two NOT NULL
  // columns -- no table is rebuilt, so no cascade ever fires); a chat prefers an effort and a mode; a project's
  // skills and plugins, read on the workspace's first fetch, are kept beside its chat.
  `ALTER TABLE sessions ADD COLUMN source TEXT;
   ALTER TABLE sessions ADD COLUMN repository_id TEXT;
   ALTER TABLE sessions ADD COLUMN effort TEXT NOT NULL DEFAULT 'medium';
   ALTER TABLE sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'autonomous';
   UPDATE sessions SET source = 'github', repository_id = repository WHERE repository <> '';
   ALTER TABLE runs ADD COLUMN effort TEXT;
   ALTER TABLE runs ADD COLUMN mode TEXT;
   CREATE TABLE project_inventories (
     session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
     data TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );`,
  // 0.8.0: a chat's shared copy -- the snapshot its link shows -- kept beside it, and gone with it.
  `CREATE TABLE shares (
     session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
     token TEXT NOT NULL UNIQUE,
     include_tools INTEGER NOT NULL,
     data TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );`,
];

export class Database {
  readonly db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
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

  transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }
}
