// RESEARCH WORKSPACES: the persistent containers of knowledge -- sources, sessions, notes, findings -- of the ACCOUNT that
// created them and the accounts it shared them with. A workspace is registered with the account's governance in the
// transaction that creates it (its policy and audit can name it), and its deletion is said to governance too: what
// governance recorded about it stays. Deleting one removes everything it holds, rows and files, and asks for its name to
// be typed back first.
import { Inject, Injectable } from "@nestjs/common";
import { checkCreateWorkspace, checkDeleteWorkspace, checkUpdateAccess, checkUpdateWorkspace, type AccessList, type ResearchWorkspaceDetail, type ResearchWorkspaceSummary } from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import { EventBus } from "../../core/events/event-bus.js";
import { accepted, badRequest, conflict } from "../../common/errors.js";
import { Db } from "../../infra/db/db.js";
import { contextOf, type Owner } from "../auth/principal.js";
import { GovernedResources } from "../governance/resources.service.js";
import { ResearchAccess } from "./access.js";
import { OBJECT_STORE } from "./ingestion/ingestion.service.js";
import type { ObjectStore } from "./sources/object-store.js";
import { ResearchRunnerService } from "./runner/research-runner.service.js";
import { ResearchSessionStore } from "./store/sessions.js";
import { WorkspaceStore } from "./store/workspaces.js";
import { ResearchStream } from "./stream.js";
import { ResearchViews } from "./views.js";

export const STORAGE_NOTE = "On the Orbit server, in its data volume (/data/research) and Orbit Web's PostgreSQL database -- not in this browser, and never in a repository.";

@Injectable()
export class ResearchWorkspacesService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(WorkspaceStore) private readonly workspaces: WorkspaceStore,
    @Inject(ResearchSessionStore) private readonly sessions: ResearchSessionStore,
    @Inject(ResearchAccess) private readonly access: ResearchAccess,
    @Inject(ResearchViews) private readonly views: ResearchViews,
    @Inject(ResearchRunnerService) private readonly runner: ResearchRunnerService,
    @Inject(ResearchStream) private readonly stream: ResearchStream,
    @Inject(GovernedResources) private readonly resources: GovernedResources,
    @Inject(OBJECT_STORE) private readonly objects: ObjectStore,
    @Inject(EventBus) private readonly bus: EventBus,
  ) {}

  async list(viewer: Owner): Promise<ResearchWorkspaceSummary[]> {
    const out: ResearchWorkspaceSummary[] = [];
    for (const w of await this.access.visible(viewer)) out.push(await this.views.workspace(w, (await this.access.levelOf(w, viewer)) ?? "shared"));
    return out;
  }

  // A workspace of the viewer's own account, registered with its governance in the same transaction.
  async create(body: unknown, viewer: Owner): Promise<ResearchWorkspaceSummary> {
    const req = accepted(checkCreateWorkspace(body));
    const w = await this.db.tx(async () => {
      const made = await this.workspaces.create({ id: randomUUID(), accountId: viewer.accountId, ownerEmail: viewer.email, name: req.name, description: req.description });
      await this.resources.register("research_workspace", { accountId: made.accountId, id: made.id, title: made.name });
      return made;
    });
    await this.views.notifyWorkspace(w.id);
    return this.views.workspace(w, "owner");
  }

  async detail(id: string, viewer: Owner): Promise<ResearchWorkspaceDetail> {
    const w = await this.access.workspace(id, viewer);
    const counts = await this.workspaces.counts(w.id);
    return { ...(await this.views.workspace(w, (await this.access.levelOf(w, viewer)) ?? "shared")), noteCount: counts.notes, findingCount: counts.findings, storage: STORAGE_NOTE };
  }

  async update(id: string, body: unknown, viewer: Owner): Promise<ResearchWorkspaceSummary> {
    const w = await this.access.workspace(id, viewer);
    const change = accepted(checkUpdateWorkspace(body));
    const updated = await this.db.tx(async () => {
      const next = await this.workspaces.update(w.id, change);
      // Governance names it by its title too.
      if (change.name !== undefined) await this.resources.retitle("research_workspace", next.accountId, next.id, next.name);
      return next;
    });
    await this.views.notifyWorkspace(w.id);
    await this.views.notifySessionsOf(w.id);
    return this.views.workspace(updated, (await this.access.levelOf(updated, viewer)) ?? "shared");
  }

  // Everything goes: its sources' rows and files, its sessions and their conversations, its notes and findings. Who is
  // told is worked out first -- once it is gone, nothing says who it was shared with.
  async delete(id: string, body: unknown, viewer: Owner): Promise<void> {
    const w = await this.access.workspace(id, viewer, "owner");
    const req = accepted(checkDeleteWorkspace(body));
    if (req.confirmName !== w.name) throw badRequest("confirmName does not match the workspace's name: type it back exactly to delete it.");
    const sessions = await this.sessions.ofWorkspace(w.id);
    if (sessions.some((s) => this.runner.isRunning(s.id) || s.status === "running")) throw conflict("run_active", "A session of this workspace is still answering: stop it before deleting the workspace.");
    const audience = await this.access.audience(w);
    await this.db.tx(async () => {
      await this.workspaces.delete(w.id);
      await this.resources.deleted("research_workspace", w.accountId, w.id, contextOf(viewer));
    });
    await this.objects.removeWorkspace(w.id);
    for (const s of sessions) {
      this.stream.forget(s.id);
      this.bus.publishApp("research.session.removed", { sessionId: s.id, workspaceId: w.id }, audience);
    }
    this.bus.publishApp("research.workspace.removed", { workspaceId: w.id }, audience);
  }

  async people(id: string, viewer: Owner): Promise<AccessList> {
    const w = await this.access.workspace(id, viewer);
    return { access: (await this.access.levelOf(w, viewer)) ?? "shared", owner: w.ownerEmail, people: await this.workspaces.people(w.id) };
  }

  // The owner names everyone it is shared with (its own email is never on the list: it owns it).
  async share(id: string, body: unknown, viewer: Owner): Promise<AccessList> {
    const w = await this.access.workspace(id, viewer, "owner");
    const people = accepted(checkUpdateAccess(body)).people.filter((p) => p !== w.ownerEmail && p !== viewer.email);
    await this.workspaces.share(w, people, viewer.email);
    await this.views.notifyWorkspace(w.id);
    return this.people(id, viewer);
  }
}
