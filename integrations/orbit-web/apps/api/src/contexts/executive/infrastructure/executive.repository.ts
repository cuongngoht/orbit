// WHAT CEO CHAT KEEPS (Executive, infrastructure; ADR 0062): conversations, their messages (in a stable order, cut into
// pages by position), the turns that answer them, the missions given from them, and each conversation's own journal of
// events. Every read and write is scoped by the account; a message's place is taken from its conversation's row in the
// transaction that writes it, so two messages never share one.
import { Inject, Injectable } from "@nestjs/common";
import type { AnyExecutiveEvent, DurableExecutiveEventType, EventDataMap, ExecutiveConversationSummary, ExecutiveMessage, ExecutiveMissionLink, ExecutiveReport, ExecutiveTurn, ExecutiveTurnState, MissionProposal, ProposalState } from "@orbit-web/contracts";
import { Db, jsonParam, type Row } from "../../../infra/db/db.js";

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : new Date(String(v)).toISOString());
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export interface ConversationRecord {
  id: string;
  orbitId: string;
  officeId: string;
  title: string;
  lastSeq: number;
  messages: number;
  createdAt: string;
  lastMessageAt: string | null;
}

export interface NewMessage {
  id: string;
  orbitId: string;
  conversationId: string;
  role: "owner" | "ceo" | "system";
  authorName: string;
  userId?: string | null;
  employeeId?: string | null;
  appointmentId?: string | null;
  appointmentRevision?: number | null;
  text: string;
  partial?: boolean;
  model?: string | null;
  effort?: string | null;
  report?: ExecutiveReport | null;
  proposal?: MissionProposal | null;
  proposalNote?: string | null;
  missionId?: string | null;
  turnId?: string | null;
  noticeKey?: string | null;
  at: string;
}

export interface TurnRecord {
  id: string;
  orbitId: string;
  conversationId: string;
  requestMessageId: string;
  responseMessageId: string | null;
  employeeId: string;
  authorName: string;
  appointmentId: string;
  appointmentRevision: number;
  runId: string | null;
  state: ExecutiveTurnState;
  waitingReason: string | null;
  code: string | null;
  detail: string | null;
  records: string[];
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  version: number;
}

const conversationOf = (r: Row): ConversationRecord => ({
  id: String(r.id),
  orbitId: String(r.account_id),
  officeId: String(r.office_id),
  title: String(r.title),
  lastSeq: Number(r.last_seq),
  messages: Number(r.messages),
  createdAt: iso(r.created_at) as string,
  lastMessageAt: iso(r.last_message_at),
});

export const summaryOf = (c: ConversationRecord): ExecutiveConversationSummary => ({ id: c.id, title: c.title, messages: c.messages, createdAt: c.createdAt, lastMessageAt: c.lastMessageAt });

export const turnOf = (r: Row): TurnRecord => ({
  id: String(r.id),
  orbitId: String(r.account_id),
  conversationId: String(r.conversation_id),
  requestMessageId: String(r.request_message_id),
  responseMessageId: strOrNull(r.response_message_id),
  employeeId: String(r.employee_id),
  authorName: String(r.author_name),
  appointmentId: String(r.appointment_id),
  appointmentRevision: Number(r.appointment_revision),
  runId: strOrNull(r.run_id),
  state: String(r.state) as ExecutiveTurnState,
  waitingReason: strOrNull(r.waiting_reason),
  code: strOrNull(r.code),
  detail: strOrNull(r.detail),
  records: Array.isArray((r.context as { records?: unknown } | null)?.records) ? ((r.context as { records: unknown[] }).records.map(String)) : [],
  createdAt: iso(r.created_at) as string,
  startedAt: iso(r.started_at),
  endedAt: iso(r.ended_at),
  version: Number(r.version),
});

