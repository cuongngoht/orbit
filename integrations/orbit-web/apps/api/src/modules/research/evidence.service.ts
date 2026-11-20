// NOTES AND FINDINGS of a workspace: what a person keeps of their research. A note is free Markdown, optionally tied to a
// source or a citation. A finding is a conclusion with the citations it rests on and a review status a PERSON moves:
// draft -> needs_review -> reviewed | rejected, back to draft. A finding's words changed after a review are a draft
// again -- a review is of the words it reviewed. `reviewed` is a reviewed research conclusion and nothing more: it is
// not a policy, it is never written to governance, and no run can set it (a run has no tool and no route).
import { Inject, Injectable } from "@nestjs/common";
import { checkCreateFinding, checkCreateNote, checkUpdateFinding, checkUpdateNote, FINDING_MOVES, FINDING_STATUS_LABELS, type FindingStatus, type ResearchFinding, type ResearchNote } from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import { accepted, conflict, notFound } from "../../common/errors.js";
import { Database } from "../../infra/storage/database.js";
import { requireIdentity } from "../access/ownership.service.js";
import type { Identity } from "../claude-auth/claude-auth.service.js";
import { ResearchAccess } from "./access.js";
import { EvidenceStore, type FindingRecord } from "./store/evidence.js";
import { ResearchSessionStore } from "./store/sessions.js";
import { SourceStore } from "./store/sources.js";
import { WorkspaceStore, type WorkspaceRecord } from "./store/workspaces.js";
import { ResearchViews } from "./views.js";

@Injectable()
export class ResearchEvidenceService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(WorkspaceStore) private readonly workspaces: WorkspaceStore,
    @Inject(SourceStore) private readonly sources: SourceStore,
    @Inject(ResearchSessionStore) private readonly sessions: ResearchSessionStore,
    @Inject(EvidenceStore) private readonly evidence: EvidenceStore,
    @Inject(ResearchAccess) private readonly access: ResearchAccess,
    @Inject(ResearchViews) private readonly views: ResearchViews,
  ) {}

  notes(workspaceId: string, identity: Identity | null): ResearchNote[] {
    const w = this.access.workspace(workspaceId, identity);
    return this.evidence.notes(w.id).map((n) => this.views.note(n));
  }

  createNote(workspaceId: string, body: unknown, identity: Identity | null): ResearchNote {
    const who = requireIdentity(identity);
    const w = this.access.workspace(workspaceId, identity);
    const req = accepted(checkCreateNote(body));
    this.ownSession(w, req.sessionId);
    if (req.sourceId !== undefined && this.sources.get(req.sourceId)?.workspaceId !== w.id) throw notFound("Source");
    if (req.citationId !== undefined) this.access.citations([req.citationId], w.id);
    const note = this.evidence.addNote({ id: randomUUID(), workspaceId: w.id, sessionId: req.sessionId ?? null, title: req.title, body: req.body, sourceId: req.sourceId ?? null, citationId: req.citationId ?? null, createdBy: who.email });
    this.changed(w, "note", note.id);
    return this.views.note(note);
  }

  updateNote(id: string, body: unknown, identity: Identity | null): ResearchNote {
    const { note, workspace } = this.access.note(id, identity);
    this.access.mayRemove(workspace, note.createdBy, identity);
    const updated = this.evidence.updateNote(note.id, accepted(checkUpdateNote(body)));
    this.changed(workspace, "note", note.id);
    return this.views.note(updated);
  }

  deleteNote(id: string, identity: Identity | null): void {
    const { note, workspace } = this.access.note(id, identity);
    this.access.mayRemove(workspace, note.createdBy, identity);
    this.evidence.deleteNote(note.id);
    this.evidence.dropUnreferenced(workspace.id);
    this.changed(workspace, "note", note.id, true);
  }

  findings(workspaceId: string, identity: Identity | null): ResearchFinding[] {
    const w = this.access.workspace(workspaceId, identity);
    return this.evidence.findings(w.id).map((f) => this.views.finding(f));
  }

  // A finding starts as a draft, numbered in its workspace (F-001, F-002 …).
  createFinding(workspaceId: string, body: unknown, identity: Identity | null): ResearchFinding {
    const who = requireIdentity(identity);
    const w = this.access.workspace(workspaceId, identity);
    const req = accepted(checkCreateFinding(body));
    this.ownSession(w, req.sessionId);
    const citations = this.access.citations(req.citations ?? [], w.id).map((c) => c.id);
    const finding = this.database.transaction(() => this.evidence.addFinding({ id: randomUUID(), workspaceId: w.id, sessionId: req.sessionId ?? null, number: this.workspaces.nextFinding(w.id), title: req.title, statement: req.statement, createdBy: who.email }, citations));
    this.changed(w, "finding", finding.id);
    return this.views.finding(finding);
  }

  updateFinding(id: string, body: unknown, identity: Identity | null): ResearchFinding {
    const who = requireIdentity(identity);
    const { finding, workspace } = this.access.finding(id, identity);
    const req = accepted(checkUpdateFinding(body));
    const citations = req.citations === undefined ? null : this.access.citations(req.citations, workspace.id).map((c) => c.id);
    const reworded = req.title !== undefined || req.statement !== undefined || citations !== null;
    // Words changed after a review make it a draft again; then the move asked for, if any, from there.
    const from: FindingStatus = reworded && (finding.status === "reviewed" || finding.status === "rejected") ? "draft" : finding.status;
    const to = req.status ?? from;
    if (to !== from && !FINDING_MOVES[from].includes(to)) throw conflict("finding_move", `A finding that is ${FINDING_STATUS_LABELS[from].toLowerCase()} cannot become ${FINDING_STATUS_LABELS[to].toLowerCase()}.`);
    const decided = to === "reviewed" || to === "rejected";
    const review: Partial<FindingRecord> = to === finding.status && !reworded ? {} : decided ? { reviewedBy: who.email, reviewedAt: new Date().toISOString() } : { reviewedBy: null, reviewedAt: null };
    const updated = this.evidence.updateFinding(finding.id, { ...(req.title ? { title: req.title } : {}), ...(req.statement ? { statement: req.statement } : {}), status: to, ...review }, citations);
    this.changed(workspace, "finding", finding.id);
    return this.views.finding(updated);
  }

  deleteFinding(id: string, identity: Identity | null): void {
    const { finding, workspace } = this.access.finding(id, identity);
    this.access.mayRemove(workspace, finding.createdBy, identity);
    this.evidence.deleteFinding(finding.id);
    this.evidence.dropUnreferenced(workspace.id);
    this.changed(workspace, "finding", finding.id, true);
  }

  private ownSession(w: WorkspaceRecord, sessionId: string | undefined): void {
    if (sessionId !== undefined && this.sessions.get(sessionId)?.workspaceId !== w.id) throw notFound("Research session");
  }

  private changed(w: WorkspaceRecord, kind: "note" | "finding", id: string, removed = false): void {
    this.workspaces.touch(w.id);
    this.views.notifyEvidence(w.id, kind, id, removed);
  }
}
