// What research keeps of its evidence: verified citations (each with a copy of the passage it verified), notes and
// findings. Nothing else writes these tables. Each row carries its workspace's account, taken from the workspace's row
// when it is written: a citation, a note or a finding of another account's workspace cannot be made.
import type { FindingStatus, PassageMatch } from "@orbit-web/contracts";
import { Db } from "../../../infra/db/db.js";
import { now, num, numOrNull, str, strOrNull, type Row } from "./rows.js";

export interface CitationRecord {
  id: string;
  workspaceId: string;
  sessionId: string | null;
  runId: string | null;
  messageId: string | null;
  label: string;
  sourceId: string;
  revisionId: string;
  revisionNumber: number | null;
  chunkOrdinal: number;
  page: number | null;
  section: string | null;
  charStart: number;
  charEnd: number;
  sourceTitle: string;
  quote: string;
  match: PassageMatch;
  rank: number;
  score: number | null;
  createdAt: string;
}

export interface NoteRecord {
  id: string;
  workspaceId: string;
  sessionId: string | null;
  title: string;
  body: string;
  sourceId: string | null;
  citationId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface FindingRecord {
  id: string;
  workspaceId: string;
  sessionId: string | null;
  number: number;
  title: string;
  statement: string;
  status: FindingStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

const citationOf = (r: Row): CitationRecord => ({
  id: str(r.id),
  workspaceId: str(r.workspace_id),
  sessionId: strOrNull(r.session_id),
  runId: strOrNull(r.run_id),
  messageId: strOrNull(r.message_id),
  label: str(r.label),
  sourceId: str(r.source_id),
  revisionId: str(r.revision_id),
  revisionNumber: numOrNull(r.revision_number),
  chunkOrdinal: num(r.chunk_ordinal),
  page: numOrNull(r.page),
  section: strOrNull(r.section),
  charStart: num(r.char_start),
  charEnd: num(r.char_end),
  sourceTitle: str(r.source_title),
  quote: str(r.quote),
  match: str(r.match) as PassageMatch,
  rank: num(r.rank),
  score: numOrNull(r.score),
  createdAt: str(r.created_at),
});

const noteOf = (r: Row): NoteRecord => ({
  id: str(r.id),
  workspaceId: str(r.workspace_id),
  sessionId: strOrNull(r.session_id),
  title: str(r.title),
  body: str(r.body),
  sourceId: strOrNull(r.source_id),
  citationId: strOrNull(r.citation_id),
  createdBy: str(r.created_by),
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
});

const findingOf = (r: Row): FindingRecord => ({
  id: str(r.id),
  workspaceId: str(r.workspace_id),
  sessionId: strOrNull(r.session_id),
  number: num(r.number),
  title: str(r.title),
  statement: str(r.statement),
  status: str(r.status) as FindingStatus,
  reviewedBy: strOrNull(r.reviewed_by),
  reviewedAt: strOrNull(r.reviewed_at),
  createdBy: str(r.created_by),
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
});

export class EvidenceStore {
  constructor(private readonly db: Db) {}

  async addCitations(citations: readonly Omit<CitationRecord, "createdAt">[]): Promise<void> {
    if (citations.length === 0) return;
    const at = now();
    await this.db.tx(async () => {
      for (const c of citations) {
        await this.db.query(
          "INSERT INTO research_citations (id, account_id, workspace_id, session_id, run_id, message_id, label, source_id, revision_id, revision_number, chunk_ordinal, page, section, char_start, char_end, source_title, quote, match, rank, score, created_at) SELECT $1, w.account_id, w.id, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20 FROM research_workspaces w WHERE w.id = $2",
          [c.id, c.workspaceId, c.sessionId, c.runId, c.messageId, c.label, c.sourceId, c.revisionId, c.revisionNumber, c.chunkOrdinal, c.page, c.section, c.charStart, c.charEnd, c.sourceTitle, c.quote, c.match, c.rank, c.score, at],
        );
      }
    });
  }

  async citation(id: string): Promise<CitationRecord | null> {
    const row = await this.db.one("SELECT * FROM research_citations WHERE id = $1", [id]);
    return row === null ? null : citationOf(row);
  }

  async citations(ids: readonly string[]): Promise<Map<string, CitationRecord>> {
    if (ids.length === 0) return new Map();
    return new Map((await this.db.query("SELECT * FROM research_citations WHERE id = ANY($1::text[])", [ids])).map((r) => [str(r.id), citationOf(r)]));
  }

  async citationsOfSession(sessionId: string): Promise<CitationRecord[]> {
    return (await this.db.query("SELECT * FROM research_citations WHERE session_id = $1 ORDER BY created_at DESC, message_id, rank", [sessionId])).map(citationOf);
  }

  async citationsOfMessages(messageIds: readonly string[]): Promise<CitationRecord[]> {
    if (messageIds.length === 0) return [];
    return (await this.db.query("SELECT * FROM research_citations WHERE message_id = ANY($1::text[]) ORDER BY rank", [messageIds])).map(citationOf);
  }

  // A session is gone: the citations no note or finding refers to go with it; the others stay, without their session.
  async dropUnreferenced(workspaceId: string): Promise<void> {
    await this.db.query(
      "DELETE FROM research_citations WHERE workspace_id = $1 AND session_id IS NULL AND id NOT IN (SELECT citation_id FROM research_finding_citations) AND id NOT IN (SELECT citation_id FROM research_notes WHERE citation_id IS NOT NULL)",
      [workspaceId],
    );
  }

  async addNote(n: Omit<NoteRecord, "createdAt" | "updatedAt">): Promise<NoteRecord> {
    const at = now();
    const row = await this.db.one(
      "INSERT INTO research_notes (id, account_id, workspace_id, session_id, title, body, source_id, citation_id, created_by, created_at, updated_at) SELECT $1, w.account_id, w.id, $3, $4, $5, $6, $7, $8, $9, $9 FROM research_workspaces w WHERE w.id = $2 RETURNING *",
      [n.id, n.workspaceId, n.sessionId, n.title, n.body, n.sourceId, n.citationId, n.createdBy, at],
    );
    if (row === null) throw new Error(`no research workspace ${n.workspaceId}`);
    return noteOf(row);
  }

  async note(id: string): Promise<NoteRecord | null> {
    const row = await this.db.one("SELECT * FROM research_notes WHERE id = $1", [id]);
    return row === null ? null : noteOf(row);
  }

  async notes(workspaceId: string): Promise<NoteRecord[]> {
    return (await this.db.query("SELECT * FROM research_notes WHERE workspace_id = $1 ORDER BY updated_at DESC, created_at DESC", [workspaceId])).map(noteOf);
  }

  async updateNote(id: string, patch: { title?: string; body?: string }): Promise<NoteRecord> {
    const row = await this.db.one("UPDATE research_notes SET title = COALESCE($2, title), body = COALESCE($3, body), updated_at = $4 WHERE id = $1 RETURNING *", [id, patch.title ?? null, patch.body ?? null, now()]);
    if (row === null) throw new Error(`no research note ${id}`);
    return noteOf(row);
  }

  async deleteNote(id: string): Promise<void> {
    await this.db.query("DELETE FROM research_notes WHERE id = $1", [id]);
  }

  async addFinding(f: Omit<FindingRecord, "createdAt" | "updatedAt" | "reviewedBy" | "reviewedAt" | "status">, citationIds: readonly string[]): Promise<FindingRecord> {
    const at = now();
    return this.db.tx(async () => {
      const row = await this.db.one(
        "INSERT INTO research_findings (id, account_id, workspace_id, session_id, number, title, statement, status, created_by, created_at, updated_at) SELECT $1, w.account_id, w.id, $3, $4, $5, $6, 'draft', $7, $8, $8 FROM research_workspaces w WHERE w.id = $2 RETURNING *",
        [f.id, f.workspaceId, f.sessionId, f.number, f.title, f.statement, f.createdBy, at],
      );
      if (row === null) throw new Error(`no research workspace ${f.workspaceId}`);
      await this.writeFindingCitations(f.id, citationIds);
      return findingOf(row);
    });
  }

  async finding(id: string): Promise<FindingRecord | null> {
    const row = await this.db.one("SELECT * FROM research_findings WHERE id = $1", [id]);
    return row === null ? null : findingOf(row);
  }

  async findings(workspaceId: string): Promise<FindingRecord[]> {
    return (await this.db.query("SELECT * FROM research_findings WHERE workspace_id = $1 ORDER BY number DESC", [workspaceId])).map(findingOf);
  }

  async findingCitations(findingId: string): Promise<CitationRecord[]> {
    return (await this.db.query("SELECT c.* FROM research_finding_citations f JOIN research_citations c ON c.id = f.citation_id WHERE f.finding_id = $1 ORDER BY f.position", [findingId])).map(citationOf);
  }

  async updateFinding(id: string, patch: Partial<Pick<FindingRecord, "title" | "statement" | "status" | "reviewedBy" | "reviewedAt">>, citationIds: readonly string[] | null): Promise<FindingRecord> {
    return this.db.tx(async () => {
      const f = await this.finding(id);
      if (f === null) throw new Error(`no research finding ${id}`);
      const next = { ...f, ...patch };
      const row = await this.db.one("UPDATE research_findings SET title = $2, statement = $3, status = $4, reviewed_by = $5, reviewed_at = $6, updated_at = $7 WHERE id = $1 RETURNING *", [
        id,
        next.title,
        next.statement,
        next.status,
        next.reviewedBy,
        next.reviewedAt,
        now(),
      ]);
      if (citationIds !== null) await this.writeFindingCitations(id, citationIds);
      return findingOf(row as Row);
    });
  }

  async deleteFinding(id: string): Promise<void> {
    await this.db.query("DELETE FROM research_findings WHERE id = $1", [id]);
  }

  // The citations a finding rests on, in order; each with the finding's own account (the database refuses another's).
  private async writeFindingCitations(findingId: string, citationIds: readonly string[]): Promise<void> {
    await this.db.query("DELETE FROM research_finding_citations WHERE finding_id = $1", [findingId]);
    if (citationIds.length === 0) return;
    await this.db.query(
      "INSERT INTO research_finding_citations (account_id, finding_id, citation_id, position) SELECT f.account_id, f.id, c.citation_id, c.position - 1 FROM research_findings f, unnest($2::text[]) WITH ORDINALITY AS c(citation_id, position) WHERE f.id = $1",
      [findingId, citationIds],
    );
  }
}
