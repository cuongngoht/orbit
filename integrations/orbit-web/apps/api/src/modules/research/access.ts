// WHOSE A RESEARCH WORKSPACE IS, held at one door. A workspace belongs to the ACCOUNT that created it -- the internal
// account of a verified Claude identity, never anything a request says --; that account, and the accounts whose identity's
// email it was shared with, may open it: read its sources, ask in its sessions, keep notes and findings. Every source,
// session, note, finding and citation is reached through its workspace: an id of another workspace's record, or of
// another account's, is as if it did not exist (404). Deleting the workspace and choosing who it is shared with are its
// owner's; deleting something inside it is its owner's, or whoever added it.
//
// Who asks is the request's viewer (the owner of the browser session the request carried: common/request-scope.ts),
// passed in by the controller. Work that outlives a request (ingestion, a run) never asks here: it acts for the account
// its own records name. What is said on the app stream names its AUDIENCE -- the workspace's account and the emails it is
// shared with --, worked out here before anything is deleted, so nothing is looked up while a notification travels.
import { Inject, Injectable } from "@nestjs/common";
import { isResearchId, type AccessLevel } from "@orbit-web/contracts";
import { forbidden, notFound } from "../../common/errors.js";
import { accountAudience, type Audience } from "../../core/events/event-bus.js";
import { EvidenceStore, type CitationRecord, type FindingRecord, type NoteRecord } from "./store/evidence.js";
import { ResearchSessionStore, type ResearchSessionRecord } from "./store/sessions.js";
import { SourceStore, type SourceRecord } from "./store/sources.js";
import { WorkspaceStore, type ResearchViewer, type WorkspaceRecord } from "./store/workspaces.js";

export type ResearchNeed = "open" | "owner";

export type { ResearchViewer } from "./store/workspaces.js";

@Injectable()
export class ResearchAccess {
  constructor(
    @Inject(WorkspaceStore) private readonly workspaces: WorkspaceStore,
    @Inject(SourceStore) private readonly sources: SourceStore,
    @Inject(ResearchSessionStore) private readonly sessions: ResearchSessionStore,
    @Inject(EvidenceStore) private readonly evidence: EvidenceStore,
  ) {}

  async levelOf(w: WorkspaceRecord | null, v: ResearchViewer | null): Promise<AccessLevel | null> {
    if (w === null || v === null) return null;
    if (w.accountId === v.accountId) return "owner";
    return (await this.workspaces.hasAccess(w.id, v.email)) ? "shared" : null;
  }

  async visible(v: ResearchViewer): Promise<WorkspaceRecord[]> {
    return this.workspaces.visibleTo(v);
  }

  async workspace(id: string, v: ResearchViewer, need: ResearchNeed = "open"): Promise<WorkspaceRecord> {
    const w = isResearchId(id) ? await this.workspaces.get(id) : null;
    const level = await this.levelOf(w, v);
    if (w === null || level === null) throw notFound("Research workspace");
    if (need === "owner" && level !== "owner") throw forbidden("owner_only", "Only the account that owns this research workspace can do that.");
    return w;
  }

  async source(id: string, v: ResearchViewer): Promise<{ source: SourceRecord; workspace: WorkspaceRecord }> {
    const source = isResearchId(id) ? await this.sources.get(id) : null;
    if (source === null) throw notFound("Source");
    return { source, workspace: await this.within(source.workspaceId, v, "Source") };
  }

  async session(id: string, v: ResearchViewer): Promise<{ session: ResearchSessionRecord; workspace: WorkspaceRecord }> {
    const session = isResearchId(id) ? await this.sessions.get(id) : null;
    if (session === null) throw notFound("Research session");
    return { session, workspace: await this.within(session.workspaceId, v, "Research session") };
  }

  async note(id: string, v: ResearchViewer): Promise<{ note: NoteRecord; workspace: WorkspaceRecord }> {
    const note = isResearchId(id) ? await this.evidence.note(id) : null;
    if (note === null) throw notFound("Note");
    return { note, workspace: await this.within(note.workspaceId, v, "Note") };
  }

  async finding(id: string, v: ResearchViewer): Promise<{ finding: FindingRecord; workspace: WorkspaceRecord }> {
    const finding = isResearchId(id) ? await this.evidence.finding(id) : null;
    if (finding === null) throw notFound("Finding");
    return { finding, workspace: await this.within(finding.workspaceId, v, "Finding") };
  }

  // Citations named in a request: each of this very workspace (any other is as if it did not exist).
  async citations(ids: readonly string[], workspaceId: string): Promise<CitationRecord[]> {
    const found = await this.evidence.citations(ids);
    return ids.map((id) => {
      const c = found.get(id);
      if (c === undefined || c.workspaceId !== workspaceId) throw notFound("Citation");
      return c;
    });
  }

  // Removing (or rewording) something inside a workspace: its owner's, or whoever added it.
  async mayRemove(workspace: WorkspaceRecord, createdBy: string, v: ResearchViewer): Promise<void> {
    if ((await this.levelOf(workspace, v)) === "owner" || v.email === createdBy) return;
    throw forbidden("owner_only", "Only the workspace's owner, or whoever added it, can delete it.");
  }

  // Who is told what changes in a workspace: its account, and the emails it is shared with.
  async audience(w: Pick<WorkspaceRecord, "id" | "accountId">): Promise<Audience> {
    return accountAudience(w.accountId, await this.workspaces.emails(w.id));
  }

  private async within(workspaceId: string, v: ResearchViewer, what: string): Promise<WorkspaceRecord> {
    const w = await this.workspaces.get(workspaceId);
    if ((await this.levelOf(w, v)) === null) throw notFound(what);
    return w as WorkspaceRecord;
  }
}
