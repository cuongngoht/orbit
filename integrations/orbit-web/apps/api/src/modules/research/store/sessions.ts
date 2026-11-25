// Research sessions: each one's selection of sources, its messages, its journal of durable events, and its runs (the
// revisions each run's evidence was frozen to, and the passages it was given). Nothing else writes these tables. Every
// row carries its workspace's account, taken from its parent row.
import type { AnyResearchEvent, DurableResearchEventType, EventDataMap, PassageMatch, ResearchSessionStatus } from "@orbit-web/contracts";
import { Db, jsonParam } from "../../../infra/db/db.js";
import { bool, now, num, numOrNull, str, strOrNull, type Row } from "./rows.js";

export interface ResearchSessionRecord {
  id: string;
  accountId: string;
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
  accountId: string;
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
  accountId: str(r.account_id),
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
  accountId: str(r.account_id),
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

const eventOf = (sessionId: string, r: Row): AnyResearchEvent =>
  ({ id: `${sessionId}:${num(r.seq)}`, type: str(r.type), stream: "research", sessionId, seq: num(r.seq), runId: strOrNull(r.run_id), at: str(r.at), data: r.data }) as AnyResearchEvent;

const SESSION_COLUMNS: Record<string, string> = { title: "title", model: "model", effort: "effort", status: "status", statusReason: "status_reason", draftQuestion: "draft_question" };

export type ResearchSessionPatch = Partial<Pick<ResearchSessionRecord, "title" | "model" | "effort" | "status" | "statusReason" | "draftQuestion">>;

export class ResearchSessionStore {
  constructor(private readonly db: Db) {}

  // A session of a workspace (its account is the workspace's), with the sources it selects, in one transaction.
  async create(s: Pick<ResearchSessionRecord, "id" | "workspaceId" | "title" | "model" | "effort" | "draftQuestion" | "createdBy">, selection: readonly string[]): Promise<ResearchSessionRecord> {
    const at = now();
    return this.db.tx(async () => {
      const row = await this.db.one(
        "INSERT INTO research_sessions (id, account_id, workspace_id, title, model, effort, status, draft_question, created_by, created_at, updated_at) SELECT $1, w.account_id, w.id, $3, $4, $5, 'ready', $6, $7, $8, $8 FROM research_workspaces w WHERE w.id = $2 RETURNING *",
        [s.id, s.workspaceId, s.title, s.model, s.effort, s.draftQuestion, s.createdBy, at],
      );
      if (row === null) throw new Error(`no research workspace ${s.workspaceId}`);
      await this.writeSelection(s.id, selection);
      return sessionOf(row);
    });
  }

  async get(id: string): Promise<ResearchSessionRecord | null> {
    const row = await this.db.one("SELECT * FROM research_sessions WHERE id = $1", [id]);
    return row === null ? null : sessionOf(row);
  }

  async ofWorkspace(workspaceId: string): Promise<ResearchSessionRecord[]> {
    return (await this.db.query("SELECT * FROM research_sessions WHERE workspace_id = $1 ORDER BY updated_at DESC, created_at DESC", [workspaceId])).map(sessionOf);
  }

  async ofWorkspaces(workspaceIds: readonly string[]): Promise<ResearchSessionRecord[]> {
    if (workspaceIds.length === 0) return [];
    return (await this.db.query("SELECT * FROM research_sessions WHERE workspace_id = ANY($1::text[]) ORDER BY updated_at DESC, created_at DESC", [workspaceIds])).map(sessionOf);
  }

  async withStatus(status: ResearchSessionStatus): Promise<ResearchSessionRecord[]> {
    return (await this.db.query("SELECT * FROM research_sessions WHERE status = $1", [status])).map(sessionOf);
  }

  async update(id: string, patch: ResearchSessionPatch): Promise<ResearchSessionRecord> {
    const keys = Object.keys(patch).filter((k) => SESSION_COLUMNS[k] !== undefined);
    const sets = keys.map((k, i) => `${SESSION_COLUMNS[k]} = $${i + 2}`);
    const values = keys.map((k) => (patch as Record<string, string | null>)[k] ?? null);
    const row = await this.db.one(`UPDATE research_sessions SET ${[...sets, `updated_at = $${keys.length + 2}`].join(", ")} WHERE id = $1 RETURNING *`, [id, ...values, now()]);
    if (row === null) throw new Error(`no research session ${id}`);
    return sessionOf(row);
  }

  async delete(id: string): Promise<void> {
    await this.db.query("DELETE FROM research_sessions WHERE id = $1", [id]);
  }

  async selection(sessionId: string): Promise<string[]> {
    return (await this.db.query("SELECT s.source_id FROM research_session_sources s JOIN research_sources r ON r.id = s.source_id WHERE s.session_id = $1 ORDER BY r.created_at, r.id", [sessionId])).map((r) => str(r.source_id));
  }