export const turnView = (t: TurnRecord): ExecutiveTurn => ({
  id: t.id,
  conversationId: t.conversationId,
  state: t.state,
  requestMessageId: t.requestMessageId,
  responseMessageId: t.responseMessageId,
  employeeId: t.employeeId,
  authorName: t.authorName,
  appointmentId: t.appointmentId,
  appointmentRevision: t.appointmentRevision,
  waitingReason: t.waitingReason,
  code: t.code,
  detail: t.detail,
  records: t.records,
  createdAt: t.createdAt,
  startedAt: t.startedAt,
  endedAt: t.endedAt,
});

// A message as a page shows it: `author.current` says whether the CEO who wrote it is still the CEO in office.
export function messageView(r: Row, currentAppointmentId: string | null): ExecutiveMessage {
  const appointmentId = strOrNull(r.appointment_id);
  return {
    id: String(r.id),
    conversationId: String(r.conversation_id),
    position: Number(r.position),
    role: String(r.role) as ExecutiveMessage["role"],
    author: {
      name: String(r.author_name),
      userId: strOrNull(r.user_id),
      employeeId: strOrNull(r.employee_id),
      appointmentId,
      appointmentRevision: r.appointment_revision === null ? null : Number(r.appointment_revision),
      current: appointmentId !== null && appointmentId === currentAppointmentId,
    },
    text: String(r.text),
    partial: r.partial === true,
    model: strOrNull(r.model),
    report: (r.report as ExecutiveReport | null) ?? null,
    proposal: (r.proposal as MissionProposal | null) ?? null,
    proposalState: (strOrNull(r.proposal_state) as ProposalState | null) ?? null,
    proposalNote: strOrNull(r.proposal_note),
    missionId: strOrNull(r.mission_id),
    turnId: strOrNull(r.turn_id),
    createdAt: iso(r.created_at) as string,
  };
}

@Injectable()
export class ExecutiveRepository {
  constructor(@Inject(Db) private readonly db: Db) {}

  // ---- conversations ------------------------------------------------------------------------------------------------

  async insertConversation(c: { id: string; orbitId: string; officeId: string; title: string; userId: string; at: string }): Promise<ConversationRecord> {
    const row = await this.db.one("INSERT INTO executive.conversations (id, account_id, office_id, title, created_by_user, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING *", [c.id, c.orbitId, c.officeId, c.title, c.userId, c.at]);
    return conversationOf(row as Row);
  }

  async conversation(orbitId: string, id: string, lock = false): Promise<ConversationRecord | null> {
    const row = await this.db.one(`SELECT * FROM executive.conversations WHERE account_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [orbitId, id]);
    return row === null ? null : conversationOf(row);
  }

  // Newest first, by their last message; a page ends where `cursor` (`<at>~<id>`, from the page before) says.
  async conversations(orbitId: string, cursor: string | null, limit = 30): Promise<{ items: ConversationRecord[]; next: string | null }> {
    const [at, id] = cursor === null ? [null, null] : cursor.split("~");
    const rows = await this.db.query(
      `SELECT * FROM executive.conversations WHERE account_id = $1
         AND ($2::timestamptz IS NULL OR (COALESCE(last_message_at, created_at), id) < ($2::timestamptz, $3::uuid))
       ORDER BY COALESCE(last_message_at, created_at) DESC, id DESC LIMIT $4`,
      [orbitId, at ?? null, id ?? null, limit + 1],
    );
    const items = rows.slice(0, limit).map(conversationOf);
    const last = items.at(-1);
    return { items, next: rows.length > limit && last !== undefined ? `${last.lastMessageAt ?? last.createdAt}~${last.id}` : null };
  }

  // ---- messages -----------------------------------------------------------------------------------------------------

  // Its place is the conversation's next one (taken under the conversation's row); a notice already written (its key)
  // is not written twice: null then.
  async addMessage(m: NewMessage): Promise<Row | null> {
    if (m.noticeKey) {
      const seen = await this.db.one("SELECT 1 AS x FROM executive.messages WHERE account_id = $1 AND notice_key = $2", [m.orbitId, m.noticeKey]);
      if (seen !== null) return null;
    }
    const place = await this.db.one(
      "UPDATE executive.conversations SET next_position = next_position + 1, messages = messages + 1, last_message_at = $3, updated_at = $3, version = version + 1 WHERE account_id = $1 AND id = $2 RETURNING next_position - 1 AS position",
      [m.orbitId, m.conversationId, m.at],
    );
    if (place === null) throw new Error(`no conversation ${m.conversationId}`);
    return this.db.one(
      `INSERT INTO executive.messages (id, account_id, conversation_id, position, role, author_name, user_id, employee_id, appointment_id, appointment_revision, text, partial, model, effort, report, proposal, proposal_state, proposal_note, mission_id, turn_id, notice_key, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16::jsonb, $17, $18, $19, $20, $21, $22) RETURNING *`,
      [
        m.id,
        m.orbitId,
        m.conversationId,
        Number(place.position),
        m.role,
        m.authorName,
        m.userId ?? null,
        m.employeeId ?? null,
        m.appointmentId ?? null,
        m.appointmentRevision ?? null,
        m.text,
        m.partial ?? false,
        m.model ?? null,
        m.effort ?? null,
        m.report === undefined || m.report === null ? null : jsonParam(m.report),
        m.proposal === undefined || m.proposal === null ? null : jsonParam(m.proposal),
        m.proposal === undefined || m.proposal === null ? null : "open",
        m.proposalNote ?? null,
        m.missionId ?? null,
        m.turnId ?? null,
        m.noticeKey ?? null,
        m.at,
      ],
    );
  }

  async message(orbitId: string, id: string, lock = false): Promise<Row | null> {
    return this.db.one(`SELECT * FROM executive.messages WHERE account_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [orbitId, id]);
  }

