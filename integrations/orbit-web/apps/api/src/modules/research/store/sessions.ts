// Research sessions: each one's selection of sources, its messages, its journal of durable events, and its runs (the
// revisions each run's evidence was frozen to, and the passages it was given). Nothing else writes these tables.
import type { AnyResearchEvent, DurableResearchEventType, EventDataMap, PassageMatch, ResearchSessionStatus } from "@orbit-web/contracts";
import type { Database } from "../../../infra/storage/database.js";
import { bool, now, num, numOrNull, str, strOrNull, type Row } from "./rows.js";

export interface ResearchSessionRecord {
  id: string;
  workspaceId: string;
  title: string;
  model: string;
  effort: string;
  status: ResearchSessionStatus;
  statusReason: string | null;
  lastSeq: number;
  draftQuestion: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchMessageRecord {
  id: string;
  sessionId: string;
  runId: string | null;
  role: "user" | "assistant";
  text: string;
  partial: boolean;
  createdAt: string;
}

export type ResearchRunStatus = "running" | "completed" | "failed" | "interrupted";

export interface ResearchRunRecord {
  id: string;
  sessionId: string;
  workspaceId: string;
  status: ResearchRunStatus;
  model: string;
  effort: string;
  questionId: string | null;
  answerId: string | null;
  passages: number;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  signal: string | null;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  error: string | null;
}

export interface FrozenRevision {
  sourceId: string;
  revisionId: string;
  title: string;
}

export interface PassageRecord {
  runId: string;
  label: string;
  chunkId: number;
  sourceId: string;
  revisionId: string;
  rank: number;
  score: number | null;
  match: PassageMatch;
}

const sessionOf = (r: Row): ResearchSessionRecord => ({
  id: str(r.id),
  workspaceId: str(r.workspace_id),
  title: str(r.title),
  model: str(r.model),
  effort: str(r.effort),
  status: str(r.status) as ResearchSessionStatus,
  statusReason: strOrNull(r.status_reason),
  lastSeq: num(r.last_seq),
  draftQuestion: strOrNull(r.draft_question),
  createdBy: str(r.created_by),
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
});

const messageOf = (r: Row): ResearchMessageRecord => ({
  id: str(r.id),
  sessionId: str(r.session_id),
  runId: strOrNull(r.run_id),
  role: str(r.role) as "user" | "assistant",
  text: str(r.text),
  partial: bool(r.partial),
  createdAt: str(r.created_at),
});

const runOf = (r: Row): ResearchRunRecord => ({
  id: str(r.id),
  sessionId: str(r.session_id),
  workspaceId: str(r.workspace_id),
  status: str(r.status) as ResearchRunStatus,
  model: str(r.model),
  effort: str(r.effort),
  questionId: strOrNull(r.question_id),
  answerId: strOrNull(r.answer_id),
  passages: num(r.passages),
  startedAt: str(r.started_at),
  endedAt: strOrNull(r.ended_at),
  exitCode: numOrNull(r.exit_code),
  signal: strOrNull(r.signal),
  costUsd: numOrNull(r.cost_usd),
  inputTokens: numOrNull(r.input_tokens),
  outputTokens: numOrNull(r.output_tokens),
  error: strOrNull(r.error),
});

const SESSION_COLUMNS: Record<string, string> = { title: "title", model: "model", effort: "effort", status: "status", statusReason: "status_reason", draftQuestion: "draft_question" };

export type ResearchSessionPatch = Partial<Pick<ResearchSessionRecord, "title" | "model" | "effort" | "status" | "statusReason" | "draftQuestion">>;

export class ResearchSessionStore {
  constructor(private readonly database: Database) {}

  create(s: Pick<ResearchSessionRecord, "id" | "workspaceId" | "title" | "model" | "effort" | "draftQuestion" | "createdBy">, selection: readonly string[]): ResearchSessionRecord {
    const at = now();
    this.database.transaction(() => {
      this.database.db
        .prepare("INSERT INTO research_sessions (id, workspace_id, title, model, effort, status, draft_question, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?)")
        .run(s.id, s.workspaceId, s.title, s.model, s.effort, s.draftQuestion, s.createdBy, at, at);
      this.writeSelection(s.id, selection);
    });
    return this.get(s.id) as ResearchSessionRecord;
  }

  get(id: string): ResearchSessionRecord | null {
    const row = this.database.db.prepare("SELECT * FROM research_sessions WHERE id = ?").get(id) as Row | undefined;
    return row ? sessionOf(row) : null;
  }

