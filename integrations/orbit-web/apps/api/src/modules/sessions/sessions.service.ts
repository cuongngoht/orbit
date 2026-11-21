// Chat sessions: a workspace (cloned from a repository of either source, or empty), one model, effort and mode
// preference, one Claude Code conversation. A chat belongs to the ACCOUNT whose owner started it, and is one of the
// resources that account's governance holds (governed by its policy, audited on its chain). A session publishes what
// happens to it on the event bus: its own stream (`session.status`) and, for the pages of whoever may open it, the app
// stream (`session.summary`, `session.removed`).
import { Inject, Injectable } from "@nestjs/common";
import { checkCreateSession, checkUpdateSession, type AccessLevel, type ChatMessage, type ImageRef, type SessionDetail, type SessionSummary } from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { AgentFs } from "../../infra/process/agent-fs.js";
import { MirrorService } from "../sources/mirror.service.js";
import { join } from "node:path";
import type { AppConfig } from "../../config/config.js";
import { EventBus } from "../../core/events/event-bus.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { accepted, conflict, notFound } from "../../common/errors.js";
import { viewer } from "../../common/request-scope.js";
import { isSessionId } from "../../common/workspace-path.js";
import { Db } from "../../infra/db/db.js";
import { redactSecrets } from "../../infra/security/redact.js";
import { ImageFiles } from "../../infra/storage/image-files.js";
import { ImageStore, imageRefOf, MessageStore, SessionStore, type SessionRecord, type Viewer } from "../../infra/storage/stores.js";
import { ImagesService } from "../images/images.service.js";
import { OwnershipService } from "../access/ownership.service.js";
import type { GovernanceContext } from "../auth/principal.js";
import { ClaudeModelsService } from "../connections/claude-models.service.js";
import { RunConnections } from "../connections/run-connections.js";
import { ClaudeRunnerService } from "../claude-runner/claude-runner.service.js";
import { GovernedResources } from "../governance/resources.service.js";
import { SettingsService } from "../settings/settings.module.js";
import { SourcesService } from "../sources/sources.module.js";
import { WorkspaceService } from "./workspace.service.js";

