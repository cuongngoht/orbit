// Research sources, their immutable revisions, and the chunks of each revision's text (which the full-text index
// mirrors through two triggers). Nothing else writes these tables.
import type { ResearchMediaType, ResearchSourceKind, ResearchSourceState } from "@orbit-web/contracts";
import type { Database } from "../../../infra/storage/database.js";
import { now, num, numOrNull, str, strOrNull, type Row } from "./rows.js";

export interface SourceRecord {
  id: string;
  workspaceId: string;
  kind: ResearchSourceKind;
  title: string;
  origin: string | null;
  state: ResearchSourceState;
  stateReason: string | null;
  // The indexed revision a question retrieves from; null until one is.
  currentRevisionId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type RevisionStatus = "pending" | "indexed" | "failed";

export interface RevisionRecord {
  id: string;
  sourceId: string;
  workspaceId: string;
  number: number;
  contentHash: string;
  byteSize: number;
  mediaType: ResearchMediaType;
  fileName: string | null;
  url: string | null;
  finalUrl: string | null;
  fetchedAt: string | null;
  status: RevisionStatus;
  error: string | null;
  pageCount: number | null;
  charCount: number;
  chunkCount: number;
  createdAt: string;
  indexedAt: string | null;
}

export interface ChunkDraft {
  ordinal: number;
  page: number | null;
  section: string | null;
  charStart: number;
  charEnd: number;
  text: string;
}

export interface ChunkRecord extends ChunkDraft {
  id: number;
  revisionId: string;
  sourceId: string;
  workspaceId: string;
}

const sourceOf = (r: Row): SourceRecord => ({
  id: str(r.id),
  workspaceId: str(r.workspace_id),
  kind: str(r.kind) as ResearchSourceKind,
  title: str(r.title),
  origin: strOrNull(r.origin),
  state: str(r.state) as ResearchSourceState,
  stateReason: strOrNull(r.state_reason),
  currentRevisionId: strOrNull(r.current_revision_id),
  createdBy: str(r.created_by),
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
});

const revisionOf = (r: Row): RevisionRecord => ({
  id: str(r.id),
  sourceId: str(r.source_id),
  workspaceId: str(r.workspace_id),
  number: num(r.number),
  contentHash: str(r.content_hash),
  byteSize: num(r.byte_size),
  mediaType: str(r.media_type) as ResearchMediaType,
  fileName: strOrNull(r.file_name),
  url: strOrNull(r.url),
  finalUrl: strOrNull(r.final_url),
  fetchedAt: strOrNull(r.fetched_at),
  status: str(r.status) as RevisionStatus,
  error: strOrNull(r.error),
  pageCount: numOrNull(r.page_count),
  charCount: num(r.char_count),
  chunkCount: num(r.chunk_count),
  createdAt: str(r.created_at),
  indexedAt: strOrNull(r.indexed_at),
});

export const chunkOf = (r: Row): ChunkRecord => ({
  id: num(r.id),
  revisionId: str(r.revision_id),
  sourceId: str(r.source_id),
  workspaceId: str(r.workspace_id),
  ordinal: num(r.ordinal),
  page: numOrNull(r.page),
  section: strOrNull(r.section),
  charStart: num(r.char_start),
  charEnd: num(r.char_end),
  text: str(r.text),
});

// Chunks are written in short transactions (ingestion yields between them): the one connection is never held, and the
// event loop never stopped, while a large document is indexed.
export const CHUNK_BATCH = 200;

export class SourceStore {
  constructor(private readonly database: Database) {}

