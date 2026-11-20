// RESEARCH WORKSPACES: the persistent containers of knowledge -- sources, sessions, notes, findings -- of the account that
// created them and the accounts it shared them with. Deleting one removes everything it holds, rows and files, and
// asks for its name to be typed back first.
import { Inject, Injectable } from "@nestjs/common";
import { checkCreateWorkspace, checkDeleteWorkspace, checkUpdateAccess, checkUpdateWorkspace, type AccessList, type ResearchWorkspaceDetail, type ResearchWorkspaceSummary } from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import { EventBus } from "../../core/events/event-bus.js";
import { accepted, badRequest, conflict } from "../../common/errors.js";
import { requireIdentity } from "../access/ownership.service.js";
import type { Identity } from "../claude-auth/claude-auth.service.js";
import { ResearchAccess } from "./access.js";
import { OBJECT_STORE } from "./ingestion/ingestion.service.js";
import type { ObjectStore } from "./sources/object-store.js";
import { ResearchRunnerService } from "./runner/research-runner.service.js";
import { ResearchSessionStore } from "./store/sessions.js";
import { WorkspaceStore } from "./store/workspaces.js";
import { ResearchStream } from "./stream.js";
import { ResearchViews } from "./views.js";

export const STORAGE_NOTE = "On the Orbit server, in its data volume (/data/research and Orbit Web's database) -- not in this browser, and never in a repository.";

@Injectable()
export class ResearchWorkspacesService {
  constructor(
    @Inject(WorkspaceStore) private readonly workspaces: WorkspaceStore,
    @Inject(ResearchSessionStore) private readonly sessions: ResearchSessionStore,
    @Inject(ResearchAccess) private readonly access: ResearchAccess,
    @Inject(ResearchViews) private readonly views: ResearchViews,
    @Inject(ResearchRunnerService) private readonly runner: ResearchRunnerService,
    @Inject(ResearchStream) private readonly stream: ResearchStream,
    @Inject(OBJECT_STORE) private readonly objects: ObjectStore,
    @Inject(EventBus) private readonly bus: EventBus,
  ) {}

  list(identity: Identity | null): ResearchWorkspaceSummary[] {
    return this.access.visible(identity).map((w) => this.views.workspace(w, this.access.levelOf(w, identity) ?? "shared"));
  }

  create(body: unknown, identity: Identity | null): ResearchWorkspaceSummary {
    const owner = requireIdentity(identity);
    const req = accepted(checkCreateWorkspace(body));
    const w = this.workspaces.create({ id: randomUUID(), name: req.name, description: req.description, ownerEmail: owner.email, ownerOrg: owner.org });
    this.views.notifyWorkspace(w.id);
    return this.views.workspace(w, "owner");
  }

  detail(id: string, identity: Identity | null): ResearchWorkspaceDetail {
    const w = this.access.workspace(id, identity);
    const counts = this.workspaces.counts(w.id);
    return { ...this.views.workspace(w, this.access.levelOf(w, identity) ?? "shared"), noteCount: counts.notes, findingCount: counts.findings, storage: STORAGE_NOTE };
  }

  update(id: string, body: unknown, identity: Identity | null): ResearchWorkspaceSummary {
    const w = this.access.workspace(id, identity);
    const updated = this.workspaces.update(w.id, accepted(checkUpdateWorkspace(body)));
    this.views.notifyWorkspace(w.id);
    for (const s of this.sessions.ofWorkspace(w.id)) this.views.notifySession(s.id);
    return this.views.workspace(updated, this.access.levelOf(updated, identity) ?? "shared");
  }

  // Everything goes: its sources' rows and files, its sessions and their conversations, its notes and findings.
  async delete(id: string, body: unknown, identity: Identity | null): Promise<void> {
    const w = this.access.workspace(id, identity, "owner");
    const req = accepted(checkDeleteWorkspace(body));
    if (req.confirmName !== w.name) throw badRequest("confirmName does not match the workspace's name: type it back exactly to delete it.");
    const sessions = this.sessions.ofWorkspace(w.id);
    if (sessions.some((s) => this.runner.isRunning(s.id) || s.status === "running")) throw conflict("run_active", "A session of this workspace is still answering: stop it before deleting the workspace.");
    this.workspaces.delete(w.id);
    await this.objects.removeWorkspace(w.id);
    for (const s of sessions) {
      this.stream.forget(s.id);
      this.bus.publishApp("research.session.removed", { sessionId: s.id, workspaceId: w.id });
    }
    this.bus.publishApp("research.workspace.removed", { workspaceId: w.id });
  }

  people(id: string, identity: Identity | null): AccessList {
    const w = this.access.workspace(id, identity);
    return { access: this.access.levelOf(w, identity) ?? "shared", owner: w.ownerEmail, people: this.workspaces.people(w.id) };
  }

  share(id: string, body: unknown, identity: Identity | null): AccessList {
    const owner = requireIdentity(identity);
    const w = this.access.workspace(id, identity, "owner");
    const people = accepted(checkUpdateAccess(body)).people.filter((p) => p !== w.ownerEmail);
    this.workspaces.share(w.id, people, owner.email);
    return this.people(id, identity);
  }
}
