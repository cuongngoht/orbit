// What the API answers about research records, and the app-stream notifications that keep every page that may see them
// current: one place builds each view, so a list, a detail and a notification never disagree.
//
// A notification is sent to the workspace's AUDIENCE (its account, and the people it is shared with: access.ts) and to
// nobody else -- the access level it carries said to each: `owner` to the owner account's pages, `shared` to the pages
// of those it is shared with (several accounts' pages are open at once).
import { Inject, Injectable } from "@nestjs/common";
import { findingCode, type AccessLevel, type ResearchCitation, type ResearchFinding, type ResearchNote, type ResearchSessionSummary, type ResearchSourceSummary, type ResearchWorkspaceSummary } from "@orbit-web/contracts";
import { accountAudience, EventBus, type Audience } from "../../core/events/event-bus.js";
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

  async workspace(w: WorkspaceRecord, access: AccessLevel): Promise<ResearchWorkspaceSummary> {
    const counts = await this.workspaces.counts(w.id);
    return { id: w.id, name: w.name, description: w.description, access, owner: w.ownerEmail, sourceCount: counts.sources, sessionCount: counts.sessions, createdAt: w.createdAt, updatedAt: w.updatedAt };
  }

  async source(s: SourceRecord): Promise<ResearchSourceSummary> {
    const current = s.currentRevisionId === null ? null : await this.sources.revision(s.currentRevisionId);
    const latest = current ?? (await this.sources.latestRevision(s.id));
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

  async session(s: ResearchSessionRecord, w: WorkspaceRecord, access: AccessLevel, selected?: number): Promise<ResearchSessionSummary> {
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
      selectedSources: selected ?? (await this.sessions.selection(s.id)).length,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  }

  // Several sessions at once (the sidebar's list): one query for how many sources each selects.
  async sessionList(list: readonly { session: ResearchSessionRecord; workspace: WorkspaceRecord; access: AccessLevel }[]): Promise<ResearchSessionSummary[]> {
    const counts = await this.sessions.selectionCounts(list.map((x) => x.session.id));
    return Promise.all(list.map((x) => this.session(x.session, x.workspace, x.access, counts.get(x.session.id) ?? 0)));
  }

  async citation(c: CitationRecord): Promise<ResearchCitation> {
    return this.citationWith(c, await this.sources.get(c.sourceId));
  }

  // Many citations at once, reading each source they name once.
  async citations(list: readonly CitationRecord[]): Promise<ResearchCitation[]> {
    const ids = [...new Set(list.map((c) => c.sourceId))];
    const sources = new Map<string, SourceRecord | null>(await Promise.all(ids.map(async (id) => [id, await this.sources.get(id)] as const)));
    return list.map((c) => this.citationWith(c, sources.get(c.sourceId) ?? null));
  }

  async note(n: NoteRecord): Promise<ResearchNote> {
    const citation = n.citationId === null ? null : await this.evidence.citation(n.citationId);
    return { ...n, citation: citation === null ? null : await this.citation(citation) };
  }

  async finding(f: FindingRecord): Promise<ResearchFinding> {
    return { ...f, code: findingCode(f.number), citations: await this.citations(await this.evidence.findingCitations(f.id)) };
  }

  // NOTIFICATIONS, to the workspace's audience alone.
  async notifyWorkspace(id: string): Promise<void> {
    const w = await this.workspaces.get(id);
    if (w === null) return;
    await this.eachLevel(w, async (access, audience) => this.bus.publishApp("research.workspace.changed", { workspace: await this.workspace(w, access) }, audience));
  }

  async notifySession(id: string): Promise<void> {
    const s = await this.sessions.get(id);
    const w = s === null ? null : await this.workspaces.get(s.workspaceId);
    if (s === null || w === null) return;
    await this.eachLevel(w, async (access, audience) => this.bus.publishApp("research.session.summary", { session: await this.session(s, w, access) }, audience));
  }

  async notifySessionsOf(workspaceId: string): Promise<void> {
    for (const s of await this.sessions.ofWorkspace(workspaceId)) await this.notifySession(s.id);
  }

  async notifySource(id: string): Promise<void> {
    const s = await this.sources.get(id);
    const w = s === null ? null : await this.workspaces.get(s.workspaceId);
    if (s === null || w === null) return;
    this.bus.publishApp("research.source.changed", { source: await this.source(s) }, await this.access.audience(w));
  }

  notifyEvidence(w: WorkspaceRecord, audience: Audience, kind: "note" | "finding", id: string, removed = false): void {
    this.bus.publishApp("research.evidence.changed", { workspaceId: w.id, kind, id, removed }, audience);
  }

  // What is said to the owner account (`owner`), and to the people the workspace is shared with (`shared`) -- each its own.
  private async eachLevel(w: WorkspaceRecord, send: (access: AccessLevel, audience: Audience) => Promise<unknown>): Promise<void> {
    await send("owner", accountAudience(w.accountId));
    const people = await this.workspaces.emails(w.id);
    // No account has the empty id: an audience of the people alone.
    if (people.length > 0) await send("shared", accountAudience("", people));
  }

  private citationWith(c: CitationRecord, source: SourceRecord | null): ResearchCitation {
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
}

export const revisionInfo = (r: RevisionRecord) => ({ id: r.id, number: r.number, contentHash: r.contentHash, pages: r.pageCount, chars: r.charCount, chunks: r.chunkCount, fetchedAt: r.fetchedAt, indexedAt: r.indexedAt });
