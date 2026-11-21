// RESEARCH SESSIONS: one conversation over the sources of a workspace it selects. A session needs no repository, no
// branch and no workspace on disk; its model and effort are held to the account's catalog. Its selection is kept per
// session and decides what a question may retrieve from. Deleting a session removes its conversation and runs, never a
// source: notes and findings stay, and the citations they refer to stay with them.
import { Inject, Injectable } from "@nestjs/common";
import { checkCreateResearchSession, checkQuestion, checkSelection, checkUpdateResearchSession, cleanName, RESEARCH_LIMITS, type ResearchEvidence, type ResearchMessage, type ResearchRunInfo, type ResearchSelection, type ResearchSessionDetail, type ResearchSessionSummary, type RunAccepted } from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { EventBus } from "../../core/events/event-bus.js";
import { accepted, conflict, notFound } from "../../common/errors.js";
import { redactSecrets } from "../../infra/security/redact.js";
import type { Owner } from "../auth/principal.js";
import { ClaudeModelsService } from "../connections/claude-models.service.js";
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
  async all(viewer: Owner): Promise<ResearchSessionSummary[]> {
    const workspaces = await this.access.visible(viewer);
    const byId = new Map(workspaces.map((w) => [w.id, w]));
    const levels = new Map<string, Awaited<ReturnType<ResearchAccess["levelOf"]>>>();
    for (const w of workspaces) levels.set(w.id, await this.access.levelOf(w, viewer));
    const list = (await this.sessions.ofWorkspaces([...byId.keys()])).map((s) => ({ session: s, workspace: byId.get(s.workspaceId) as WorkspaceRecord, access: levels.get(s.workspaceId) ?? "shared" }));
    return this.views.sessionList(list);
  }

  async ofWorkspace(workspaceId: string, viewer: Owner): Promise<ResearchSessionSummary[]> {
    const w = await this.access.workspace(workspaceId, viewer);
    const access = (await this.access.levelOf(w, viewer)) ?? "shared";
    return this.views.sessionList((await this.sessions.ofWorkspace(w.id)).map((s) => ({ session: s, workspace: w, access })));
  }

  // A session over the sources it selects (all the workspace's, unless named), with the account's model. A first
  // question is asked at once when a selected source is ready; otherwise it waits in the composer.
  async create(workspaceId: string, body: unknown, viewer: Owner): Promise<ResearchSessionDetail> {
    const w = await this.access.workspace(workspaceId, viewer);
    const req = accepted(checkCreateResearchSession(body));
    const defaults = await this.settings.get(viewer.accountId);
    const run = await this.models.settle(viewer.accountId, { model: req.model, effort: defaults.defaultEffort, mode: null }, req.effort ? { effort: req.effort } : {});
    const selection = req.sources === undefined ? (await this.sources.list(w.id)).map((s) => s.id) : await this.ownSources(w, req.sources);
    const session = await this.sessions.create({ id: randomUUID(), workspaceId: w.id, title: req.title ?? researchTitle(req.question, w.name), model: run.model, effort: run.effort, draftQuestion: req.question ?? null, createdBy: viewer.email }, selection);
    await this.workspaces.touch(w.id);
    await this.views.notifySession(session.id);
    await this.views.notifyWorkspace(w.id);
    if (req.question !== undefined && (await this.runner.freeze(session)).length > 0) await this.runner.ask(session, req.question, viewer);
    return this.detail(session.id, viewer);
  }

  async detail(id: string, viewer: Owner): Promise<ResearchSessionDetail> {
    const { session, workspace } = await this.access.session(id, viewer);
    const messages = await this.sessions.messages(session.id);
    const citations = await this.views.citations(await this.evidence.citationsOfMessages(messages.filter((m) => m.role === "assistant").map((m) => m.id)));
    const shown: ResearchMessage[] = messages.map((m) => ({ id: m.id, role: m.role, text: m.text, runId: m.runId, partial: m.partial, createdAt: m.createdAt, citations: citations.filter((c) => c.messageId === m.id) }));
    const selection = await this.sessions.selection(session.id);
    return {
      ...(await this.summary(session, workspace, viewer, selection.length)),
      lastSeq: session.lastSeq,
      selection,
      draftQuestion: session.draftQuestion,
      messages: shown,
      lastRun: await this.lastRun(session.id),
    };
  }

  async update(id: string, body: unknown, viewer: Owner): Promise<ResearchSessionSummary> {
    const { session, workspace } = await this.access.session(id, viewer);
    const change = accepted(checkUpdateResearchSession(body));
    const run = change.model !== undefined || change.effort !== undefined ? await this.models.settle(viewer.accountId, { model: session.model, effort: session.effort, mode: null }, change) : null;
    const updated = await this.sessions.update(session.id, { ...(change.title ? { title: change.title } : {}), ...(run !== null ? { model: run.model, effort: run.effort } : {}) });
    await this.views.notifySession(session.id);
    return this.summary(updated, workspace, viewer);
  }

  // The conversation and its runs go; the workspace's sources, notes and findings stay.
  async delete(id: string, viewer: Owner): Promise<void> {
    const { session, workspace } = await this.access.session(id, viewer);
    await this.access.mayRemove(workspace, session.createdBy, viewer);
    if (this.runner.isRunning(session.id) || session.status === "running") throw conflict("run_active", "Stop the run before deleting this research session.");
    const audience = await this.access.audience(workspace);
    await this.sessions.delete(session.id);
    await this.evidence.dropUnreferenced(workspace.id);
    this.stream.forget(session.id);
    await this.workspaces.touch(workspace.id);
    this.bus.publishApp("research.session.removed", { sessionId: session.id, workspaceId: workspace.id }, audience);
    await this.views.notifyWorkspace(workspace.id);
  }

  // Which sources the next question may retrieve from. A run already answering keeps the evidence it was frozen to.
  async select(id: string, body: unknown, viewer: Owner): Promise<ResearchSelection> {
    const { session, workspace } = await this.access.session(id, viewer);
    const selection = await this.sessions.setSelection(session.id, await this.ownSources(workspace, accepted(checkSelection(body)).sources));
    await this.views.notifySession(session.id);
    return { sessionId: session.id, selection };
  }

  async ask(id: string, body: unknown, viewer: Owner): Promise<RunAccepted> {
    const { session } = await this.access.session(id, viewer);
    return this.runner.ask(session, accepted(checkQuestion(body)).text, viewer);
  }

  async stop(id: string, viewer: Owner): Promise<void> {
    const { session } = await this.access.session(id, viewer);
    this.runner.stop(session.id);
  }

  // The session's stream, held for this browser session (closed with it).
  async events(id: string, viewer: Owner, req: Request, res: Response): Promise<void> {
    const { session } = await this.access.session(id, viewer);
    await this.stream.serve(session.id, { accountId: viewer.accountId, email: viewer.email, sessionId: viewer.sessionId }, req, res);
  }

  async evidenceOf(id: string, viewer: Owner): Promise<ResearchEvidence> {
    const { session } = await this.access.session(id, viewer);
    return { sessionId: session.id, citations: await this.views.citations(await this.evidence.citationsOfSession(session.id)) };
  }

  async summary(s: ResearchSessionRecord, w: WorkspaceRecord, viewer: Owner, selected?: number): Promise<ResearchSessionSummary> {
    return this.views.session(s, w, (await this.access.levelOf(w, viewer)) ?? "shared", selected);
  }

  // Source ids of this very workspace: any other is as if it did not exist.
  private async ownSources(w: WorkspaceRecord, ids: readonly string[]): Promise<string[]> {
    const out: string[] = [];
    for (const id of ids) {
      const s = await this.sources.get(id);
      if (s === null || s.workspaceId !== w.id || s.accountId !== w.accountId) throw notFound("Source");
      out.push(s.id);
    }
    return out;
  }

  private async lastRun(sessionId: string): Promise<ResearchRunInfo | null> {
    const r = await this.runs.latest(sessionId);
    if (r === null) return null;
    return { id: r.id, status: r.status, model: r.model, effort: r.effort, startedAt: r.startedAt, endedAt: r.endedAt, costUsd: r.costUsd, inputTokens: r.inputTokens, outputTokens: r.outputTokens, error: r.error, sources: await this.runs.frozen(r.id), passages: r.passages };
  }
}

// A title of a session, a workspace or a source that a person typed: one line, bounded.
export const cleanTitleOf = (v: unknown): string | null => cleanName(v, RESEARCH_LIMITS.titleLength);
