// Typed access to the chats' tables (schema `app`). Each store owns its SQL; nothing else writes these tables. Every
// record carries the account that owns it -- the account of the chat it belongs to -- and the database holds a child to
// its chat's account (migrations.ts).
import type {
  AccessEntry,
  AnySessionEvent,
  ChatMessage,
  DurableEventType,
  EffortChoice,
  EventDataMap,
  ImageMediaType,
  ImageRef,
  ModeChoice,
  ModelChoice,
  ProjectInventory,
  RepositorySource,
  SessionStatus,
  SharedChat,
} from "@orbit-web/contracts";
import { SYSTEM_ACCOUNT_ID } from "../accounts/stores.js";
import { Db, jsonParam, type Row } from "../db/db.js";

const str = (v: unknown): string => String(v);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number => Number(v);
const textOrNull = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const intOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

// What is the DEPLOYMENT's (not any customer account's): one value per key, kept as a setting of the reserved SYSTEM
// account (there is no table of settings beside the accounts').
export class SettingsStore {
  constructor(private readonly db: Db) {}

  async get<T>(key: string): Promise<T | undefined> {
    const row = await this.db.one("SELECT value FROM account_settings WHERE account_id = $1 AND key = $2", [SYSTEM_ACCOUNT_ID, key]);
    return row === null ? undefined : (row.value as T);
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.db.query("INSERT INTO account_settings (account_id, key, value, updated_at) VALUES ($1, $2, $3::jsonb, $4) ON CONFLICT (account_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", [
      SYSTEM_ACCOUNT_ID,
      key,
      jsonParam(value),
      new Date().toISOString(),
    ]);
  }

  async delete(key: string): Promise<void> {
    await this.db.query("DELETE FROM account_settings WHERE account_id = $1 AND key = $2", [SYSTEM_ACCOUNT_ID, key]);
  }
}

export interface SessionRecord {
  id: string;
  // The account that owns it, and its identity's email when it was started (shown; never what authorizes anything).
  accountId: string;
  ownerEmail: string;
  title: string;
  // Where the workspace came from; all four are null for a chat with no repository. `repository` is the display name,
  // `repositoryId` the id its source lists it under.
  source: RepositorySource | null;
  repository: string | null;
  repositoryId: string | null;
  branch: string | null;
  workBranch: string | null;
  baseCommit: string | null;
  model: ModelChoice;
  effort: EffortChoice;
  mode: ModeChoice;
  workspacePath: string;
  // The CLI the chat runs on, and the account's connection it names (null: the default Claude Code connection).
  runtime: "claude" | "codex";
  connectionId: string | null;
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
  accountId: str(r.account_id),
  ownerEmail: str(r.owner_email),
  title: str(r.title),
  source: textOrNull(r.source) as RepositorySource | null,
  repository: textOrNull(r.repository),
  repositoryId: textOrNull(r.repository_id),
  branch: textOrNull(r.branch),
  workBranch: strOrNull(r.work_branch),
  baseCommit: strOrNull(r.base_commit),
  model: str(r.model) as ModelChoice,
  effort: str(r.effort) as EffortChoice,
  mode: str(r.mode) as ModeChoice,
  workspacePath: str(r.workspace_path),
  runtime: str(r.runtime) === "codex" ? "codex" : "claude",
  connectionId: strOrNull(r.connection_id),
  claudeSessionId: str(r.claude_session_id),
  turns: num(r.turns),
  status: str(r.status) as SessionStatus,
  statusReason: strOrNull(r.status_reason),
  lastSeq: num(r.last_seq),
  pendingPrompt: strOrNull(r.pending_prompt),
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
});

export type NewSession = Pick<
  SessionRecord,
  "id" | "accountId" | "ownerEmail" | "title" | "source" | "repository" | "repositoryId" | "branch" | "model" | "effort" | "mode" | "workspacePath" | "claudeSessionId" | "status" | "pendingPrompt" | "runtime" | "connectionId"
>;

// Who is asking for records: an account, and the email its identity is shared by.
export interface Viewer {
  accountId: string;
  email: string;
}

const SESSION_COLUMNS: Record<string, string> = {
  title: "title",
  workBranch: "work_branch",
  baseCommit: "base_commit",
  model: "model",
  effort: "effort",
  mode: "mode",
  turns: "turns",
  status: "status",
  statusReason: "status_reason",
  pendingPrompt: "pending_prompt",
  claudeSessionId: "claude_session_id",
};

