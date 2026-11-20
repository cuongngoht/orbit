// What the API answers about research records, and the app-stream notifications that keep every page of an account
// that may see them current: one place builds each view, so a list, a detail and a notification never disagree.
import { Inject, Injectable } from "@nestjs/common";
import { findingCode, type AccessLevel, type ResearchCitation, type ResearchFinding, type ResearchNote, type ResearchSessionSummary, type ResearchSourceSummary, type ResearchWorkspaceSummary } from "@orbit-web/contracts";
import { EventBus } from "../../core/events/event-bus.js";
import { ResearchAccess } from "./access.js";
import { EvidenceStore, type CitationRecord, type FindingRecord, type NoteRecord } from "./store/evidence.js";
import { ResearchSessionStore, type ResearchSessionRecord } from "./store/sessions.js";
import { SourceStore, type RevisionRecord, type SourceRecord } from "./store/sources.js";
import { WorkspaceStore, type WorkspaceRecord } from "./store/workspaces.js";

@Injectable()
export class ResearchViews {
  constructor(
    @Inject(WorkspaceStore) private readonly workspaces: WorkspaceStore,
    @Inject(SourceStore) private readonly sources: SourceStore,
    @Inject(ResearchSessionStore) private readonly sessions: ResearchSessionStore,
    @Inject(EvidenceStore) private readonly evidence: EvidenceStore,
    @Inject(ResearchAccess) private readonly access: ResearchAccess,
    @Inject(EventBus) private readonly bus: EventBus,
  ) {}

  workspace(w: WorkspaceRecord, access: AccessLevel): ResearchWorkspaceSummary {
    const counts = this.workspaces.counts(w.id);
    return { id: w.id, name: w.name, description: w.description, access, owner: w.ownerEmail, sourceCount: counts.sources, sessionCount: counts.sessions, createdAt: w.createdAt, updatedAt: w.updatedAt };
  }

  source(s: SourceRecord): ResearchSourceSummary {
    const current = s.currentRevisionId === null ? null : this.sources.revision(s.currentRevisionId);
    const latest = current ?? this.sources.latestRevision(s.id);
    return {
      id: s.id,
      workspaceId: s.workspaceId,
      kind: s.kind,
      title: s.title,
      origin: s.origin,
      mediaType: latest?.mediaType ?? null,
      state: s.state,
      stateReason: s.stateReason,
      revision: current === null ? null : revisionInfo(current),
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  }

  session(s: ResearchSessionRecord, w: WorkspaceRecord, access: AccessLevel): ResearchSessionSummary {
    return {
      kind: "research",
      id: s.id,
      workspaceId: s.workspaceId,
      workspaceName: w.name,
      title: s.title,
      model: s.model,
      effort: s.effort,
      status: s.status,
      statusReason: s.statusReason,
      access,
      owner: w.ownerEmail,
      selectedSources: this.sessions.selection(s.id).length,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  }

  citation(c: CitationRecord): ResearchCitation {
    const source = this.sources.get(c.sourceId);
    return {
      id: c.id,
      label: c.label,
      messageId: c.messageId,
      runId: c.runId,
      sessionId: c.sessionId,
      sourceId: c.sourceId,
      revisionId: c.revisionId,
      revisionNumber: c.revisionNumber,
      sourceTitle: c.sourceTitle,
      sourceAvailable: source !== null && source.workspaceId === c.workspaceId,
      revisionCurrent: source?.currentRevisionId === c.revisionId,
      chunkOrdinal: c.chunkOrdinal,
      page: c.page,
      section: c.section,
      charStart: c.charStart,
      charEnd: c.charEnd,
      quote: c.quote,
      match: c.match,
      rank: c.rank,
      score: c.score,
      createdAt: c.createdAt,
    };
  }

  note(n: NoteRecord): ResearchNote {
    const citation = n.citationId === null ? null : this.evidence.citation(n.citationId);
    return { ...n, citation: citation === null ? null : this.citation(citation) };
  }

  finding(f: FindingRecord): ResearchFinding {
    return { ...f, code: findingCode(f.number), citations: this.evidence.findingCitations(f.id).map((c) => this.citation(c)) };
  }

  // NOTIFICATIONS, as the account signed in now sees them (the gateway's filter sends each only to who may see it).
  notifyWorkspace(id: string): void {
    const w = this.workspaces.get(id);
    if (w !== null) this.bus.publishApp("research.workspace.changed", { workspace: this.workspace(w, this.access.levelNow(w) ?? "owner") });
  }

  notifySession(id: string): void {
    const s = this.sessions.get(id);
    const w = s === null ? null : this.workspaces.get(s.workspaceId);
    if (s !== null && w !== null) this.bus.publishApp("research.session.summary", { session: this.session(s, w, this.access.levelNow(w) ?? "owner") });
  }

  notifySource(id: string): void {
    const s = this.sources.get(id);
    if (s !== null) this.bus.publishApp("research.source.changed", { source: this.source(s) });
  }

  notifyEvidence(workspaceId: string, kind: "note" | "finding", id: string, removed = false): void {
    this.bus.publishApp("research.evidence.changed", { workspaceId, kind, id, removed });
  }
}

export const revisionInfo = (r: RevisionRecord) => ({ id: r.id, number: r.number, contentHash: r.contentHash, pages: r.pageCount, chars: r.charCount, chunks: r.chunkCount, fetchedAt: r.fetchedAt, indexedAt: r.indexedAt });