  // The page that ends before `before` (null: the last page), oldest first.
  async page(orbitId: string, conversationId: string, before: number | null, limit: number): Promise<{ rows: Row[]; hasOlder: boolean }> {
    const rows = await this.db.query(
      "SELECT * FROM executive.messages WHERE account_id = $1 AND conversation_id = $2 AND ($3::bigint IS NULL OR position < $3) ORDER BY position DESC LIMIT $4",
      [orbitId, conversationId, before, limit + 1],
    );
    return { rows: rows.slice(0, limit).reverse(), hasOlder: rows.length > limit };
  }

  // The last `limit` messages up to (and with) a position, oldest first: what a turn is given of the conversation.
  async history(orbitId: string, conversationId: string, through: number, limit: number): Promise<Row[]> {
    return (await this.db.query("SELECT * FROM executive.messages WHERE account_id = $1 AND conversation_id = $2 AND position <= $3 ORDER BY position DESC LIMIT $4", [orbitId, conversationId, through, limit])).reverse();
  }

  async setProposal(orbitId: string, messageId: string, state: ProposalState, missionId: string | null): Promise<Row | null> {
    return this.db.one("UPDATE executive.messages SET proposal_state = $3, mission_id = COALESCE($4, mission_id), version = version + 1 WHERE account_id = $1 AND id = $2 AND proposal IS NOT NULL RETURNING *", [orbitId, messageId, state, missionId]);
  }

  // ---- turns --------------------------------------------------------------------------------------------------------

  async insertTurn(t: { id: string; orbitId: string; conversationId: string; requestMessageId: string; employeeId: string; authorName: string; appointmentId: string; appointmentRevision: number; state: ExecutiveTurnState; runId: string | null; at: string }): Promise<TurnRecord> {
    const row = await this.db.one(
      `INSERT INTO executive.turns (id, account_id, conversation_id, request_message_id, employee_id, author_name, appointment_id, appointment_revision, run_id, state, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11) RETURNING *`,
      [t.id, t.orbitId, t.conversationId, t.requestMessageId, t.employeeId, t.authorName, t.appointmentId, t.appointmentRevision, t.runId, t.state, t.at],
    );
    return turnOf(row as Row);
  }