  // How many sources each session selects (one query for a list of sessions).
  async selectionCounts(sessionIds: readonly string[]): Promise<Map<string, number>> {
    if (sessionIds.length === 0) return new Map();
    return new Map((await this.db.query("SELECT session_id, count(*) AS n FROM research_session_sources WHERE session_id = ANY($1::text[]) GROUP BY session_id", [sessionIds])).map((r) => [str(r.session_id), num(r.n)]));
  }

  async setSelection(sessionId: string, sourceIds: readonly string[]): Promise<string[]> {
    await this.db.tx(async () => {
      await this.writeSelection(sessionId, sourceIds);
      await this.db.query("UPDATE research_sessions SET updated_at = $2 WHERE id = $1", [sessionId, now()]);
    });
    return this.selection(sessionId);
  }

  // The selection replaced whole. Each source joins with the session's own account: the database refuses a source of
  // another account.
  private async writeSelection(sessionId: string, sourceIds: readonly string[]): Promise<void> {
    await this.db.query("DELETE FROM research_session_sources WHERE session_id = $1", [sessionId]);
    if (sourceIds.length === 0) return;
    await this.db.query(
      "INSERT INTO research_session_sources (account_id, session_id, source_id) SELECT s.account_id, s.id, x.source_id FROM research_sessions s, unnest($2::text[]) AS x(source_id) WHERE s.id = $1 ON CONFLICT DO NOTHING",
      [sessionId, sourceIds],
    );
  }