export type SessionPatch = Partial<
  Pick<SessionRecord, "title" | "workBranch" | "baseCommit" | "model" | "effort" | "mode" | "turns" | "status" | "statusReason" | "pendingPrompt" | "claudeSessionId">
>;

export class SessionStore {
  constructor(private readonly db: Db) {}

  async create(s: NewSession): Promise<SessionRecord> {
    const now = new Date().toISOString();
    const row = await this.db.one(
      "INSERT INTO sessions (id, account_id, owner_email, title, source, repository, repository_id, branch, model, effort, mode, workspace_path, claude_session_id, status, pending_prompt, created_at, updated_at, runtime, connection_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16, $17, $18) RETURNING *",
      [s.id, s.accountId, s.ownerEmail, s.title, s.source, s.repository, s.repositoryId, s.branch, s.model, s.effort, s.mode, s.workspacePath, s.claudeSessionId, s.status, s.pendingPrompt, now, s.runtime, s.connectionId],
    );
    return sessionOf(row as Row);
  }

  // The chats an account owns, and those shared with its identity's email -- newest first.
  async visibleTo(v: Viewer): Promise<SessionRecord[]> {
    return (await this.db.query("SELECT * FROM sessions WHERE account_id = $1 OR id IN (SELECT session_id FROM session_access WHERE email = $2) ORDER BY updated_at DESC, created_at DESC", [v.accountId, v.email])).map(sessionOf);
  }

  async ofAccount(accountId: string): Promise<SessionRecord[]> {
    return (await this.db.query("SELECT * FROM sessions WHERE account_id = $1 ORDER BY updated_at DESC, created_at DESC", [accountId])).map(sessionOf);
  }

  async get(id: string): Promise<SessionRecord | null> {
    const row = await this.db.one("SELECT * FROM sessions WHERE id = $1", [id]);
    return row === null ? null : sessionOf(row);
  }

  async withStatus(status: SessionStatus, accountId?: string): Promise<SessionRecord[]> {
    const rows = accountId === undefined ? await this.db.query("SELECT * FROM sessions WHERE status = $1", [status]) : await this.db.query("SELECT * FROM sessions WHERE status = $1 AND account_id = $2", [status, accountId]);
    return rows.map(sessionOf);
  }

  async countWithStatus(statuses: readonly SessionStatus[]): Promise<number> {
    return Number((await this.db.one("SELECT count(*) AS n FROM sessions WHERE status = ANY($1::text[])", [statuses]))?.n ?? 0);
  }

  async update(id: string, patch: SessionPatch): Promise<SessionRecord> {
    const keys = Object.keys(patch).filter((k) => SESSION_COLUMNS[k] !== undefined);
    const sets = keys.map((k, i) => `${SESSION_COLUMNS[k]} = $${i + 1}`);
    const values = keys.map((k) => (patch as Record<string, string | number | null>)[k] ?? null);
    const row = await this.db.one(`UPDATE sessions SET ${[...sets, `updated_at = $${keys.length + 1}`].join(", ")} WHERE id = $${keys.length + 2} RETURNING *`, [...values, new Date().toISOString(), id]);
    if (row === null) throw new Error(`no session ${id}`);
    return sessionOf(row);
  }

  async delete(id: string): Promise<void> {
    await this.db.query("DELETE FROM sessions WHERE id = $1", [id]);
  }
}

// Who an owner shared a chat with, by email.
export class SessionAccessStore {
  constructor(private readonly db: Db) {}

  async list(sessionId: string): Promise<AccessEntry[]> {
    return (await this.db.query("SELECT * FROM session_access WHERE session_id = $1 ORDER BY granted_at, email", [sessionId])).map((r) => ({ email: str(r.email), grantedBy: str(r.granted_by), grantedAt: str(r.granted_at) }));
  }

  async emails(sessionId: string): Promise<string[]> {
    return (await this.db.query("SELECT email FROM session_access WHERE session_id = $1", [sessionId])).map((r) => str(r.email));
  }

  async has(sessionId: string, email: string): Promise<boolean> {
    return (await this.db.one("SELECT 1 AS yes FROM session_access WHERE session_id = $1 AND email = $2", [sessionId, email])) !== null;
  }