  async turn(orbitId: string, id: string, lock = false): Promise<TurnRecord | null> {
    const row = await this.db.one(`SELECT * FROM executive.turns WHERE account_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [orbitId, id]);
    return row === null ? null : turnOf(row);
  }

  async turnOfRun(orbitId: string, runId: string, lock = false): Promise<TurnRecord | null> {
    const row = await this.db.one(`SELECT * FROM executive.turns WHERE account_id = $1 AND run_id = $2${lock ? " FOR UPDATE" : ""}`, [orbitId, runId]);
    return row === null ? null : turnOf(row);
  }

  // The turns not ended, oldest first, and the last one that ended.
  async recentTurns(orbitId: string, conversationId: string): Promise<TurnRecord[]> {
    const open = await this.db.query("SELECT * FROM executive.turns WHERE account_id = $1 AND conversation_id = $2 AND state IN ('queued', 'waiting', 'running') ORDER BY created_at", [orbitId, conversationId]);
    const last = await this.db.one("SELECT * FROM executive.turns WHERE account_id = $1 AND conversation_id = $2 AND state NOT IN ('queued', 'waiting', 'running') ORDER BY ended_at DESC NULLS LAST, created_at DESC LIMIT 1", [orbitId, conversationId]);
    return [...(last === null ? [] : [turnOf(last)]), ...open.map(turnOf)];
  }

  async openTurns(orbitId: string, conversationId: string, lock = false): Promise<TurnRecord[]> {
    return (await this.db.query(`SELECT * FROM executive.turns WHERE account_id = $1 AND conversation_id = $2 AND state IN ('queued', 'waiting', 'running') ORDER BY created_at${lock ? " FOR UPDATE" : ""}`, [orbitId, conversationId])).map(turnOf);
  }

  // The oldest turn of a conversation that waits behind its running one (queued, with no run yet).
  async nextQueued(orbitId: string, conversationId: string): Promise<TurnRecord | null> {
    const row = await this.db.one("SELECT * FROM executive.turns WHERE account_id = $1 AND conversation_id = $2 AND state = 'queued' AND run_id IS NULL ORDER BY created_at LIMIT 1 FOR UPDATE", [orbitId, conversationId]);
    return row === null ? null : turnOf(row);
  }

  async updateTurn(orbitId: string, id: string, from: readonly ExecutiveTurnState[], set: { state?: ExecutiveTurnState; requestMessageId?: string; responseMessageId?: string; runId?: string; waitingReason?: string | null; code?: string | null; detail?: string | null; records?: string[]; startedAt?: string; endedAt?: string }): Promise<TurnRecord | null> {
    const sets = ["updated_at = now()", "version = version + 1"];
    const params: unknown[] = [orbitId, id, [...from]];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      sets.push(sql.replace("?", `$${params.length}`));
    };
    if (set.state !== undefined) add("state = ?", set.state);
    if (set.requestMessageId !== undefined) add("request_message_id = ?", set.requestMessageId);
    if (set.responseMessageId !== undefined) add("response_message_id = ?", set.responseMessageId);
    if (set.runId !== undefined) add("run_id = ?", set.runId);
    if (set.waitingReason !== undefined) add("waiting_reason = ?", set.waitingReason);
    if (set.code !== undefined) add("code = ?", set.code);
    if (set.detail !== undefined) add("detail = ?", set.detail === null ? null : set.detail.slice(0, 2000));
    if (set.records !== undefined) add("context = ?::jsonb", jsonParam({ records: set.records }));
    if (set.startedAt !== undefined) add("started_at = ?", set.startedAt);
    if (set.endedAt !== undefined) add("ended_at = ?", set.endedAt);
    const row = await this.db.one(`UPDATE executive.turns SET ${sets.join(", ")} WHERE account_id = $1 AND id = $2 AND state = ANY($3) RETURNING *`, params as never);
    return row === null ? null : turnOf(row);
  }

  // ---- missions given from a conversation ---------------------------------------------------------------------------

  async link(l: { orbitId: string; missionId: string; conversationId: string; messageId: string; by: string; at: string }): Promise<boolean> {
    return (await this.db.run("INSERT INTO executive.mission_links (account_id, mission_id, conversation_id, message_id, linked_by, linked_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (account_id, mission_id) DO NOTHING", [l.orbitId, l.missionId, l.conversationId, l.messageId, l.by, l.at])) > 0;
  }

  async links(orbitId: string, conversationId: string): Promise<ExecutiveMissionLink[]> {
    const rows = await this.db.query(
      "SELECT l.mission_id, l.message_id, l.linked_at, m.title FROM executive.mission_links l JOIN workforce.missions m ON m.account_id = l.account_id AND m.id = l.mission_id WHERE l.account_id = $1 AND l.conversation_id = $2 ORDER BY l.linked_at",
      [orbitId, conversationId],
    );
    return rows.map((r) => ({ missionId: String(r.mission_id), messageId: String(r.message_id), title: String(r.title), linkedAt: iso(r.linked_at) as string }));
  }

  // The conversation a mission was given from (null: none), with the mission's title and root assignment.
  async linkOfMission(orbitId: string, missionId: string): Promise<{ conversationId: string; title: string; rootAssignmentId: string | null } | null> {
    const r = await this.db.one(
      `SELECT l.conversation_id, m.title, (SELECT a.id FROM workforce.assignments a WHERE a.account_id = m.account_id AND a.mission_id = m.id AND a.parent_id IS NULL) AS root
       FROM executive.mission_links l JOIN workforce.missions m ON m.account_id = l.account_id AND m.id = l.mission_id WHERE l.account_id = $1 AND l.mission_id = $2`,
      [orbitId, missionId],
    );
    return r === null ? null : { conversationId: String(r.conversation_id), title: String(r.title), rootAssignmentId: strOrNull(r.root) };
  }

  // ---- the journal --------------------------------------------------------------------------------------------------

  // A durable event takes the conversation's next sequence number (its row held until the transaction ends).
  async append<T extends DurableExecutiveEventType>(orbitId: string, conversationId: string, type: T, data: EventDataMap[T], turnId: string | null): Promise<AnyExecutiveEvent> {
    const at = new Date().toISOString();
    return this.db.tx(async () => {
      const row = await this.db.one("UPDATE executive.conversations SET last_seq = last_seq + 1 WHERE account_id = $1 AND id = $2 RETURNING last_seq", [orbitId, conversationId]);
      if (row === null) throw new Error(`no conversation ${conversationId}`);
      const seq = Number(row.last_seq);
      await this.db.query("INSERT INTO executive.events (account_id, conversation_id, seq, turn_id, type, data, at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)", [orbitId, conversationId, seq, turnId, type, jsonParam(data), at]);
      return { id: `${conversationId}:${seq}`, type, stream: "executive", sessionId: conversationId, seq, runId: turnId, at, data } as AnyExecutiveEvent;
    });
  }

  async since(conversationId: string, after: number, limit = 1000, until: number | null = null): Promise<AnyExecutiveEvent[]> {
    const rows =
      until === null
        ? await this.db.query("SELECT * FROM executive.events WHERE conversation_id = $1 AND seq > $2 ORDER BY seq LIMIT $3", [conversationId, after, limit])
        : await this.db.query("SELECT * FROM executive.events WHERE conversation_id = $1 AND seq > $2 AND seq <= $3 ORDER BY seq LIMIT $4", [conversationId, after, until, limit]);
    return rows.map((r) => ({ id: `${conversationId}:${String(r.seq)}`, type: String(r.type), stream: "executive", sessionId: conversationId, seq: Number(r.seq), runId: strOrNull(r.turn_id), at: iso(r.at) as string, data: r.data }) as AnyExecutiveEvent);
  }

  async head(conversationId: string): Promise<number> {
    return Number((await this.db.one("SELECT last_seq FROM executive.conversations WHERE id = $1", [conversationId]))?.last_seq ?? 0);
  }
}
