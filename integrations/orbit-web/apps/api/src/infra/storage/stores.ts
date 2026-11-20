// Typed access to Orbit Web's tables. Each store owns its SQL; nothing else writes these tables.
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
import type { Database } from "./database.js";

type Row = Record<string, unknown>;

const str = (v: unknown): string => String(v);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number => Number(v);
// The two columns a chat with no repository holds as '' (they were NOT NULL before chats could have none).
const textOrNull = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

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
  claudeSessionId: string;
  turns: number;
  status: SessionStatus;
  statusReason: string | null;
  lastSeq: number;
  pendingPrompt: string | null;
  // The Claude account that started it (email, organization); null for a chat from before owners, until claimed.
  ownerEmail: string | null;
  ownerOrg: string | null;
  createdAt: string;
  updatedAt: string;
}

const sessionOf = (r: Row): SessionRecord => ({
  id: str(r.id),
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
  claudeSessionId: str(r.claude_session_id),
  turns: num(r.turns),
  status: str(r.status) as SessionStatus,
  statusReason: strOrNull(r.status_reason),
  lastSeq: num(r.last_seq),
  pendingPrompt: strOrNull(r.pending_prompt),
  ownerEmail: strOrNull(r.owner_email),
  ownerOrg: strOrNull(r.owner_org),
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
});

export type NewSession = Pick<
  SessionRecord,
  "id" | "title" | "source" | "repository" | "repositoryId" | "branch" | "model" | "effort" | "mode" | "workspacePath" | "claudeSessionId" | "status" | "pendingPrompt" | "ownerEmail" | "ownerOrg"
>;

// Whose records are asked for: an account's email in its organization.
export interface Owner {
  email: string;
  org: string;
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
  constructor(private readonly database: Database) {}

