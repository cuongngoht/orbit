// NOTES AND FINDINGS of a workspace: what a person keeps of their research. A note is free Markdown, optionally tied to a
// source or a citation, changed or deleted by whoever wrote it or the workspace's owner. A finding is a conclusion with
// the citations it rests on -- its words its writer's or the owner's to change -- and a review status a PERSON moves
// (anybody the workspace is open to):
// draft -> needs_review -> reviewed | rejected, back to draft. A finding's words changed after a review are a draft
// again -- a review is of the words it reviewed. `reviewed` is a reviewed research conclusion and nothing more: it is
// not a policy, it is never written to governance, and no run can set it (a run has no tool and no route).
import { Inject, Injectable } from "@nestjs/common";
import { checkCreateFinding, checkCreateNote, checkUpdateFinding, checkUpdateNote, FINDING_MOVES, FINDING_STATUS_LABELS, type FindingStatus, type ResearchFinding, type ResearchNote } from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import { accepted, conflict, notFound } from "../../common/errors.js";
import { Db } from "../../infra/db/db.js";
import type { Owner } from "../auth/principal.js";
import { ResearchAccess } from "./access.js";
import { EvidenceStore, type FindingRecord } from "./store/evidence.js";
import { ResearchSessionStore } from "./store/sessions.js";
import { SourceStore } from "./store/sources.js";
import { WorkspaceStore, type WorkspaceRecord } from "./store/workspaces.js";
import { ResearchViews } from "./views.js";

@Injectable()
export class ResearchEvidenceService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(WorkspaceStore) private readonly workspaces: WorkspaceStore,
    @Inject(SourceStore) private readonly sources: SourceStore,
    @Inject(ResearchSessionStore) private readonly sessions: ResearchSessionStore,
    @Inject(EvidenceStore) private readonly evidence: EvidenceStore,
    @Inject(ResearchAccess) private readonly access: ResearchAccess,
    @Inject(ResearchViews) private readonly views: ResearchViews,
  ) {}

  async notes(workspaceId: string, viewer: Owner): Promise<ResearchNote[]> {
    const w = await this.access.workspace(workspaceId, viewer);
    const out: ResearchNote[] = [];
    for (const n of await this.evidence.notes(w.id)) out.push(await this.views.note(n));
    return out;
  }

  async createNote(workspaceId: string, body: unknown, viewer: Owner): Promise<ResearchNote> {
    const w = await this.access.workspace(workspaceId, viewer);
    const req = accepted(checkCreateNote(body));
    await this.ownSession(w, req.sessionId);
    if (req.sourceId !== undefined && (await this.sources.get(req.sourceId))?.workspaceId !== w.id) throw notFound("Source");
    if (req.citationId !== undefined) await this.access.citations([req.citationId], w.id);
    const note = await this.evidence.addNote({ id: randomUUID(), workspaceId: w.id, sessionId: req.sessionId ?? null, title: req.title, body: req.body, sourceId: req.sourceId ?? null, citationId: req.citationId ?? null, createdBy: viewer.email });
    await this.changed(w, "note", note.id);
    return this.views.note(note);
  }

  async updateNote(id: string, body: unknown, viewer: Owner): Promise<ResearchNote> {
    const { note, workspace } = await this.access.note(id, viewer);
    await this.access.mayRemove(workspace, note.createdBy, viewer);
    const updated = await this.evidence.updateNote(note.id, accepted(checkUpdateNote(body)));
    await this.changed(workspace, "note", note.id);
    return this.views.note(updated);
  }

  async deleteNote(id: string, viewer: Owner): Promise<void> {
    const { note, workspace } = await this.access.note(id, viewer);
    await this.access.mayRemove(workspace, note.createdBy, viewer);
    await this.evidence.deleteNote(note.id);
    await this.evidence.dropUnreferenced(workspace.id);
    await this.changed(workspace, "note", note.id, true);
  }

  async findings(workspaceId: string, viewer: Owner): Promise<ResearchFinding[]> {
    const w = await this.access.workspace(workspaceId, viewer);
    const out: ResearchFinding[] = [];
    for (const f of await this.evidence.findings(w.id)) out.push(await this.views.finding(f));
    return out;
  }

  // A finding starts as a draft, numbered in its workspace (F-001, F-002 …) in the transaction that stores it.
  async createFinding(workspaceId: string, body: unknown, viewer: Owner): Promise<ResearchFinding> {
    const w = await this.access.workspace(workspaceId, viewer);
    const req = accepted(checkCreateFinding(body));
    await this.ownSession(w, req.sessionId);
    const citations = (await this.access.citations(req.citations ?? [], w.id)).map((c) => c.id);
    const finding = await this.db.tx(async () =>
      this.evidence.addFinding({ id: randomUUID(), workspaceId: w.id, sessionId: req.sessionId ?? null, number: await this.workspaces.nextFinding(w.id), title: req.title, statement: req.statement, createdBy: viewer.email }, citations),
    );
    await this.changed(w, "finding", finding.id);
    return this.views.finding(finding);
  }

  async updateFinding(id: string, body: unknown, viewer: Owner): Promise<ResearchFinding> {
    const { finding, workspace } = await this.access.finding(id, viewer);
    const req = accepted(checkUpdateFinding(body));
    const citations = req.citations === undefined ? null : (await this.access.citations(req.citations, workspace.id)).map((c) => c.id);
    const reworded = req.title !== undefined || req.statement !== undefined || citations !== null;
    // Its words and citations are its writer's or the workspace owner's to change; anybody it is open to may review it.
    if (reworded) await this.access.mayRemove(workspace, finding.createdBy, viewer);
    // Words changed after a review make it a draft again; then the move asked for, if any, from there.
    const from: FindingStatus = reworded && (finding.status === "reviewed" || finding.status === "rejected") ? "draft" : finding.status;
    const to = req.status ?? from;
    if (to !== from && !FINDING_MOVES[from].includes(to)) throw conflict("finding_move", `A finding that is ${FINDING_STATUS_LABELS[from].toLowerCase()} cannot become ${FINDING_STATUS_LABELS[to].toLowerCase()}.`);
    const decided = to === "reviewed" || to === "rejected";
    const review: Partial<FindingRecord> = to === finding.status && !reworded ? {} : decided ? { reviewedBy: viewer.email, reviewedAt: new Date().toISOString() } : { reviewedBy: null, reviewedAt: null };
    const updated = await this.evidence.updateFinding(finding.id, { ...(req.title ? { title: req.title } : {}), ...(req.statement ? { statement: req.statement } : {}), status: to, ...review }, citations);
    await this.changed(workspace, "finding", finding.id);
    return this.views.finding(updated);
  }

  async deleteFinding(id: string, viewer: Owner): Promise<void> {
    const { finding, workspace } = await this.access.finding(id, viewer);
    await this.access.mayRemove(workspace, finding.createdBy, viewer);
    await this.evidence.deleteFinding(finding.id);
    await this.evidence.dropUnreferenced(workspace.id);
    await this.changed(workspace, "finding", finding.id, true);
  }

  private async ownSession(w: WorkspaceRecord, sessionId: string | undefined): Promise<void> {
    if (sessionId !== undefined && (await this.sessions.get(sessionId))?.workspaceId !== w.id) throw notFound("Research session");
  }

  private async changed(w: WorkspaceRecord, kind: "note" | "finding", id: string, removed = false): Promise<void> {
    await this.workspaces.touch(w.id);
    this.views.notifyEvidence(w, await this.access.audience(w), kind, id, removed);
  }
}
