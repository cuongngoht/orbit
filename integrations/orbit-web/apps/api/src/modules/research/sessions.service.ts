// RESEARCH SESSIONS: one conversation over the sources of a workspace it selects. A session needs no repository, no
// branch and no workspace on disk; its model and effort are held to the signed-in account's catalog. Its selection is
// kept per session and decides what a question may retrieve from. Deleting a session removes its conversation and runs,
// never a source: notes and findings stay, and the citations they refer to stay with them.
import { Inject, Injectable } from "@nestjs/common";
import { checkCreateResearchSession, checkQuestion, checkSelection, checkUpdateResearchSession, cleanName, RESEARCH_LIMITS, type ResearchEvidence, type ResearchMessage, type ResearchRunInfo, type ResearchSelection, type ResearchSessionDetail, type ResearchSessionSummary, type RunAccepted } from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { EventBus } from "../../core/events/event-bus.js";
import { accepted, conflict, notFound } from "../../common/errors.js";
import { redactSecrets } from "../../infra/security/redact.js";
import { requireIdentity } from "../access/ownership.service.js";
import type { Identity } from "../claude-auth/claude-auth.service.js";
import { ClaudeModelsService } from "../claude-auth/claude-models.service.js";
import { SettingsService } from "../settings/settings.module.js";
import { ResearchAccess } from "./access.js";
import { ResearchRunnerService } from "./runner/research-runner.service.js";
import { EvidenceStore } from "./store/evidence.js";
import { ResearchRunStore, ResearchSessionStore, type ResearchSessionRecord } from "./store/sessions.js";
import { SourceStore } from "./store/sources.js";
import { WorkspaceStore, type WorkspaceRecord } from "./store/workspaces.js";
import { ResearchStream } from "./stream.js";
import { ResearchViews } from "./views.js";

// A session's title from its first question (masked by token shape before it is cut, as a chat's is).
export const researchTitle = (question: string | undefined, workspace: string): string => {
  const line = redactSecrets((question ?? "").trim().split("\n")[0]?.trim() ?? "");
  if (line.length === 0) return `Research · ${workspace}`.slice(0, RESEARCH_LIMITS.titleLength);
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
};

@Injectable()
export class ResearchSessionsService {
  constructor(
    @Inject(WorkspaceStore) private readonly workspaces: WorkspaceStore,
    @Inject(ResearchSessionStore) private readonly sessions: ResearchSessionStore,
    @Inject(ResearchRunStore) private readonly runs: ResearchRunStore,
    @Inject(SourceStore) private readonly sources: SourceStore,
    @Inject(EvidenceStore) private readonly evidence: EvidenceStore,
    @Inject(ResearchAccess) private readonly access: ResearchAccess,
    @Inject(ResearchViews) private readonly views: ResearchViews,
    @Inject(ResearchRunnerService) private readonly runner: ResearchRunnerService,
    @Inject(ResearchStream) private readonly stream: ResearchStream,
    @Inject(ClaudeModelsService) private readonly models: ClaudeModelsService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(EventBus) private readonly bus: EventBus,
  ) {}

  // Every research session of the workspaces this account may open: what the sidebar lists beside the chats.
  all(identity: Identity | null): ResearchSessionSummary[] {
    const workspaces = this.access.visible(identity);
    const byId = new Map(workspaces.map((w) => [w.id, w]));
    return this.sessions.ofWorkspaces([...byId.keys()]).map((s) => this.summary(s, byId.get(s.workspaceId) as WorkspaceRecord, identity));
  }

  ofWorkspace(workspaceId: string, identity: Identity | null): ResearchSessionSummary[] {
    const w = this.access.workspace(workspaceId, identity);
    return this.sessions.ofWorkspace(w.id).map((s) => this.summary(s, w, identity));
  }

  // A session over the sources it selects (all the workspace's, unless named), with the account's model. A first
  // question is asked at once when a selected source is ready; otherwise it waits in the composer.
  async create(workspaceId: string, body: unknown, identity: Identity | null): Promise<ResearchSessionDetail> {
    const who = requireIdentity(identity);
    const w = this.access.workspace(workspaceId, identity);
    const req = accepted(checkCreateResearchSession(body));
    const run = await this.models.settle({ model: req.model, effort: this.settings.get().defaultEffort, mode: null }, req.effort ? { effort: req.effort } : {});
    const selection = req.sources === undefined ? this.sources.list(w.id).map((s) => s.id) : this.ownSources(w, req.sources);
    const session = this.sessions.create({ id: randomUUID(), workspaceId: w.id, title: req.title ?? researchTitle(req.question, w.name), model: run.model, effort: run.effort, draftQuestion: req.question ?? null, createdBy: who.email }, selection);
    this.workspaces.touch(w.id);
    this.views.notifySession(session.id);
    this.views.notifyWorkspace(w.id);
    if (req.question !== undefined && this.runner.freeze(session).length > 0) this.runner.ask(session, req.question);
    return this.detail(session.id, identity);
  }