  ofWorkspace(workspaceId: string): ResearchSessionRecord[] {
    return (this.database.db.prepare("SELECT * FROM research_sessions WHERE workspace_id = ? ORDER BY updated_at DESC, created_at DESC").all(workspaceId) as Row[]).map(sessionOf);
  }

  ofWorkspaces(workspaceIds: readonly string[]): ResearchSessionRecord[] {
    return (this.database.db.prepare("SELECT * FROM research_sessions WHERE workspace_id IN (SELECT value FROM json_each(?)) ORDER BY updated_at DESC, created_at DESC").all(JSON.stringify(workspaceIds)) as Row[]).map(sessionOf);
  }

  withStatus(status: ResearchSessionStatus): ResearchSessionRecord[] {
    return (this.database.db.prepare("SELECT * FROM research_sessions WHERE status = ?").all(status) as Row[]).map(sessionOf);
  }

  update(id: string, patch: ResearchSessionPatch): ResearchSessionRecord {
    const keys = Object.keys(patch).filter((k) => SESSION_COLUMNS[k] !== undefined);
    const sets = keys.map((k) => `${SESSION_COLUMNS[k]} = ?`);
    const values = keys.map((k) => (patch as Record<string, string | null>)[k] ?? null);
    this.database.db.prepare(`UPDATE research_sessions SET ${[...sets, "updated_at = ?"].join(", ")} WHERE id = ?`).run(...values, now(), id);
    return this.get(id) as ResearchSessionRecord;
  }

  delete(id: string): void {
    this.database.db.prepare("DELETE FROM research_sessions WHERE id = ?").run(id);
  }

  selection(sessionId: string): string[] {
    return (this.database.db.prepare("SELECT s.source_id FROM research_session_sources s JOIN research_sources r ON r.id = s.source_id WHERE s.session_id = ? ORDER BY r.created_at, r.id").all(sessionId) as Row[]).map((r) => str(r.source_id));
  }

  setSelection(sessionId: string, sourceIds: readonly string[]): string[] {
    this.database.transaction(() => this.writeSelection(sessionId, sourceIds));
    this.database.db.prepare("UPDATE research_sessions SET updated_at = ? WHERE id = ?").run(now(), sessionId);
    return this.selection(sessionId);
  }

  private writeSelection(sessionId: string, sourceIds: readonly string[]): void {
    this.database.db.prepare("DELETE FROM research_session_sources WHERE session_id = ?").run(sessionId);
    const insert = this.database.db.prepare("INSERT INTO research_session_sources (session_id, source_id) VALUES (?, ?) ON CONFLICT DO NOTHING");
    for (const id of sourceIds) insert.run(sessionId, id);
  }

  // A source new to the workspace joins every session of it whose selection held every source (a session that chose a
  // subset keeps its choice).
  selectEverywhere(workspaceId: string, sourceId: string): void {
    this.database.db
      .prepare(
        `INSERT INTO research_session_sources (session_id, source_id)
         SELECT s.id, ? FROM research_sessions s WHERE s.workspace_id = ?
           AND (SELECT count(*) FROM research_session_sources x WHERE x.session_id = s.id) = (SELECT count(*) FROM research_sources r WHERE r.workspace_id = s.workspace_id AND r.id <> ?)
         ON CONFLICT DO NOTHING`,
      )
      .run(sourceId, workspaceId, sourceId);
  }

  addMessage(m: Omit<ResearchMessageRecord, "createdAt">): ResearchMessageRecord {
    const at = now();
    this.database.db.prepare("INSERT INTO research_messages (id, session_id, run_id, role, text, partial, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(m.id, m.sessionId, m.runId, m.role, m.text, m.partial ? 1 : 0, at);
    return { ...m, createdAt: at };
  }

  messages(sessionId: string): ResearchMessageRecord[] {
    return (this.database.db.prepare("SELECT * FROM research_messages WHERE session_id = ? ORDER BY rowid").all(sessionId) as Row[]).map(messageOf);
  }

  // THE JOURNAL: a durable event takes the session's next sequence number in the transaction that stores it.
  append<T extends DurableResearchEventType>(sessionId: string, type: T, data: EventDataMap[T], runId: string | null): AnyResearchEvent {
    const at = now();
    return this.database.transaction(() => {
      const row = this.database.db.prepare("UPDATE research_sessions SET last_seq = last_seq + 1 WHERE id = ? RETURNING last_seq").get(sessionId) as Row | undefined;
      if (!row) throw new Error(`no research session ${sessionId}`);
      const seq = num(row.last_seq);
      this.database.db.prepare("INSERT INTO research_events (session_id, seq, run_id, type, data, at) VALUES (?, ?, ?, ?, ?, ?)").run(sessionId, seq, runId, type, JSON.stringify(data), at);
      return { id: `${sessionId}:${seq}`, type, stream: "research", sessionId, seq, runId, at, data } as AnyResearchEvent;
    });
  }

  since(sessionId: string, afterSeq: number, limit = 10_000): AnyResearchEvent[] {
    const rows = this.database.db.prepare("SELECT * FROM research_events WHERE session_id = ? AND seq > ? ORDER BY seq LIMIT ?").all(sessionId, afterSeq, limit) as Row[];
    return rows.map((r) => ({ id: `${sessionId}:${num(r.seq)}`, type: str(r.type), stream: "research", sessionId, seq: num(r.seq), runId: strOrNull(r.run_id), at: str(r.at), data: JSON.parse(str(r.data)) }) as AnyResearchEvent);
  }
}

export class ResearchRunStore {
  constructor(private readonly database: Database) {}