  // A source new to the workspace joins every session of it whose selection held every source (a session that chose a
  // subset keeps its choice).
  async selectEverywhere(workspaceId: string, sourceId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO research_session_sources (account_id, session_id, source_id)
       SELECT s.account_id, s.id, $1 FROM research_sessions s WHERE s.workspace_id = $2
         AND (SELECT count(*) FROM research_session_sources x WHERE x.session_id = s.id) = (SELECT count(*) FROM research_sources r WHERE r.workspace_id = s.workspace_id AND r.id <> $1)
       ON CONFLICT DO NOTHING`,
      [sourceId, workspaceId],
    );
  }

  async addMessage(m: Omit<ResearchMessageRecord, "createdAt">): Promise<ResearchMessageRecord> {
    const at = now();
    const row = await this.db.one(
      "INSERT INTO research_messages (id, account_id, session_id, run_id, role, text, partial, created_at) SELECT $1, s.account_id, s.id, $3, $4, $5, $6, $7 FROM research_sessions s WHERE s.id = $2 RETURNING *",
      [m.id, m.sessionId, m.runId, m.role, m.text, m.partial, at],
    );
    if (row === null) throw new Error(`no research session ${m.sessionId}`);
    return messageOf(row);
  }

  async messages(sessionId: string): Promise<ResearchMessageRecord[]> {
    return (await this.db.query("SELECT * FROM research_messages WHERE session_id = $1 ORDER BY seq", [sessionId])).map(messageOf);
  }

  // THE JOURNAL: a durable event takes the session's next sequence number by an UPDATE of the session's row (held until
  // the transaction ends), in the same transaction that stores it -- the caller's, when there is one.
  async append<T extends DurableResearchEventType>(sessionId: string, type: T, data: EventDataMap[T], runId: string | null): Promise<AnyResearchEvent> {
    const at = now();
    return this.db.tx(async () => {
      const row = await this.db.one("UPDATE research_sessions SET last_seq = last_seq + 1 WHERE id = $1 RETURNING last_seq, account_id", [sessionId]);
      if (row === null) throw new Error(`no research session ${sessionId}`);
      const seq = num(row.last_seq);
      await this.db.query("INSERT INTO research_events (account_id, session_id, seq, run_id, type, data, at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)", [str(row.account_id), sessionId, seq, runId, type, jsonParam(data), at]);
      return { id: `${sessionId}:${seq}`, type, stream: "research", sessionId, seq, runId, at, data } as AnyResearchEvent;
    });
  }

  // The journal after `afterSeq` (up to `until`, when given), in order, at most `limit`.
  async since(sessionId: string, afterSeq: number, limit = 10_000, until: number | null = null): Promise<AnyResearchEvent[]> {
    const rows =
      until === null
        ? await this.db.query("SELECT * FROM research_events WHERE session_id = $1 AND seq > $2 ORDER BY seq LIMIT $3", [sessionId, afterSeq, limit])
        : await this.db.query("SELECT * FROM research_events WHERE session_id = $1 AND seq > $2 AND seq <= $3 ORDER BY seq LIMIT $4", [sessionId, afterSeq, until, limit]);
    return rows.map((r) => eventOf(sessionId, r));
  }

  // The session's last sequence number handed out (0: none, or no such session).
  async head(sessionId: string): Promise<number> {
    return num((await this.db.one("SELECT last_seq FROM research_sessions WHERE id = $1", [sessionId]))?.last_seq ?? 0);
  }
}

export class ResearchRunStore {
  constructor(private readonly db: Db) {}

  // A run, the revisions its evidence is frozen to and the passages it is given -- in one transaction, before it starts.
  async start(r: Pick<ResearchRunRecord, "id" | "sessionId" | "model" | "effort" | "questionId">, frozen: readonly FrozenRevision[], passages: readonly Omit<PassageRecord, "runId">[]): Promise<ResearchRunRecord> {
    return this.db.tx(async () => {
      const row = await this.db.one(
        "INSERT INTO research_runs (id, account_id, session_id, workspace_id, status, model, effort, question_id, passages, started_at) SELECT $1, s.account_id, s.id, s.workspace_id, 'running', $3, $4, $5, $6, $7 FROM research_sessions s WHERE s.id = $2 RETURNING *",
        [r.id, r.sessionId, r.model, r.effort, r.questionId, passages.length, now()],
      );
      if (row === null) throw new Error(`no research session ${r.sessionId}`);
      const run = runOf(row);
      if (frozen.length > 0) {
        await this.db.query("INSERT INTO research_run_revisions (account_id, run_id, source_id, revision_id, title) SELECT $1, $2, f.source_id, f.revision_id, f.title FROM unnest($3::text[], $4::text[], $5::text[]) AS f(source_id, revision_id, title)", [
          run.accountId,
          run.id,
          frozen.map((f) => f.sourceId),
          frozen.map((f) => f.revisionId),
          frozen.map((f) => f.title),
        ]);
      }
      if (passages.length > 0) {
        await this.db.query(
          "INSERT INTO research_run_passages (account_id, run_id, label, chunk_id, source_id, revision_id, rank, score, match) SELECT $1, $2, p.label, p.chunk_id, p.source_id, p.revision_id, p.rank, p.score, p.match FROM unnest($3::text[], $4::bigint[], $5::text[], $6::text[], $7::int[], $8::float8[], $9::text[]) AS p(label, chunk_id, source_id, revision_id, rank, score, match)",
          [run.accountId, run.id, passages.map((p) => p.label), passages.map((p) => p.chunkId), passages.map((p) => p.sourceId), passages.map((p) => p.revisionId), passages.map((p) => p.rank), passages.map((p) => p.score), passages.map((p) => p.match)],
        );
      }
      return run;
    });
  }

  async get(id: string): Promise<ResearchRunRecord | null> {
    const row = await this.db.one("SELECT * FROM research_runs WHERE id = $1", [id]);
    return row === null ? null : runOf(row);
  }

  async latest(sessionId: string): Promise<ResearchRunRecord | null> {
    const row = await this.db.one("SELECT * FROM research_runs WHERE session_id = $1 ORDER BY started_at DESC, seq DESC LIMIT 1", [sessionId]);
    return row === null ? null : runOf(row);
  }

  async running(): Promise<ResearchRunRecord[]> {
    return (await this.db.query("SELECT * FROM research_runs WHERE status = 'running'")).map(runOf);
  }

  async frozen(runId: string): Promise<FrozenRevision[]> {
    return (await this.db.query("SELECT * FROM research_run_revisions WHERE run_id = $1 ORDER BY title, revision_id", [runId])).map((r) => ({ sourceId: str(r.source_id), revisionId: str(r.revision_id), title: str(r.title) }));
  }

  async passages(runId: string): Promise<PassageRecord[]> {
    return (await this.db.query("SELECT * FROM research_run_passages WHERE run_id = $1 ORDER BY rank", [runId])).map((r) => ({
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

  async finish(id: string, status: Exclude<ResearchRunStatus, "running">, end: Pick<ResearchRunRecord, "answerId" | "exitCode" | "signal" | "costUsd" | "inputTokens" | "outputTokens" | "error">): Promise<void> {
    await this.db.query("UPDATE research_runs SET status = $2, ended_at = $3, answer_id = $4, exit_code = $5, signal = $6, cost_usd = $7, input_tokens = $8, output_tokens = $9, error = $10 WHERE id = $1", [
      id,
      status,
      now(),
      end.answerId,
      end.exitCode,
      end.signal,
      end.costUsd,
      end.inputTokens,
      end.outputTokens,
      end.error,
    ]);
  }

  async runningInWorkspace(workspaceId: string): Promise<boolean> {
    return (await this.db.one("SELECT 1 AS yes FROM research_runs WHERE workspace_id = $1 AND status = 'running' LIMIT 1", [workspaceId])) !== null;
  }
}
