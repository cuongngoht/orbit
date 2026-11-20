// WHOSE A RESEARCH WORKSPACE IS, held at one door. A workspace belongs to the Claude account that created it (its email
// in its organization); that account and the accounts it shared the workspace with by email may open it -- read its
// sources, ask in its sessions, keep notes and findings. Every source, session, note, finding and citation is reached
// through its workspace: an id of another workspace's record is as if it did not exist (404). Deleting the workspace
// and choosing who it is shared with are its owner's; deleting something inside it is its owner's, or whoever added it.
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { isResearchId, type AccessLevel, type AnyAppStreamEvent } from "@orbit-web/contracts";
import { forbidden, notFound } from "../../common/errors.js";
import { StreamGateway } from "../../core/events/stream-gateway.js";
import { OwnershipService } from "../access/ownership.service.js";
import type { Identity } from "../claude-auth/claude-auth.service.js";
import { ClaudeAuthService } from "../claude-auth/claude-auth.service.js";
import { EvidenceStore, type CitationRecord, type FindingRecord, type NoteRecord } from "./store/evidence.js";
import { ResearchSessionStore, type ResearchSessionRecord } from "./store/sessions.js";
import { SourceStore, type SourceRecord } from "./store/sources.js";
import { WorkspaceStore, type WorkspaceRecord } from "./store/workspaces.js";

export type ResearchNeed = "open" | "owner";

// Which workspace an app-stream notification is about; null for one about no workspace (or a removal: an id only).
function workspaceOfEvent(e: AnyAppStreamEvent): string | null {
  if (e.type === "research.workspace.changed") return e.data.workspace.id;
  if (e.type === "research.session.summary") return e.data.session.workspaceId;
  if (e.type === "research.source.changed") return e.data.source.workspaceId;
  if (e.type === "research.evidence.changed") return e.data.workspaceId;
  return null;
}

@Injectable()
export class ResearchAccess implements OnModuleInit {
  constructor(
    @Inject(OwnershipService) private readonly ownership: OwnershipService,
    @Inject(ClaudeAuthService) private readonly claude: ClaudeAuthService,
    @Inject(WorkspaceStore) private readonly workspaces: WorkspaceStore,
    @Inject(SourceStore) private readonly sources: SourceStore,
    @Inject(ResearchSessionStore) private readonly sessions: ResearchSessionStore,
    @Inject(EvidenceStore) private readonly evidence: EvidenceStore,
    @Inject(StreamGateway) private readonly gateway: StreamGateway,
  ) {}

  // A notification about a workspace reaches the pages of the accounts that may open it, and no other.
  onModuleInit(): void {
    this.gateway.filterApp((e) => {
      const id = workspaceOfEvent(e);
      return id === null || this.levelOf(this.workspaces.get(id), this.claude.currentIdentity()) !== null;
    });
  }

  viewer(): Promise<Identity | null> {
    return this.ownership.viewer();
  }

  levelOf(w: WorkspaceRecord | null, identity: Identity | null): AccessLevel | null {
    if (w === null || identity === null) return null;
    if (w.ownerEmail === identity.email && w.ownerOrg === identity.org) return "owner";
    return this.workspaces.hasAccess(w.id, identity.email) ? "shared" : null;
  }

  levelNow(w: WorkspaceRecord | null): AccessLevel | null {
    return this.levelOf(w, this.claude.currentIdentity());
  }

  visible(identity: Identity | null): WorkspaceRecord[] {
    return identity === null ? [] : this.workspaces.visibleTo(identity);
  }

  workspace(id: string, identity: Identity | null, need: ResearchNeed = "open"): WorkspaceRecord {
    const w = isResearchId(id) ? this.workspaces.get(id) : null;
    const level = this.levelOf(w, identity);
    if (w === null || level === null) throw notFound("Research workspace");
    if (need === "owner" && level !== "owner") throw forbidden("owner_only", "Only the account that owns this research workspace can do that.");
    return w;
  }

  source(id: string, identity: Identity | null): { source: SourceRecord; workspace: WorkspaceRecord } {
    const source = isResearchId(id) ? this.sources.get(id) : null;
    if (source === null) throw notFound("Source");
    return { source, workspace: this.within(source.workspaceId, identity, "Source") };
  }

  session(id: string, identity: Identity | null): { session: ResearchSessionRecord; workspace: WorkspaceRecord } {
    const session = isResearchId(id) ? this.sessions.get(id) : null;
    if (session === null) throw notFound("Research session");
    return { session, workspace: this.within(session.workspaceId, identity, "Research session") };
  }

  note(id: string, identity: Identity | null): { note: NoteRecord; workspace: WorkspaceRecord } {
    const note = isResearchId(id) ? this.evidence.note(id) : null;
    if (note === null) throw notFound("Note");
    return { note, workspace: this.within(note.workspaceId, identity, "Note") };
  }

  finding(id: string, identity: Identity | null): { finding: FindingRecord; workspace: WorkspaceRecord } {
    const finding = isResearchId(id) ? this.evidence.finding(id) : null;
    if (finding === null) throw notFound("Finding");
    return { finding, workspace: this.within(finding.workspaceId, identity, "Finding") };
  }

  // Citations named in a request: each of this very workspace (any other is as if it did not exist).
  citations(ids: readonly string[], workspaceId: string): CitationRecord[] {
    return ids.map((id) => {
      const c = this.evidence.citation(id);
      if (c === null || c.workspaceId !== workspaceId) throw notFound("Citation");
      return c;
    });
  }

  // Removing something inside a workspace: its owner's, or whoever added it.
  mayRemove(workspace: WorkspaceRecord, createdBy: string, identity: Identity | null): void {
    if (this.levelOf(workspace, identity) === "owner" || identity?.email === createdBy) return;
    throw forbidden("owner_only", "Only the workspace's owner, or whoever added it, can delete it.");
  }

  private within(workspaceId: string, identity: Identity | null, what: string): WorkspaceRecord {
    const w = this.workspaces.get(workspaceId);
    if (this.levelOf(w, identity) === null) throw notFound(what);
    return w as WorkspaceRecord;
  }
}