  // The whole list, as the owner gave it: who was already on it keeps when they were added.
  async set(session: { id: string; accountId: string }, emails: readonly string[], grantedBy: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.tx(async () => {
      await this.db.query("DELETE FROM session_access WHERE session_id = $1 AND NOT (email = ANY($2::text[]))", [session.id, emails]);
      for (const email of emails) {
        await this.db.query("INSERT INTO session_access (account_id, session_id, email, granted_by, granted_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (session_id, email) DO NOTHING", [session.accountId, session.id, email, grantedBy, now]);
      }
    });
  }
}

export class MessageStore {
  constructor(private readonly db: Db) {}

  async add(m: ChatMessage & { sessionId: string }): Promise<void> {
    await this.db.query(
      "INSERT INTO messages (id, account_id, session_id, run_id, role, text, created_at) SELECT $1, s.account_id, s.id, $3, $4, $5, $6 FROM sessions s WHERE s.id = $2 ON CONFLICT (id) DO UPDATE SET text = excluded.text",
      [m.id, m.sessionId, m.runId, m.role, m.text, m.createdAt],
    );
  }

  async list(sessionId: string): Promise<ChatMessage[]> {
    return (await this.db.query("SELECT * FROM messages WHERE session_id = $1 ORDER BY seq", [sessionId])).map((r) => ({
      id: str(r.id),
      role: str(r.role) as ChatMessage["role"],
      text: str(r.text),
      runId: strOrNull(r.run_id),
      createdAt: str(r.created_at),
    }));
  }
}

export interface ImageRecord extends ImageRef {
  // The account it belongs to: its uploader's, until a chat claims it, then that chat's.
  accountId: string;
  sha256: string;
  // The chat that claimed it (a message named it), and the message it went with, at its place: null until then.
  sessionId: string | null;
  messageId: string | null;
  position: number | null;
  createdAt: string;
}

const imageOf = (r: Row): ImageRecord => ({
  id: str(r.id),
  mediaType: str(r.media_type) as ImageMediaType,
  width: intOrNull(r.width),
  height: intOrNull(r.height),
  bytes: num(r.byte_size),
  accountId: str(r.account_id),
  sha256: str(r.sha256),
  sessionId: strOrNull(r.session_id),
  messageId: strOrNull(r.message_id),
  position: intOrNull(r.position),
  createdAt: str(r.created_at),
});

export const imageRefOf = (i: ImageRecord): ImageRef => ({ id: i.id, mediaType: i.mediaType, width: i.width, height: i.height, bytes: i.bytes });

// THE IMAGES of chat messages: whose upload each is, which chat claimed it, which message it went with. Their bytes are
// files (image-files.ts); this table names them.
export class ImageStore {
  constructor(private readonly db: Db) {}

  async insert(i: Omit<ImageRecord, "sessionId" | "messageId" | "position">): Promise<void> {
    await this.db.query("INSERT INTO images (id, account_id, media_type, byte_size, width, height, sha256, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", [i.id, i.accountId, i.mediaType, i.bytes, i.width, i.height, i.sha256, i.createdAt]);
  }

  async get(id: string): Promise<ImageRecord | null> {
    const r = await this.db.one("SELECT * FROM images WHERE id = $1", [id]);
    return r === null ? null : imageOf(r);
  }

  // Claimed for a chat, still unsent, by the account that uploaded it: it becomes the chat's (its account's).
  async claim(ids: readonly string[], session: { id: string; accountId: string }, uploader: string): Promise<void> {
    await this.db.query(
      "UPDATE images SET session_id = $2, account_id = $3 WHERE id = ANY($1::text[]) AND message_id IS NULL AND ((session_id IS NULL AND account_id = $4) OR session_id = $2)",
      [ids, session.id, session.accountId, uploader],
    );
  }

  // Sent with a message, in the order named.
  async attach(ids: readonly string[], sessionId: string, messageId: string): Promise<void> {
    await this.db.tx(async () => {
      for (const [position, id] of ids.entries()) await this.db.query("UPDATE images SET message_id = $1, position = $2 WHERE id = $3 AND session_id = $4 AND message_id IS NULL", [messageId, position, id, sessionId]);
    });
  }

