// Orbit Web's own state: one SQLite file under /data/app, through Node's built-in node:sqlite (no native module).
// It holds settings, sessions, their messages, their durable events, their runs, their projects' inventories and their
// shared copies, who owns each and who it is shared with, and research (its workspaces, the text and full-text index of
// their sources -- the files themselves are in /data/research --, sessions, runs, citations, notes and findings) --
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
  // 0.8.0: a chat is the Claude account's that started it (its email in its organization), and its owner may share it
  // with other accounts by email. A chat from before has no owner until the first account signed in claims it.
  `ALTER TABLE sessions ADD COLUMN owner_email TEXT;
   ALTER TABLE sessions ADD COLUMN owner_org TEXT;
   CREATE INDEX sessions_by_owner ON sessions(owner_email, owner_org);
   CREATE TABLE session_access (
     session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
     email TEXT NOT NULL,
     granted_by TEXT NOT NULL,
     granted_at TEXT NOT NULL,
     PRIMARY KEY (session_id, email)
   );
   CREATE INDEX session_access_by_email ON session_access(email);`,
  // 0.8.0: RESEARCH, in tables of its own -- a research session is not a chat, and nothing here refers to one. A
  // workspace owns its sources (each a series of immutable revisions, their text cut into chunks the full-text index
  // reads), its sessions, notes and findings; a run keeps the revisions its evidence was frozen to and the passages it was
  // given, and a citation keeps a copy of the passage it verified, so it reads the same after its source is gone.
  `CREATE TABLE research_workspaces (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     description TEXT NOT NULL DEFAULT '',
     owner_email TEXT NOT NULL,
     owner_org TEXT NOT NULL,
     next_finding INTEGER NOT NULL DEFAULT 1,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE INDEX research_workspaces_by_owner ON research_workspaces(owner_email, owner_org);
   CREATE TABLE research_workspace_access (
     workspace_id TEXT NOT NULL REFERENCES research_workspaces(id) ON DELETE CASCADE,
     email TEXT NOT NULL,
     granted_by TEXT NOT NULL,
     granted_at TEXT NOT NULL,
     PRIMARY KEY (workspace_id, email)
   );
   CREATE INDEX research_workspace_access_by_email ON research_workspace_access(email);
   CREATE TABLE research_sources (
     id TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL REFERENCES research_workspaces(id) ON DELETE CASCADE,
     kind TEXT NOT NULL,
     title TEXT NOT NULL,
     origin TEXT,
     state TEXT NOT NULL,
     state_reason TEXT,
     current_revision_id TEXT,
     created_by TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE INDEX research_sources_by_workspace ON research_sources(workspace_id, created_at);
   CREATE TABLE research_source_revisions (
     id TEXT PRIMARY KEY,
     source_id TEXT NOT NULL REFERENCES research_sources(id) ON DELETE CASCADE,
     workspace_id TEXT NOT NULL,
     number INTEGER NOT NULL,
     content_hash TEXT NOT NULL,
     byte_size INTEGER NOT NULL,
     media_type TEXT NOT NULL,
     file_name TEXT,
     url TEXT,
     final_url TEXT,
     fetched_at TEXT,
     status TEXT NOT NULL,
     error TEXT,
     page_count INTEGER,
     char_count INTEGER NOT NULL DEFAULT 0,
     chunk_count INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL,
     indexed_at TEXT,
     UNIQUE (source_id, number)
   );
   CREATE INDEX research_revisions_by_hash ON research_source_revisions(workspace_id, content_hash);
   CREATE TABLE research_chunks (
     id INTEGER PRIMARY KEY,
     revision_id TEXT NOT NULL REFERENCES research_source_revisions(id) ON DELETE CASCADE,
     source_id TEXT NOT NULL,
     workspace_id TEXT NOT NULL,
     ordinal INTEGER NOT NULL,
     page INTEGER,
     section TEXT,
     char_start INTEGER NOT NULL,
     char_end INTEGER NOT NULL,
     text TEXT NOT NULL,
     UNIQUE (revision_id, ordinal)
   );
   CREATE VIRTUAL TABLE research_chunks_fts USING fts5(text, section, content='research_chunks', content_rowid='id', tokenize='porter unicode61 remove_diacritics 2');
   CREATE TRIGGER research_chunks_indexed AFTER INSERT ON research_chunks BEGIN
     INSERT INTO research_chunks_fts(rowid, text, section) VALUES (new.id, new.text, new.section);
   END;
   CREATE TRIGGER research_chunks_unindexed AFTER DELETE ON research_chunks BEGIN
     INSERT INTO research_chunks_fts(research_chunks_fts, rowid, text, section) VALUES ('delete', old.id, old.text, old.section);
   END;
   CREATE TABLE research_sessions (
     id TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL REFERENCES research_workspaces(id) ON DELETE CASCADE,
     title TEXT NOT NULL,
     model TEXT NOT NULL,
     effort TEXT NOT NULL,
     status TEXT NOT NULL,
     status_reason TEXT,
     last_seq INTEGER NOT NULL DEFAULT 0,
     draft_question TEXT,
     created_by TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE INDEX research_sessions_by_workspace ON research_sessions(workspace_id);
   CREATE TABLE research_session_sources (
     session_id TEXT NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,
     source_id TEXT NOT NULL REFERENCES research_sources(id) ON DELETE CASCADE,
     PRIMARY KEY (session_id, source_id)
   );
   CREATE TABLE research_messages (
     id TEXT PRIMARY KEY,
     session_id TEXT NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,
     run_id TEXT,
     role TEXT NOT NULL,
     text TEXT NOT NULL,
     partial INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL
   );
   CREATE INDEX research_messages_by_session ON research_messages(session_id);
   CREATE TABLE research_runs (
     id TEXT PRIMARY KEY,
     session_id TEXT NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,
     workspace_id TEXT NOT NULL,
     status TEXT NOT NULL,
     model TEXT NOT NULL,
     effort TEXT NOT NULL,
     question_id TEXT,
     answer_id TEXT,
     passages INTEGER NOT NULL DEFAULT 0,
     started_at TEXT NOT NULL,
     ended_at TEXT,
     exit_code INTEGER,
     signal TEXT,
     cost_usd REAL,
     input_tokens INTEGER,
     output_tokens INTEGER,
     error TEXT
   );
   CREATE INDEX research_runs_by_session ON research_runs(session_id, started_at);
   CREATE TABLE research_run_revisions (
     run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
     source_id TEXT NOT NULL,
     revision_id TEXT NOT NULL,
     title TEXT NOT NULL,
     PRIMARY KEY (run_id, revision_id)
   );
   CREATE TABLE research_run_passages (
     run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
     label TEXT NOT NULL,
     chunk_id INTEGER NOT NULL,
     source_id TEXT NOT NULL,
     revision_id TEXT NOT NULL,
     rank INTEGER NOT NULL,
     score REAL,
     match TEXT NOT NULL,
     PRIMARY KEY (run_id, label)
   );
   CREATE TABLE research_citations (
     id TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL REFERENCES research_workspaces(id) ON DELETE CASCADE,
     session_id TEXT REFERENCES research_sessions(id) ON DELETE SET NULL,
     run_id TEXT,
     message_id TEXT,
     label TEXT NOT NULL,
     source_id TEXT NOT NULL,
     revision_id TEXT NOT NULL,
     revision_number INTEGER,
     chunk_ordinal INTEGER NOT NULL,
     page INTEGER,
     section TEXT,
     char_start INTEGER NOT NULL,
     char_end INTEGER NOT NULL,
     source_title TEXT NOT NULL,
     quote TEXT NOT NULL,
     match TEXT NOT NULL,
     rank INTEGER NOT NULL,
     score REAL,
     created_at TEXT NOT NULL
   );
   CREATE INDEX research_citations_by_session ON research_citations(session_id);
   CREATE INDEX research_citations_by_message ON research_citations(message_id);
   CREATE TABLE research_notes (
     id TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL REFERENCES research_workspaces(id) ON DELETE CASCADE,
     session_id TEXT REFERENCES research_sessions(id) ON DELETE SET NULL,
     title TEXT NOT NULL,
     body TEXT NOT NULL,
     source_id TEXT,
     citation_id TEXT REFERENCES research_citations(id) ON DELETE SET NULL,
     created_by TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE INDEX research_notes_by_workspace ON research_notes(workspace_id);
   CREATE TABLE research_findings (
     id TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL REFERENCES research_workspaces(id) ON DELETE CASCADE,
     session_id TEXT REFERENCES research_sessions(id) ON DELETE SET NULL,
     number INTEGER NOT NULL,
     title TEXT NOT NULL,
     statement TEXT NOT NULL,
     status TEXT NOT NULL,
     reviewed_by TEXT,
     reviewed_at TEXT,
     created_by TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     UNIQUE (workspace_id, number)
   );
   CREATE TABLE research_finding_citations (
     finding_id TEXT NOT NULL REFERENCES research_findings(id) ON DELETE CASCADE,
     citation_id TEXT NOT NULL REFERENCES research_citations(id) ON DELETE CASCADE,
     position INTEGER NOT NULL,
     PRIMARY KEY (finding_id, citation_id)
   );
   CREATE TABLE research_events (
     session_id TEXT NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,
     seq INTEGER NOT NULL,
     run_id TEXT,
     type TEXT NOT NULL,
     data TEXT NOT NULL,
     at TEXT NOT NULL,
     PRIMARY KEY (session_id, seq)
   );`,
  // 0.8.0: IMAGES in a chat message. An image is the account's that uploaded it; it is claimed by one chat (session_id)
  // when a message names it, and goes with exactly one message (message_id, at its place). Unclaimed, it is swept after
  // a day; with its chat, it goes. Its bytes are a file named by the id, never by anything a client typed.
  `CREATE TABLE images (
     id TEXT PRIMARY KEY,
     owner_email TEXT NOT NULL,
     owner_org TEXT NOT NULL,
     media_type TEXT NOT NULL,
     byte_size INTEGER NOT NULL,
     width INTEGER,
     height INTEGER,
     sha256 TEXT NOT NULL,
     session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
     message_id TEXT,
     position INTEGER,
     created_at TEXT NOT NULL
   );
   CREATE INDEX images_by_session ON images (session_id, message_id, position);
   CREATE INDEX images_unclaimed ON images (created_at) WHERE session_id IS NULL;`,
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
