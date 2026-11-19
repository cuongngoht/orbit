// Typed access to Orbit Web's tables. Each store owns its SQL; nothing else writes these tables.
import type { AnyAppEvent, ChatMessage, DurableEventType, EventDataMap, ModelChoice, SessionStatus } from "@orbit-web/contracts";
import type { Database } from "./database.js";

type Row = Record<string, unknown>;

const str = (v: unknown): string => String(v);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number => Number(v);

export class SettingsStore {
  constructor(private readonly database: Database) {}

  get<T>(key: string): T | undefined {
    const row = this.database.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as Row | undefined;
    return row ? (JSON.parse(str(row.value)) as T) : undefined;
  }

  set(key: string, value: unknown): void {
    this.database.db
      .prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .run(key, JSON.stringify(value), new Date().toISOString());
  }

  delete(key: string): void {
    this.database.db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  }
}

export interface SessionRecord {
  id: string;
  title: string;
  repository: string;
  branch: string;
  workBranch: string | null;
  baseCommit: string | null;
  model: ModelChoice;
  workspacePath: string;
  claudeSessionId: string;
  turns: number;
  status: SessionStatus;
  statusReason: string | null;
  lastSeq: number;
  pendingPrompt: string | null;
  createdAt: string;
  updatedAt: string;
}

const sessionOf = (r: Row): SessionRecord => ({
  id: str(r.id),
  title: str(r.title),
  repository: str(r.repository),
  branch: str(r.branch),
  workBranch: strOrNull(r.work_branch),
  baseCommit: strOrNull(r.base_commit),
  model: str(r.model) as ModelChoice,
  workspacePath: str(r.workspace_path),
  claudeSessionId: str(r.claude_session_id),
  turns: num(r.turns),
  status: str(r.status) as SessionStatus,
  statusReason: strOrNull(r.status_reason),
  lastSeq: num(r.last_seq),
  pendingPrompt: strOrNull(r.pending_prompt),
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
});

export type NewSession = Pick<SessionRecord, "id" | "title" | "repository" | "branch" | "model" | "workspacePath" | "claudeSessionId" | "status" | "pendingPrompt">;

const SESSION_COLUMNS: Record<string, string> = {
  title: "title",
  workBranch: "work_branch",
  baseCommit: "base_commit",
  model: "model",
  turns: "turns",
  status: "status",
  statusReason: "status_reason",
  pendingPrompt: "pending_prompt",
  claudeSessionId: "claude_session_id",
};

export type SessionPatch = Partial<Pick<SessionRecord, "title" | "workBranch" | "baseCommit" | "model" | "turns" | "status" | "statusReason" | "pendingPrompt" | "claudeSessionId">>;

export class SessionStore {
  constructor(private readonly database: Database) {}

  create(s: NewSession): SessionRecord {
    const now = new Date().toISOString();
    this.database.db
      .prepare(
        "INSERT INTO sessions (id, title, repository, branch, model, workspace_path, claude_session_id, status, pending_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(s.id, s.title, s.repository, s.branch, s.model, s.workspacePath, s.claudeSessionId, s.status, s.pendingPrompt, now, now);
    return this.get(s.id) as SessionRecord;
  }

  get(id: string): SessionRecord | null {
    const row = this.database.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Row | undefined;
    return row ? sessionOf(row) : null;
  }

  list(): SessionRecord[] {
    return (this.database.db.prepare("SELECT * FROM sessions ORDER BY updated_at DESC, created_at DESC").all() as Row[]).map(sessionOf);
  }

  withStatus(status: SessionStatus): SessionRecord[] {
    return (this.database.db.prepare("SELECT * FROM sessions WHERE status = ?").all(status) as Row[]).map(sessionOf);
  }

  update(id: string, patch: SessionPatch): SessionRecord {
    const keys = Object.keys(patch).filter((k) => SESSION_COLUMNS[k] !== undefined);
    const sets = keys.map((k) => `${SESSION_COLUMNS[k]} = ?`);
    const values = keys.map((k) => (patch as Record<string, string | number | null>)[k] ?? null);
    this.database.db.prepare(`UPDATE sessions SET ${[...sets, "updated_at = ?"].join(", ")} WHERE id = ?`).run(...values, new Date().toISOString(), id);
    return this.get(id) as SessionRecord;
  }

  delete(id: string): void {
    this.database.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }
}

export class MessageStore {
  constructor(private readonly database: Database) {}