// A chat as an account sees it: `access` is that account's (its own, or shared with it).
export const summaryOf = (s: SessionRecord, access: AccessLevel = "owner"): SessionSummary => ({
  id: s.id,
  title: s.title,
  source: s.source,
  repository: s.repository,
  branch: s.branch,
  workBranch: s.workBranch,
  model: s.model,
  effort: s.effort,
  mode: s.mode,
  status: s.status,
  statusReason: s.statusReason,
  access,
  owner: s.ownerEmail,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

// How a viewer the gate let through sees a chat: its own account's, or shared with it.
export const levelFor = (s: SessionRecord, who: Viewer): AccessLevel => (s.accountId === who.accountId ? "owner" : "shared");

// The chat as it is now, to the pages of its owner account (`owner`) and of the people it is shared with (`shared`).
export async function publishSummary(bus: EventBus, ownership: OwnershipService, s: SessionRecord): Promise<void> {
  bus.publishApp("session.summary", { session: summaryOf(s, "owner") }, ownership.ownerAudience(s));
  const shared = await ownership.sharedAudience(s);
  if (shared !== null) bus.publishApp("session.summary", { session: summaryOf(s, "shared") }, shared);
}

// The first line of the first message, masked by token shape BEFORE it is cut: a credential cut in half no longer has
// its shape, and a title is shown everywhere (the sidebar, a shared chat's page).
export const titleFrom = (prompt: string | undefined, repository: string | null): string => {
  const line = redactSecrets((prompt ?? "").trim().split("\n")[0]?.trim() ?? "");
  if (line.length === 0) return repository === null ? "New chat" : `Chat on ${repository}`;
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
};

@Injectable()
export class SessionsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(Db) private readonly db: Db,
    @Inject(SessionStore) private readonly sessions: SessionStore,
    @Inject(MessageStore) private readonly messages: MessageStore,
    @Inject(EventBus) private readonly bus: EventBus,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(SourcesService) private readonly sources: SourcesService,
    @Inject(WorkspaceService) private readonly workspaces: WorkspaceService,
    @Inject(ClaudeRunnerService) private readonly runner: ClaudeRunnerService,
    @Inject(GovernedResources) private readonly resources: GovernedResources,
    @Inject(AgentFs) private readonly files: AgentFs,
    @Inject(MirrorService) private readonly mirror: MirrorService,
    @Inject(OwnershipService) private readonly ownership: OwnershipService,
    @Inject(ClaudeModelsService) private readonly models: ClaudeModelsService,
    @Inject(ImagesService) private readonly images: ImagesService,
    @Inject(ImageStore) private readonly imageRows: ImageStore,
    @Inject(ImageFiles) private readonly imageFiles: ImageFiles,
    @Inject(RunConnections) private readonly connections: RunConnections,
  ) {}

  // The chats of the viewer's account: its own, and those shared with the viewer's share address.
  async list(): Promise<SessionSummary[]> {
    const who = viewer();
    return (await this.ownership.visible(who)).map((s) => summaryOf(s, levelFor(s, who)));
  }

  async detail(id: string): Promise<SessionDetail> {
    const s = await this.record(id);
    const messages = await this.withImages(id, await this.messages.list(id));
    return { ...this.summary(s), baseCommit: s.baseCommit, claudeSessionId: s.turns > 0 ? s.claudeSessionId : null, turns: s.turns, lastSeq: s.lastSeq, messages };
  }

  // Each person's message with the images it carried, in the order they were sent.
  private async withImages(id: string, messages: ChatMessage[]): Promise<ChatMessage[]> {
    const byMessage = new Map<string, ImageRef[]>();
    for (const image of await this.imageRows.sentIn(id)) byMessage.set(image.messageId as string, [...(byMessage.get(image.messageId as string) ?? []), imageRefOf(image)]);
    return byMessage.size === 0 ? messages : messages.map((m) => (byMessage.has(m.id) ? { ...m, images: byMessage.get(m.id) } : m));
  }

  // As the viewer of this request sees it.
  summary(s: SessionRecord): SessionSummary {
    return summaryOf(s, levelFor(s, viewer()));
  }

  // With a repository: it must be one its source lists, and the branch one of its branches (its default when none was
  // named). Without one: an empty workspace. The chat is the viewer's account's -- registered as that account's
  // governed resource in the same transaction -- and its workspace is prepared in the background; the first prompt,
  // when given, is sent once it is ready, as the owner who started the chat.
  async create(body: unknown): Promise<SessionSummary> {
    const req = accepted(checkCreateSession(body));
    const who = viewer();
    // A chat runs on the account's own Claude Code connection: none connected, no chat (409, nothing made).
    await this.connections.require(who.accountId);
    // The first message's images: the creator's own uploads, unsent -- held before anything is made.
    const imageIds = req.images ?? [];
    await this.images.owned(imageIds, who, null);
    const prefs = await this.settings.get(who.accountId);
    // The model, effort and mode, held to what this account may use.
    const run = await this.models.settle(who.accountId, { model: req.model, effort: prefs.defaultEffort, mode: prefs.defaultMode }, { ...(req.effort ? { effort: req.effort } : {}), ...(req.mode ? { mode: req.mode } : {}) });
    const origin = req.repository ? await this.sources.open(req.repository, req.branch ?? null) : null;
    const id = randomUUID();
    const session = await this.db.tx(async () => {
      const created = await this.sessions.create({
        id,
        accountId: who.accountId,
        ownerEmail: who.email,
        title: req.title ?? titleFrom(req.prompt, origin?.fullName ?? null),
        source: origin?.source ?? null,
        repository: origin?.fullName ?? null,
        repositoryId: origin?.id ?? null,
        branch: origin?.branch ?? null,
        model: run.model,
        effort: run.effort,
        mode: run.mode ?? prefs.defaultMode,
        workspacePath: this.workspaces.pathFor(id),
        claudeSessionId: randomUUID(),
        status: "preparing",
        pendingPrompt: req.prompt ?? (imageIds.length > 0 ? "" : null),
      });
      await this.resources.register("workspace", { accountId: created.accountId, id: created.id, title: created.title });
      await this.images.claim(imageIds, who, created);
      await this.bus.publishSession(id, "session.status", { status: "preparing", reason: null });
      return created;
    });
    void this.workspaces.prepare(session, who);
    return summaryOf(session, "owner");
  }

  // A rename, or the model, effort or mode of the next message -- held to what the viewer's account may use (an effort
  // the new model does not take moves to one it does).
  async update(id: string, body: unknown): Promise<SessionSummary> {
    const s = await this.record(id);
    const who = viewer();
    const change = accepted(checkUpdateSession(body));
    const runChanged = change.model !== undefined || change.effort !== undefined || change.mode !== undefined;
    const run = runChanged ? await this.models.settle(who.accountId, { model: s.model, effort: s.effort, mode: s.mode }, change) : null;
    const updated = await this.db.tx(async () => {
      const next = await this.sessions.update(id, { ...change, ...(run !== null ? { model: run.model, effort: run.effort, mode: run.mode ?? s.mode } : {}) });
      if (change.title !== undefined) await this.resources.retitle("workspace", next.accountId, next.id, next.title);
      return next;
    });
    await publishSummary(this.bus, this.ownership, updated);
    return summaryOf(updated, levelFor(updated, who));
  }

  // Removes the chat, its events and its workspace. Claude Code's own transcript and Orbit's store keep what they
  // recorded, as each of them keeps it -- and so does governance: the chat stays on its account's record as a resource
  // that was deleted, with its audit, approvals and decisions, which a chat's deletion never reaches. The deletion
  // itself is recorded there in the same transaction; if it cannot be, nothing is deleted.
  async delete(id: string, ctx: GovernanceContext): Promise<void> {
    const s = await this.record(id);
    if (s.status === "running" || this.runner.isRunning(id)) throw conflict("run_active", "Stop the run before deleting this chat.");
    if (this.runner.isBusy(id)) throw conflict("workspace_busy", "Wait until the working branch has moved before deleting this chat.");
    if (s.status === "preparing") throw conflict("workspace_preparing", "Wait until the workspace is prepared (or fails) before deleting this chat.");
    // Who is told it is gone: read before its sharing goes with it.
    const audience = await this.ownership.audience(s);
    const images = await this.imageRows.idsOf(id);
    // Its images' records go with it (they refer to it); their files are removed here.
    await this.db.tx(async () => {
      await this.resources.deleted("workspace", s.accountId, id, ctx);
      await this.sessions.delete(id);
    });
    await this.imageFiles.remove(images);
    await this.workspaces.remove(id);
    await this.files.rmrf(join(this.config.data.sessions, id));
    // The control plane's own copy of the repository: its own to remove.
    rmSync(this.mirror.path(id), { recursive: true, force: true });
    this.bus.publishApp("session.removed", { sessionId: id }, audience);
  }

  async record(id: string): Promise<SessionRecord> {
    if (!isSessionId(id)) throw notFound("Session");
    const s = await this.sessions.get(id);
    if (!s) throw notFound("Session");
    return s;
  }
}
