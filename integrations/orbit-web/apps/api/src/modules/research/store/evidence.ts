// What research keeps of its evidence: verified citations (each with a copy of the passage it verified), notes and
// findings. Nothing else writes these tables.
import type { FindingStatus, PassageMatch } from "@orbit-web/contracts";
import type { Database } from "../../../infra/storage/database.js";
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
  constructor(private readonly database: Database) {}

  addCitations(citations: readonly Omit<CitationRecord, "createdAt">[]): void {
    const at = now();
    const insert = this.database.db.prepare(
      "INSERT INTO research_citations (id, workspace_id, session_id, run_id, message_id, label, source_id, revision_id, revision_number, chunk_ordinal, page, section, char_start, char_end, source_title, quote, match, rank, score, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    this.database.transaction(() => {
      for (const c of citations) insert.run(c.id, c.workspaceId, c.sessionId, c.runId, c.messageId, c.label, c.sourceId, c.revisionId, c.revisionNumber, c.chunkOrdinal, c.page, c.section, c.charStart, c.charEnd, c.sourceTitle, c.quote, c.match, c.rank, c.score, at);
    });
  }

  citation(id: string): CitationRecord | null {
    const row = this.database.db.prepare("SELECT * FROM research_citations WHERE id = ?").get(id) as Row | undefined;
    return row ? citationOf(row) : null;
  }

  citationsOfSession(sessionId: string): CitationRecord[] {
    return (this.database.db.prepare("SELECT * FROM research_citations WHERE session_id = ? ORDER BY created_at DESC, message_id, rank").all(sessionId) as Row[]).map(citationOf);
  }

  citationsOfMessages(messageIds: readonly string[]): CitationRecord[] {
    return (this.database.db.prepare("SELECT * FROM research_citations WHERE message_id IN (SELECT value FROM json_each(?)) ORDER BY rank").all(JSON.stringify(messageIds)) as Row[]).map(citationOf);
  }

  // A session is gone: the citations no note or finding refers to go with it; the others stay, without their session.
  dropUnreferenced(workspaceId: string): void {
    this.database.db
      .prepare(
        "DELETE FROM research_citations WHERE workspace_id = ? AND session_id IS NULL AND id NOT IN (SELECT citation_id FROM research_finding_citations) AND id NOT IN (SELECT citation_id FROM research_notes WHERE citation_id IS NOT NULL)",
      )
      .run(workspaceId);
  }

  addNote(n: Omit<NoteRecord, "createdAt" | "updatedAt">): NoteRecord {
    const at = now();
    this.database.db
      .prepare("INSERT INTO research_notes (id, workspace_id, session_id, title, body, source_id, citation_id, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(n.id, n.workspaceId, n.sessionId, n.title, n.body, n.sourceId, n.citationId, n.createdBy, at, at);
    return this.note(n.id) as NoteRecord;
  }

  note(id: string): NoteRecord | null {
    const row = this.database.db.prepare("SELECT * FROM research_notes WHERE id = ?").get(id) as Row | undefined;
    return row ? noteOf(row) : null;
  }

  notes(workspaceId: string): NoteRecord[] {
    return (this.database.db.prepare("SELECT * FROM research_notes WHERE workspace_id = ? ORDER BY updated_at DESC, created_at DESC").all(workspaceId) as Row[]).map(noteOf);
  }

  updateNote(id: string, patch: { title?: string; body?: string }): NoteRecord {
    const n = this.note(id) as NoteRecord;
    this.database.db.prepare("UPDATE research_notes SET title = ?, body = ?, updated_at = ? WHERE id = ?").run(patch.title ?? n.title, patch.body ?? n.body, now(), id);
    return this.note(id) as NoteRecord;
  }

  deleteNote(id: string): void {
    this.database.db.prepare("DELETE FROM research_notes WHERE id = ?").run(id);
  }

  addFinding(f: Omit<FindingRecord, "createdAt" | "updatedAt" | "reviewedBy" | "reviewedAt" | "status">, citationIds: readonly string[]): FindingRecord {
    const at = now();
    this.database.db
      .prepare("INSERT INTO research_findings (id, workspace_id, session_id, number, title, statement, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)")
      .run(f.id, f.workspaceId, f.sessionId, f.number, f.title, f.statement, f.createdBy, at, at);
    this.writeFindingCitations(f.id, citationIds);
    return this.finding(f.id) as FindingRecord;
  }

  finding(id: string): FindingRecord | null {
    const row = this.database.db.prepare("SELECT * FROM research_findings WHERE id = ?").get(id) as Row | undefined;
    return row ? findingOf(row) : null;
  }

  findings(workspaceId: string): FindingRecord[] {
    return (this.database.db.prepare("SELECT * FROM research_findings WHERE workspace_id = ? ORDER BY number DESC").all(workspaceId) as Row[]).map(findingOf);
  }

  findingCitations(findingId: string): CitationRecord[] {
    return (this.database.db.prepare("SELECT c.* FROM research_finding_citations f JOIN research_citations c ON c.id = f.citation_id WHERE f.finding_id = ? ORDER BY f.position").all(findingId) as Row[]).map(citationOf);
  }

  updateFinding(id: string, patch: Partial<Pick<FindingRecord, "title" | "statement" | "status" | "reviewedBy" | "reviewedAt">>, citationIds: readonly string[] | null): FindingRecord {
    const f = this.finding(id) as FindingRecord;
    const next = { ...f, ...patch };
    this.database.transaction(() => {
      this.database.db
        .prepare("UPDATE research_findings SET title = ?, statement = ?, status = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?")
        .run(next.title, next.statement, next.status, next.reviewedBy, next.reviewedAt, now(), id);
      if (citationIds !== null) this.writeFindingCitations(id, citationIds);
    });
    return this.finding(id) as FindingRecord;
  }

  deleteFinding(id: string): void {
    this.database.db.prepare("DELETE FROM research_findings WHERE id = ?").run(id);
  }

  private writeFindingCitations(findingId: string, citationIds: readonly string[]): void {
    this.database.db.prepare("DELETE FROM research_finding_citations WHERE finding_id = ?").run(findingId);
    const insert = this.database.db.prepare("INSERT INTO research_finding_citations (finding_id, citation_id, position) VALUES (?, ?, ?)");
    citationIds.forEach((c, i) => insert.run(findingId, c, i));
  }
}
