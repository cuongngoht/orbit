// WHAT A PROFILE DRAFT KEEPS (Executive, infrastructure; ADR 0062): what the owner described, the CEO's turn that drafts
// it, and -- once, when that turn ends -- the draft Orbit read from the answer, or why there is none. Every read and write
// is scoped by the account; a draft leaves `drafting` once (a compare-and-set on the state).
import { Inject, Injectable } from "@nestjs/common";
import type { DraftState, ProfileDraft, ProfileDraftView } from "@orbit-web/contracts";
import { Db, jsonParam, type Row } from "../../../infra/db/db.js";

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : new Date(String(v)).toISOString());

export interface DraftRecord {
  id: string;
  orbitId: string;
  conversationId: string;
  turnId: string;
  userId: string;
  description: string;
  title: string;
  departmentId: string | null;
  state: DraftState;
  draft: ProfileDraft | null;
  problems: string[];
  createdAt: string;
  endedAt: string | null;
}

const draftOf = (r: Row): DraftRecord => ({
  id: String(r.id),
  orbitId: String(r.account_id),
  conversationId: String(r.conversation_id),
  turnId: String(r.turn_id),
  userId: String(r.requested_by_user),
  description: String(r.description),
  title: String(r.title),
  departmentId: r.department_id === null ? null : String(r.department_id),
  state: String(r.state) as DraftState,
  draft: (r.draft as ProfileDraft | null) ?? null,
  problems: Array.isArray(r.problems) ? (r.problems as unknown[]).map(String) : [],
  createdAt: iso(r.created_at) as string,
  endedAt: iso(r.ended_at),
});

export const draftView = (d: DraftRecord): ProfileDraftView => ({ id: d.id, state: d.state, description: d.description, conversationId: d.conversationId, turnId: d.turnId, draft: d.draft, problems: d.problems, createdAt: d.createdAt, endedAt: d.endedAt });

@Injectable()
export class DraftRepository {
  constructor(@Inject(Db) private readonly db: Db) {}

  async insert(d: Pick<DraftRecord, "id" | "orbitId" | "conversationId" | "turnId" | "userId" | "description" | "title" | "departmentId" | "createdAt">): Promise<DraftRecord> {
    const row = await this.db.one(
      `INSERT INTO executive.profile_drafts (id, account_id, conversation_id, turn_id, requested_by_user, description, title, department_id, state, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'drafting', $9) RETURNING *`,
      [d.id, d.orbitId, d.conversationId, d.turnId, d.userId, d.description, d.title, d.departmentId, d.createdAt],
    );
    return draftOf(row as Row);
  }

  async get(orbitId: string, id: string): Promise<DraftRecord | null> {
    const row = await this.db.one("SELECT * FROM executive.profile_drafts WHERE account_id = $1 AND id = $2", [orbitId, id]);
    return row === null ? null : draftOf(row);
  }

  async ofTurn(orbitId: string, turnId: string, lock = false): Promise<DraftRecord | null> {
    const row = await this.db.one(`SELECT * FROM executive.profile_drafts WHERE account_id = $1 AND turn_id = $2${lock ? " FOR UPDATE" : ""}`, [orbitId, turnId]);
    return row === null ? null : draftOf(row);
  }

  // Leaves `drafting` once: null when it already had.
  async end(orbitId: string, id: string, set: { state: Exclude<DraftState, "drafting">; draft: ProfileDraft | null; problems: string[]; at: string }): Promise<DraftRecord | null> {
    const row = await this.db.one(
      `UPDATE executive.profile_drafts SET state = $3, draft = $4::jsonb, problems = $5::jsonb, ended_at = $6, version = version + 1
       WHERE account_id = $1 AND id = $2 AND state = 'drafting' RETURNING *`,
      [orbitId, id, set.state, set.draft === null ? null : jsonParam(set.draft), jsonParam(set.problems), set.at],
    );
    return row === null ? null : draftOf(row);
  }
}