  // A chat's images claimed and not yet sent (a new chat's first message), in the order they were uploaded.
  async pending(sessionId: string): Promise<ImageRecord[]> {
    return (await this.db.query("SELECT * FROM images WHERE session_id = $1 AND message_id IS NULL ORDER BY created_at, seq", [sessionId])).map(imageOf);
  }

  // The images sent in a chat, by message and place.
  async sentIn(sessionId: string): Promise<ImageRecord[]> {
    return (await this.db.query("SELECT * FROM images WHERE session_id = $1 AND message_id IS NOT NULL ORDER BY message_id, position", [sessionId])).map(imageOf);
  }

  // Every image of a chat, sent or not: what goes with it.
  async idsOf(sessionId: string): Promise<string[]> {
    return (await this.db.query("SELECT id FROM images WHERE session_id = $1", [sessionId])).map((r) => str(r.id));
  }

  // Uploads no chat claimed since `before`.
  async unclaimedSince(before: string): Promise<string[]> {
    return (await this.db.query("SELECT id FROM images WHERE session_id IS NULL AND created_at < $1", [before])).map((r) => str(r.id));
  }

  async known(ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    return new Set((await this.db.query("SELECT id FROM images WHERE id = ANY($1::text[])", [ids])).map((r) => str(r.id)));
  }

  async remove(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.query("DELETE FROM images WHERE id = ANY($1::text[])", [ids]);
  }
}

const eventOf = (sessionId: string, r: Row): AnySessionEvent =>
  ({ id: `${sessionId}:${num(r.seq)}`, type: str(r.type), stream: "session", sessionId, seq: num(r.seq), runId: strOrNull(r.run_id), at: str(r.at), data: r.data }) as AnySessionEvent;

// THE JOURNAL of the session streams: every durable event, in order, per chat. A durable event's id is
// `<session>:<seq>` -- the same whether it is delivered live or replayed.
export class EventStore {
  constructor(private readonly db: Db) {}

  // Gives the event the chat's next sequence number by an UPDATE of the chat's row (which holds the row until the
  // transaction ends), in the same transaction that stores it: a number is never handed out twice, across concurrent
  // writers and restarts too.
  async append<T extends DurableEventType>(sessionId: string, type: T, data: EventDataMap[T], runId: string | null): Promise<AnySessionEvent> {
    const at = new Date().toISOString();
    return this.db.tx(async () => {
      const row = await this.db.one("UPDATE sessions SET last_seq = last_seq + 1 WHERE id = $1 RETURNING last_seq, account_id", [sessionId]);
      if (row === null) throw new Error(`no session ${sessionId}`);
      const seq = num(row.last_seq);
      await this.db.query("INSERT INTO events (account_id, session_id, seq, run_id, type, data, at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)", [str(row.account_id), sessionId, seq, runId, type, jsonParam(data), at]);
      return { id: `${sessionId}:${seq}`, type, stream: "session", sessionId, seq, runId, at, data } as AnySessionEvent;
    });
  }

  // The events after `afterSeq` (up to `until`, when given), in order, at most `limit`.
  async since(sessionId: string, afterSeq: number, limit = 10_000, until: number | null = null): Promise<AnySessionEvent[]> {
    const rows = until === null
      ? await this.db.query("SELECT * FROM events WHERE session_id = $1 AND seq > $2 ORDER BY seq LIMIT $3", [sessionId, afterSeq, limit])
      : await this.db.query("SELECT * FROM events WHERE session_id = $1 AND seq > $2 AND seq <= $3 ORDER BY seq LIMIT $4", [sessionId, afterSeq, until, limit]);
    return rows.map((r) => eventOf(sessionId, r));
  }

  // The chat's last sequence number handed out (0: none, or no such chat).
  async head(sessionId: string): Promise<number> {
    return num((await this.db.one("SELECT last_seq FROM sessions WHERE id = $1", [sessionId]))?.last_seq ?? 0);
  }
}

// What a chat's repository brings (skills, commands, agents, plugins), as read on its workspace's first fetch.
export class ProjectStore {
  constructor(private readonly db: Db) {}

  async get(sessionId: string): Promise<ProjectInventory | null> {
    const row = await this.db.one("SELECT data FROM project_inventories WHERE session_id = $1", [sessionId]);
    return row === null ? null : (row.data as ProjectInventory);
  }