  detail(id: string, identity: Identity | null): ResearchSessionDetail {
    const { session, workspace } = this.access.session(id, identity);
    const messages = this.sessions.messages(session.id);
    const citations = this.evidence.citationsOfMessages(messages.filter((m) => m.role === "assistant").map((m) => m.id)).map((c) => this.views.citation(c));
    const shown: ResearchMessage[] = messages.map((m) => ({ id: m.id, role: m.role, text: m.text, runId: m.runId, partial: m.partial, createdAt: m.createdAt, citations: citations.filter((c) => c.messageId === m.id) }));
    return { ...this.summary(session, workspace, identity), lastSeq: session.lastSeq, selection: this.sessions.selection(session.id), draftQuestion: session.draftQuestion, messages: shown, lastRun: this.lastRun(session.id) };
  }

  async update(id: string, body: unknown, identity: Identity | null): Promise<ResearchSessionSummary> {
    const { session, workspace } = this.access.session(id, identity);
    const change = accepted(checkUpdateResearchSession(body));
    const run = change.model !== undefined || change.effort !== undefined ? await this.models.settle({ model: session.model, effort: session.effort, mode: null }, change) : null;
    const updated = this.sessions.update(session.id, { ...(change.title ? { title: change.title } : {}), ...(run !== null ? { model: run.model, effort: run.effort } : {}) });
    this.views.notifySession(session.id);
    return this.summary(updated, workspace, identity);
  }

  // The conversation and its runs go; the workspace's sources, notes and findings stay.
  delete(id: string, identity: Identity | null): void {
    const { session, workspace } = this.access.session(id, identity);
    this.access.mayRemove(workspace, session.createdBy, identity);
    if (this.runner.isRunning(session.id) || session.status === "running") throw conflict("run_active", "Stop the run before deleting this research session.");
    this.sessions.delete(session.id);
    this.evidence.dropUnreferenced(workspace.id);
    this.stream.forget(session.id);
    this.workspaces.touch(workspace.id);
    this.bus.publishApp("research.session.removed", { sessionId: session.id, workspaceId: workspace.id });
    this.views.notifyWorkspace(workspace.id);
  }

  // Which sources the next question may retrieve from. A run already answering keeps the evidence it was frozen to.
  select(id: string, body: unknown, identity: Identity | null): ResearchSelection {
    const { session, workspace } = this.access.session(id, identity);
    const selection = this.sessions.setSelection(session.id, this.ownSources(workspace, accepted(checkSelection(body)).sources));
    this.views.notifySession(session.id);
    return { sessionId: session.id, selection };
  }

  ask(id: string, body: unknown, identity: Identity | null): RunAccepted {
    requireIdentity(identity);
    const { session } = this.access.session(id, identity);
    return this.runner.ask(session, accepted(checkQuestion(body)).text);
  }

  stop(id: string, identity: Identity | null): void {
    const { session } = this.access.session(id, identity);
    this.runner.stop(session.id);
  }

  events(id: string, identity: Identity | null, req: Request, res: Response): void {
    const { session } = this.access.session(id, identity);
    this.stream.serve(session.id, req, res);
  }

  evidenceOf(id: string, identity: Identity | null): ResearchEvidence {
    const { session } = this.access.session(id, identity);
    return { sessionId: session.id, citations: this.evidence.citationsOfSession(session.id).map((c) => this.views.citation(c)) };
  }

  summary(s: ResearchSessionRecord, w: WorkspaceRecord, identity: Identity | null): ResearchSessionSummary {
    return this.views.session(s, w, this.access.levelOf(w, identity) ?? "shared");
  }

  // Source ids of this very workspace: any other is as if it did not exist.
  private ownSources(w: WorkspaceRecord, ids: readonly string[]): string[] {
    return ids.map((id) => {
      const s = this.sources.get(id);
      if (s === null || s.workspaceId !== w.id) throw notFound("Source");
      return s.id;
    });
  }

  private lastRun(sessionId: string): ResearchRunInfo | null {
    const r = this.runs.latest(sessionId);
    if (r === null) return null;
    return { id: r.id, status: r.status, model: r.model, effort: r.effort, startedAt: r.startedAt, endedAt: r.endedAt, costUsd: r.costUsd, inputTokens: r.inputTokens, outputTokens: r.outputTokens, error: r.error, sources: this.runs.frozen(r.id), passages: r.passages };
  }
}

// A title of a session, a workspace or a source that a person typed: one line, bounded.
export const cleanTitleOf = (v: unknown): string | null => cleanName(v, RESEARCH_LIMITS.titleLength);