  create(s: Pick<SourceRecord, "id" | "workspaceId" | "kind" | "title" | "origin" | "state" | "createdBy">): SourceRecord {
    const at = now();
    this.database.db
      .prepare("INSERT INTO research_sources (id, workspace_id, kind, title, origin, state, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(s.id, s.workspaceId, s.kind, s.title, s.origin, s.state, s.createdBy, at, at);
    return this.get(s.id) as SourceRecord;
  }

  get(id: string): SourceRecord | null {
    const row = this.database.db.prepare("SELECT * FROM research_sources WHERE id = ?").get(id) as Row | undefined;
    return row ? sourceOf(row) : null;
  }

  list(workspaceId: string): SourceRecord[] {
    return (this.database.db.prepare("SELECT * FROM research_sources WHERE workspace_id = ? ORDER BY created_at, id").all(workspaceId) as Row[]).map(sourceOf);
  }

  inState(states: readonly ResearchSourceState[]): SourceRecord[] {
    return (this.database.db.prepare("SELECT * FROM research_sources WHERE state IN (SELECT value FROM json_each(?))").all(JSON.stringify(states)) as Row[]).map(sourceOf);
  }

  setState(id: string, state: ResearchSourceState, reason: string | null): SourceRecord {
    this.database.db.prepare("UPDATE research_sources SET state = ?, state_reason = ?, updated_at = ? WHERE id = ?").run(state, reason, now(), id);
    return this.get(id) as SourceRecord;
  }

  rename(id: string, title: string): SourceRecord {
    this.database.db.prepare("UPDATE research_sources SET title = ?, updated_at = ? WHERE id = ?").run(title, now(), id);
    return this.get(id) as SourceRecord;
  }

  // The revision is indexed: it is the one retrieved from now, and the source is ready.
  promote(sourceId: string, revisionId: string): SourceRecord {
    this.database.db.prepare("UPDATE research_sources SET current_revision_id = ?, state = 'ready', state_reason = NULL, updated_at = ? WHERE id = ?").run(revisionId, now(), sourceId);
    return this.get(sourceId) as SourceRecord;
  }

  delete(id: string): void {
    this.database.transaction(() => {
      this.database.db.prepare("DELETE FROM research_chunks WHERE source_id = ?").run(id);
      this.database.db.prepare("DELETE FROM research_sources WHERE id = ?").run(id);
    });
  }

  addRevision(r: Pick<RevisionRecord, "id" | "sourceId" | "workspaceId" | "contentHash" | "byteSize" | "mediaType" | "fileName" | "url" | "finalUrl" | "fetchedAt">): RevisionRecord {
    return this.database.transaction(() => {
      const next = num((this.database.db.prepare("SELECT coalesce(max(number), 0) + 1 AS n FROM research_source_revisions WHERE source_id = ?").get(r.sourceId) as Row).n);
      this.database.db
        .prepare("INSERT INTO research_source_revisions (id, source_id, workspace_id, number, content_hash, byte_size, media_type, file_name, url, final_url, fetched_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)")
        .run(r.id, r.sourceId, r.workspaceId, next, r.contentHash, r.byteSize, r.mediaType, r.fileName, r.url, r.finalUrl, r.fetchedAt, now());
      return this.revision(r.id) as RevisionRecord;
    });
  }

  revision(id: string): RevisionRecord | null {
    const row = this.database.db.prepare("SELECT * FROM research_source_revisions WHERE id = ?").get(id) as Row | undefined;
    return row ? revisionOf(row) : null;
  }

  revisions(sourceId: string): RevisionRecord[] {
    return (this.database.db.prepare("SELECT * FROM research_source_revisions WHERE source_id = ? ORDER BY number DESC").all(sourceId) as Row[]).map(revisionOf);
  }

  pendingRevisions(): RevisionRecord[] {
    return (this.database.db.prepare("SELECT * FROM research_source_revisions WHERE status = 'pending' ORDER BY created_at").all() as Row[]).map(revisionOf);
  }

  latestRevision(sourceId: string): RevisionRecord | null {
    return this.revisions(sourceId)[0] ?? null;
  }

  // Whether any revision of the workspace still stores a file with this hash (a file is kept while one does).
  hashInUse(workspaceId: string, hash: string): boolean {
    return this.database.db.prepare("SELECT 1 FROM research_source_revisions WHERE workspace_id = ? AND content_hash = ? LIMIT 1").get(workspaceId, hash) !== undefined;
  }

  hashesOf(sourceId: string): string[] {
    return (this.database.db.prepare("SELECT DISTINCT content_hash FROM research_source_revisions WHERE source_id = ?").all(sourceId) as Row[]).map((r) => str(r.content_hash));
  }

  // A pending revision about to be read (again): whatever an interrupted attempt left of its chunks is removed first.
  restart(revisionId: string): void {
    this.database.transaction(() => {
      this.database.db.prepare("DELETE FROM research_chunks WHERE revision_id = ?").run(revisionId);
      this.database.db.prepare("UPDATE research_source_revisions SET status = 'pending', error = NULL, chunk_count = 0, char_count = 0 WHERE id = ?").run(revisionId);
    });
  }

  // One batch of a revision's chunks, in one transaction.
  writeChunkBatch(revision: RevisionRecord, chunks: readonly ChunkDraft[]): void {
    const insert = this.database.db.prepare("INSERT INTO research_chunks (revision_id, source_id, workspace_id, ordinal, page, section, char_start, char_end, text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    this.database.transaction(() => {
      for (const c of chunks) insert.run(revision.id, revision.sourceId, revision.workspaceId, c.ordinal, c.page, c.section, c.charStart, c.charEnd, c.text);
    });
  }

  indexed(revisionId: string, o: { pages: number | null; chars: number; chunks: number }): void {
    this.database.db.prepare("UPDATE research_source_revisions SET status = 'indexed', error = NULL, page_count = ?, char_count = ?, chunk_count = ?, indexed_at = ? WHERE id = ?").run(o.pages, o.chars, o.chunks, now(), revisionId);
  }

  failed(revisionId: string, error: string): void {
    this.database.transaction(() => {
      this.database.db.prepare("DELETE FROM research_chunks WHERE revision_id = ?").run(revisionId);
      this.database.db.prepare("UPDATE research_source_revisions SET status = 'failed', error = ?, chunk_count = 0 WHERE id = ?").run(error, revisionId);
    });
  }

  chunks(revisionId: string, from: number, count: number): ChunkRecord[] {
    return (this.database.db.prepare("SELECT * FROM research_chunks WHERE revision_id = ? AND ordinal >= ? ORDER BY ordinal LIMIT ?").all(revisionId, from, count) as Row[]).map(chunkOf);
  }

  chunk(id: number): ChunkRecord | null {
    const row = this.database.db.prepare("SELECT * FROM research_chunks WHERE id = ?").get(id) as Row | undefined;
    return row ? chunkOf(row) : null;
  }
}