  add(m: ChatMessage & { sessionId: string }): void {
    this.database.db
      .prepare("INSERT INTO messages (id, session_id, run_id, role, text, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET text = excluded.text")
      .run(m.id, m.sessionId, m.runId, m.role, m.text, m.createdAt);
  }

  list(sessionId: string): ChatMessage[] {
    return (this.database.db.prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY rowid").all(sessionId) as Row[]).map((r) => ({
      id: str(r.id),
      role: str(r.role) as ChatMessage["role"],
      text: str(r.text),
      runId: strOrNull(r.run_id),
      createdAt: str(r.created_at),
    }));
  }
}

export class EventStore {
  constructor(private readonly database: Database) {}

  // Gives the event the session's next sequence number, in the same transaction that stores it: a number is never
  // handed out twice, across restarts too.
  append<T extends DurableEventType>(sessionId: string, type: T, data: EventDataMap[T], runId: string | null): AnyAppEvent {
    const at = new Date().toISOString();
    return this.database.transaction(() => {
      const row = this.database.db.prepare("UPDATE sessions SET last_seq = last_seq + 1 WHERE id = ? RETURNING last_seq").get(sessionId) as Row | undefined;
      if (!row) throw new Error(`no session ${sessionId}`);
      const seq = num(row.last_seq);
      this.database.db.prepare("INSERT INTO events (session_id, seq, run_id, type, data, at) VALUES (?, ?, ?, ?, ?, ?)").run(sessionId, seq, runId, type, JSON.stringify(data), at);
      return { type, sessionId, seq, runId, at, data } as AnyAppEvent;
    });
  }

  since(sessionId: string, afterSeq: number, limit = 10_000): AnyAppEvent[] {
    const rows = this.database.db.prepare("SELECT * FROM events WHERE session_id = ? AND seq > ? ORDER BY seq LIMIT ?").all(sessionId, afterSeq, limit) as Row[];
    return rows.map((r) => ({ type: str(r.type), sessionId, seq: num(r.seq), runId: strOrNull(r.run_id), at: str(r.at), data: JSON.parse(str(r.data)) }) as AnyAppEvent);
  }
}

export type RunStatus = "running" | "completed" | "failed" | "interrupted";

export interface RunRecord {
  id: string;
  sessionId: string;
  status: RunStatus;
  model: string;
  resumed: boolean;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  signal: string | null;
  costUsd: number | null;
}

export class RunStore {
  constructor(private readonly database: Database) {}

  start(r: Pick<RunRecord, "id" | "sessionId" | "model" | "resumed">): void {
    this.database.db
      .prepare("INSERT INTO runs (id, session_id, status, model, resumed, started_at) VALUES (?, ?, 'running', ?, ?, ?)")
      .run(r.id, r.sessionId, r.model, r.resumed ? 1 : 0, new Date().toISOString());
  }

  finish(id: string, status: Exclude<RunStatus, "running">, end: { exitCode: number | null; signal: string | null; costUsd: number | null }): void {
    this.database.db
      .prepare("UPDATE runs SET status = ?, ended_at = ?, exit_code = ?, signal = ?, cost_usd = ? WHERE id = ?")
      .run(status, new Date().toISOString(), end.exitCode, end.signal, end.costUsd, id);
  }

  running(): RunRecord[] {
    return (this.database.db.prepare("SELECT * FROM runs WHERE status = 'running'").all() as Row[]).map((r) => ({
      id: str(r.id),
      sessionId: str(r.session_id),
      status: "running",
      model: str(r.model),
      resumed: num(r.resumed) === 1,
      startedAt: str(r.started_at),
      endedAt: null,
      exitCode: null,
      signal: null,
      costUsd: null,
    }));
  }
}