  create(s: NewSession): SessionRecord {
    const now = new Date().toISOString();
    this.database.db
      .prepare(
        "INSERT INTO sessions (id, title, source, repository, repository_id, branch, model, effort, mode, workspace_path, claude_session_id, status, pending_prompt, owner_email, owner_org, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(s.id, s.title, s.source, s.repository ?? "", s.repositoryId, s.branch ?? "", s.model, s.effort, s.mode, s.workspacePath, s.claudeSessionId, s.status, s.pendingPrompt, s.ownerEmail, s.ownerOrg, now, now);
    return this.get(s.id) as SessionRecord;
  }

  // The chats an account owns, and those shared with its email -- newest first.
  visibleTo(o: Owner): SessionRecord[] {
    return (
      this.database.db
        .prepare("SELECT * FROM sessions WHERE (owner_email = ? AND owner_org = ?) OR id IN (SELECT session_id FROM session_access WHERE email = ?) ORDER BY updated_at DESC, created_at DESC")
        .all(o.email, o.org, o.email) as Row[]
    ).map(sessionOf);
  }

  // Every chat from before owners becomes this account's; how many did.
  claimUnowned(o: Owner): number {
    return Number(this.database.db.prepare("UPDATE sessions SET owner_email = ?, owner_org = ? WHERE owner_email IS NULL").run(o.email, o.org).changes);
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

// Who an owner shared a chat with, by email.
export class SessionAccessStore {
  constructor(private readonly database: Database) {}

  list(sessionId: string): AccessEntry[] {
    return (this.database.db.prepare("SELECT * FROM session_access WHERE session_id = ? ORDER BY granted_at, email").all(sessionId) as Row[]).map((r) => ({ email: str(r.email), grantedBy: str(r.granted_by), grantedAt: str(r.granted_at) }));
  }

  has(sessionId: string, email: string): boolean {
    return this.database.db.prepare("SELECT 1 FROM session_access WHERE session_id = ? AND email = ?").get(sessionId, email) !== undefined;
  }

  // The whole list, as the owner gave it: who was already on it keeps when they were added.
  set(sessionId: string, emails: readonly string[], grantedBy: string): void {
    const now = new Date().toISOString();
    this.database.transaction(() => {
      const kept = new Set(emails);
      for (const e of this.list(sessionId)) if (!kept.has(e.email)) this.database.db.prepare("DELETE FROM session_access WHERE session_id = ? AND email = ?").run(sessionId, e.email);
      for (const email of emails) this.database.db.prepare("INSERT INTO session_access (session_id, email, granted_by, granted_at) VALUES (?, ?, ?, ?) ON CONFLICT(session_id, email) DO NOTHING").run(sessionId, email, grantedBy, now);
    });
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

export interface ImageRecord extends ImageRef {
  ownerEmail: string;
  ownerOrg: string;
  sha256: string;
  // The chat that claimed it (a message named it), and the message it went with, at its place: null until then.
  sessionId: string | null;
  messageId: string | null;
  position: number | null;
  createdAt: string;
}

const intOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

const imageOf = (r: Row): ImageRecord => ({
  id: str(r.id),
  mediaType: str(r.media_type) as ImageMediaType,
  width: intOrNull(r.width),
  height: intOrNull(r.height),
  bytes: num(r.byte_size),
  ownerEmail: str(r.owner_email),
  ownerOrg: str(r.owner_org),
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
  constructor(private readonly database: Database) {}

  insert(i: Omit<ImageRecord, "sessionId" | "messageId" | "position">): void {
    this.database.db
      .prepare("INSERT INTO images (id, owner_email, owner_org, media_type, byte_size, width, height, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(i.id, i.ownerEmail, i.ownerOrg, i.mediaType, i.bytes, i.width, i.height, i.sha256, i.createdAt);
  }

  get(id: string): ImageRecord | null {
    const r = this.database.db.prepare("SELECT * FROM images WHERE id = ?").get(id) as Row | undefined;
    return r ? imageOf(r) : null;
  }

  // Claimed for a chat, still unsent: an image a chat claimed stays that chat's.
  claim(ids: readonly string[], sessionId: string): void {
    this.database.transaction(() => {
      for (const id of ids) this.database.db.prepare("UPDATE images SET session_id = ? WHERE id = ? AND message_id IS NULL AND (session_id IS NULL OR session_id = ?)").run(sessionId, id, sessionId);
    });
  }

  // Sent with a message, in the order named.
  attach(ids: readonly string[], sessionId: string, messageId: string): void {
    this.database.transaction(() => {
      ids.forEach((id, position) => this.database.db.prepare("UPDATE images SET message_id = ?, position = ? WHERE id = ? AND session_id = ? AND message_id IS NULL").run(messageId, position, id, sessionId));
    });
  }

  // A chat's images claimed and not yet sent (a new chat's first message), in the order they were uploaded.
  pending(sessionId: string): ImageRecord[] {
    return (this.database.db.prepare("SELECT * FROM images WHERE session_id = ? AND message_id IS NULL ORDER BY created_at, rowid").all(sessionId) as Row[]).map(imageOf);
  }

  // The images sent in a chat, by message and place.
  sentIn(sessionId: string): ImageRecord[] {
    return (this.database.db.prepare("SELECT * FROM images WHERE session_id = ? AND message_id IS NOT NULL ORDER BY message_id, position").all(sessionId) as Row[]).map(imageOf);
  }

  // Every image of a chat, sent or not: what goes with it.
  idsOf(sessionId: string): string[] {
    return (this.database.db.prepare("SELECT id FROM images WHERE session_id = ?").all(sessionId) as Row[]).map((r) => str(r.id));
  }

  // Uploads no chat claimed since `before`.
  unclaimedSince(before: string): string[] {
    return (this.database.db.prepare("SELECT id FROM images WHERE session_id IS NULL AND created_at < ?").all(before) as Row[]).map((r) => str(r.id));
  }

  known(ids: readonly string[]): Set<string> {
    if (ids.length === 0) return new Set();
    return new Set((this.database.db.prepare("SELECT id FROM images WHERE id IN (SELECT value FROM json_each(?))").all(JSON.stringify(ids)) as Row[]).map((r) => str(r.id)));
  }

  remove(ids: readonly string[]): void {
    if (ids.length === 0) return;
    this.database.db.prepare("DELETE FROM images WHERE id IN (SELECT value FROM json_each(?))").run(JSON.stringify(ids));
  }
}

// THE JOURNAL of the session streams: every durable event, in order, per chat. A durable event's id is
// `<session>:<seq>` -- the same whether it is delivered live or replayed.
export class EventStore {
  constructor(private readonly database: Database) {}

  // Gives the event the session's next sequence number, in the same transaction that stores it: a number is never
  // handed out twice, across restarts too.
  append<T extends DurableEventType>(sessionId: string, type: T, data: EventDataMap[T], runId: string | null): AnySessionEvent {
    const at = new Date().toISOString();
    return this.database.transaction(() => {
      const row = this.database.db.prepare("UPDATE sessions SET last_seq = last_seq + 1 WHERE id = ? RETURNING last_seq").get(sessionId) as Row | undefined;
      if (!row) throw new Error(`no session ${sessionId}`);
      const seq = num(row.last_seq);
      this.database.db.prepare("INSERT INTO events (session_id, seq, run_id, type, data, at) VALUES (?, ?, ?, ?, ?, ?)").run(sessionId, seq, runId, type, JSON.stringify(data), at);
      return { id: `${sessionId}:${seq}`, type, stream: "session", sessionId, seq, runId, at, data } as AnySessionEvent;
    });
  }

  since(sessionId: string, afterSeq: number, limit = 10_000): AnySessionEvent[] {
    const rows = this.database.db.prepare("SELECT * FROM events WHERE session_id = ? AND seq > ? ORDER BY seq LIMIT ?").all(sessionId, afterSeq, limit) as Row[];
    return rows.map(
      (r) => ({ id: `${sessionId}:${num(r.seq)}`, type: str(r.type), stream: "session", sessionId, seq: num(r.seq), runId: strOrNull(r.run_id), at: str(r.at), data: JSON.parse(str(r.data)) }) as AnySessionEvent,
    );
  }
}

// What a chat's repository brings (skills, commands, agents, plugins), as read on its workspace's first fetch.
export class ProjectStore {
  constructor(private readonly database: Database) {}

  get(sessionId: string): ProjectInventory | null {
    const row = this.database.db.prepare("SELECT data FROM project_inventories WHERE session_id = ?").get(sessionId) as Row | undefined;
    return row ? (JSON.parse(str(row.data)) as ProjectInventory) : null;
  }

  set(sessionId: string, inventory: ProjectInventory): void {
    this.database.db
      .prepare("INSERT INTO project_inventories (session_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
      .run(sessionId, JSON.stringify(inventory), new Date().toISOString());
  }

  list(): { sessionId: string; inventory: ProjectInventory }[] {
    return (this.database.db.prepare("SELECT session_id, data FROM project_inventories ORDER BY updated_at DESC").all() as Row[]).map((r) => ({
      sessionId: str(r.session_id),
      inventory: JSON.parse(str(r.data)) as ProjectInventory,
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
  constructor(private readonly database: Database) {}

  start(r: Pick<RunRecord, "id" | "sessionId" | "model" | "resumed"> & { effort: string; mode: string }): void {
    this.database.db
      .prepare("INSERT INTO runs (id, session_id, status, model, effort, mode, resumed, started_at) VALUES (?, ?, 'running', ?, ?, ?, ?, ?)")
      .run(r.id, r.sessionId, r.model, r.effort, r.mode, r.resumed ? 1 : 0, new Date().toISOString());
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
  includeTools: Number(r.include_tools) === 1,
  snapshot: JSON.parse(str(r.data)) as SharedChat,
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
});

export class ShareStore {
  constructor(private readonly database: Database) {}

  get(sessionId: string): ShareRecord | null {
    const row = this.database.db.prepare("SELECT * FROM shares WHERE session_id = ?").get(sessionId) as Row | undefined;
    return row ? shareOf(row) : null;
  }

  byToken(token: string): ShareRecord | null {
    const row = this.database.db.prepare("SELECT * FROM shares WHERE token = ?").get(token) as Row | undefined;
    return row ? shareOf(row) : null;
  }

  // A new snapshot under the chat's link (made on its first share, kept by every update).
  put(sessionId: string, token: string, includeTools: boolean, snapshot: SharedChat): ShareRecord {
    const now = new Date().toISOString();
    this.database.db
      .prepare(
        "INSERT INTO shares (session_id, token, include_tools, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET include_tools = excluded.include_tools, data = excluded.data, updated_at = excluded.updated_at",
      )
      .run(sessionId, token, includeTools ? 1 : 0, JSON.stringify(snapshot), now, now);
    return this.get(sessionId) as ShareRecord;
  }

  delete(sessionId: string): void {
    this.database.db.prepare("DELETE FROM shares WHERE session_id = ?").run(sessionId);
  }
}