  async set(sessionId: string, inventory: ProjectInventory): Promise<void> {
    await this.db.query(
      "INSERT INTO project_inventories (session_id, account_id, data, updated_at) SELECT s.id, s.account_id, $2::jsonb, $3 FROM sessions s WHERE s.id = $1 ON CONFLICT (session_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
      [sessionId, jsonParam(inventory), new Date().toISOString()],
    );
  }

  // The inventories of the chats an account may see.
  async list(sessionIds: readonly string[]): Promise<{ sessionId: string; inventory: ProjectInventory }[]> {
    if (sessionIds.length === 0) return [];
    return (await this.db.query("SELECT session_id, data FROM project_inventories WHERE session_id = ANY($1::text[]) ORDER BY updated_at DESC", [sessionIds])).map((r) => ({
      sessionId: str(r.session_id),
      inventory: r.data as ProjectInventory,
    }));
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
  constructor(private readonly db: Db) {}

  async start(r: Pick<RunRecord, "id" | "sessionId" | "model" | "resumed"> & { effort: string; mode: string }): Promise<void> {
    await this.db.query("INSERT INTO runs (id, account_id, session_id, status, model, effort, mode, resumed, started_at) SELECT $1, s.account_id, s.id, 'running', $3, $4, $5, $6, $7 FROM sessions s WHERE s.id = $2", [
      r.id,
      r.sessionId,
      r.model,
      r.effort,
      r.mode,
      r.resumed,
      new Date().toISOString(),
    ]);
  }

  async finish(id: string, status: Exclude<RunStatus, "running">, end: { exitCode: number | null; signal: string | null; costUsd: number | null }): Promise<void> {
    await this.db.query("UPDATE runs SET status = $1, ended_at = $2, exit_code = $3, signal = $4, cost_usd = $5 WHERE id = $6", [status, new Date().toISOString(), end.exitCode, end.signal, end.costUsd, id]);
  }

  async running(): Promise<RunRecord[]> {
    return (await this.db.query("SELECT * FROM runs WHERE status = 'running'")).map((r) => ({
      id: str(r.id),
      sessionId: str(r.session_id),
      status: "running",
      model: str(r.model),
      resumed: r.resumed === true,
      startedAt: str(r.started_at),
      endedAt: null,
      exitCode: null,
      signal: null,
      costUsd: null,
    }));
  }
}

// A chat's shared copy: the snapshot its link shows (modules/share), one per chat, found by the link's token.
export interface ShareRecord {
  sessionId: string;
  token: string;
  includeTools: boolean;
  snapshot: SharedChat;
  createdAt: string;
  updatedAt: string;
}

const shareOf = (r: Row): ShareRecord => ({
  sessionId: str(r.session_id),
  token: str(r.token),
  includeTools: r.include_tools === true,
  snapshot: r.data as SharedChat,
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
});

export class ShareStore {
  constructor(private readonly db: Db) {}

  async get(sessionId: string): Promise<ShareRecord | null> {
    const row = await this.db.one("SELECT * FROM shares WHERE session_id = $1", [sessionId]);
    return row === null ? null : shareOf(row);
  }

  async byToken(token: string): Promise<ShareRecord | null> {
    const row = await this.db.one("SELECT * FROM shares WHERE token = $1", [token]);
    return row === null ? null : shareOf(row);
  }

  // A new snapshot under the chat's link (made on its first share, kept by every update).
  async put(sessionId: string, token: string, includeTools: boolean, snapshot: SharedChat): Promise<ShareRecord> {
    const now = new Date().toISOString();
    const row = await this.db.one(
      "INSERT INTO shares (session_id, account_id, token, include_tools, data, created_at, updated_at) SELECT s.id, s.account_id, $2, $3, $4::jsonb, $5, $5 FROM sessions s WHERE s.id = $1 ON CONFLICT (session_id) DO UPDATE SET include_tools = excluded.include_tools, data = excluded.data, updated_at = excluded.updated_at RETURNING *",
      [sessionId, token, includeTools, jsonParam(snapshot), now],
    );
    if (row === null) throw new Error(`no session ${sessionId}`);
    return shareOf(row);
  }

  async delete(sessionId: string): Promise<void> {
    await this.db.query("DELETE FROM shares WHERE session_id = $1", [sessionId]);
  }
}