  // A run, the revisions its evidence is frozen to and the passages it is given -- in one transaction, before it starts.
  start(r: Pick<ResearchRunRecord, "id" | "sessionId" | "workspaceId" | "model" | "effort" | "questionId">, frozen: readonly FrozenRevision[], passages: readonly Omit<PassageRecord, "runId">[]): ResearchRunRecord {
    this.database.transaction(() => {
      this.database.db
        .prepare("INSERT INTO research_runs (id, session_id, workspace_id, status, model, effort, question_id, passages, started_at) VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?)")
        .run(r.id, r.sessionId, r.workspaceId, r.model, r.effort, r.questionId, passages.length, now());
      const revision = this.database.db.prepare("INSERT INTO research_run_revisions (run_id, source_id, revision_id, title) VALUES (?, ?, ?, ?)");
      for (const f of frozen) revision.run(r.id, f.sourceId, f.revisionId, f.title);
      const passage = this.database.db.prepare("INSERT INTO research_run_passages (run_id, label, chunk_id, source_id, revision_id, rank, score, match) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      for (const p of passages) passage.run(r.id, p.label, p.chunkId, p.sourceId, p.revisionId, p.rank, p.score, p.match);
    });
    return this.get(r.id) as ResearchRunRecord;
  }

  get(id: string): ResearchRunRecord | null {
    const row = this.database.db.prepare("SELECT * FROM research_runs WHERE id = ?").get(id) as Row | undefined;
    return row ? runOf(row) : null;
  }

  latest(sessionId: string): ResearchRunRecord | null {
    const row = this.database.db.prepare("SELECT * FROM research_runs WHERE session_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1").get(sessionId) as Row | undefined;
    return row ? runOf(row) : null;
  }

  running(): ResearchRunRecord[] {
    return (this.database.db.prepare("SELECT * FROM research_runs WHERE status = 'running'").all() as Row[]).map(runOf);
  }

  frozen(runId: string): FrozenRevision[] {
    return (this.database.db.prepare("SELECT * FROM research_run_revisions WHERE run_id = ? ORDER BY title, revision_id").all(runId) as Row[]).map((r) => ({ sourceId: str(r.source_id), revisionId: str(r.revision_id), title: str(r.title) }));
  }

  passages(runId: string): PassageRecord[] {
    return (this.database.db.prepare("SELECT * FROM research_run_passages WHERE run_id = ? ORDER BY rank").all(runId) as Row[]).map((r) => ({
      runId: str(r.run_id),
      label: str(r.label),
      chunkId: num(r.chunk_id),
      sourceId: str(r.source_id),
      revisionId: str(r.revision_id),
      rank: num(r.rank),
      score: numOrNull(r.score),
      match: str(r.match) as PassageMatch,
    }));
  }

  finish(id: string, status: Exclude<ResearchRunStatus, "running">, end: Pick<ResearchRunRecord, "answerId" | "exitCode" | "signal" | "costUsd" | "inputTokens" | "outputTokens" | "error">): void {
    this.database.db
      .prepare("UPDATE research_runs SET status = ?, ended_at = ?, answer_id = ?, exit_code = ?, signal = ?, cost_usd = ?, input_tokens = ?, output_tokens = ?, error = ? WHERE id = ?")
      .run(status, now(), end.answerId, end.exitCode, end.signal, end.costUsd, end.inputTokens, end.outputTokens, end.error, id);
  }

  runningInWorkspace(workspaceId: string): boolean {
    return this.database.db.prepare("SELECT 1 FROM research_runs WHERE workspace_id = ? AND status = 'running' LIMIT 1").get(workspaceId) !== undefined;
  }
}
