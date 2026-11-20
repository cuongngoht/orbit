// RESEARCH SOURCES of a workspace: a file uploaded (its bytes, never a form), a URL (fetched by the server, kept as a
// snapshot), or a text pasted. Each is stored on the server, read into text and indexed in the background
// (ingestion.service.ts), and offered to every session of the workspace. A source's text is shown back from what was
// extracted -- the original file is never served. Deleting a source removes its rows and, once no other revision of
// the workspace stores the same bytes, its file; a citation that quoted it keeps its quote.
import { Inject, Injectable } from "@nestjs/common";
import {
  checkAddTextSource,
  checkAddUrlSource,
  checkUpdateSource,
  cleanFileName,
  isResearchId,
  RESEARCH_MEDIA_TYPES,
  type ResearchChunkView,
  type ResearchMediaType,
  type ResearchSourceContent,
  type ResearchSourceRevision,
  type ResearchSourceSummary,
} from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "../../config/config.js";
import { EventBus } from "../../core/events/event-bus.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { accepted, ApiError, badRequest, conflict, notFound } from "../../common/errors.js";
import { requireIdentity } from "../access/ownership.service.js";
import type { Identity } from "../claude-auth/claude-auth.service.js";
import { ResearchAccess } from "./access.js";
import { detectUpload } from "./ingestion/detect.js";
import { IngestionService, OBJECT_STORE } from "./ingestion/ingestion.service.js";
import { sha256, type ObjectStore } from "./sources/object-store.js";
import { ResearchRunStore, ResearchSessionStore } from "./store/sessions.js";
import { SourceStore, type SourceRecord } from "./store/sources.js";
import { WorkspaceStore, type WorkspaceRecord } from "./store/workspaces.js";
import { revisionInfo, ResearchViews } from "./views.js";

// Chunks a preview window holds: the cited one and a few on each side.
const WINDOW = 12;

const titleOfFile = (name: string): string => name.replace(/\.[A-Za-z0-9]{1,9}$/, "").replace(/[_]+/g, " ").trim() || name;

const titleOfUrl = (raw: string): string => {
  const url = new URL(raw);
  const last = url.pathname.split("/").filter(Boolean).pop();
  return `${url.hostname}${last ? ` · ${decodeURIComponent(last).slice(0, 80)}` : ""}`;
};

@Injectable()
export class ResearchSourcesService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SourceStore) private readonly sources: SourceStore,
    @Inject(WorkspaceStore) private readonly workspaces: WorkspaceStore,
    @Inject(ResearchSessionStore) private readonly sessions: ResearchSessionStore,
    @Inject(ResearchRunStore) private readonly runs: ResearchRunStore,
    @Inject(ResearchAccess) private readonly access: ResearchAccess,
    @Inject(ResearchViews) private readonly views: ResearchViews,
    @Inject(IngestionService) private readonly ingestion: IngestionService,
    @Inject(OBJECT_STORE) private readonly objects: ObjectStore,
    @Inject(EventBus) private readonly bus: EventBus,
  ) {}

  list(workspaceId: string, identity: Identity | null): ResearchSourceSummary[] {
    const w = this.access.workspace(workspaceId, identity);
    return this.sources.list(w.id).map((s) => this.views.source(s));
  }

  // A file's own bytes, as its name says it is -- and is.
  async upload(workspaceId: string, rawName: unknown, bytes: Buffer, identity: Identity | null): Promise<ResearchSourceSummary> {
    const who = requireIdentity(identity);
    const w = this.access.workspace(workspaceId, identity);
    const name = cleanFileName(rawName);
    if (name === null) throw badRequest("Name the file in the x-orbit-filename header (URI-encoded).");
    if (bytes.length === 0) throw badRequest("The file is empty.");
    if (bytes.length > this.config.research.maxUploadBytes) throw tooLarge(this.config.research.maxUploadBytes);
    const detected = detectUpload(name, bytes);
    if (!detected.ok) throw new ApiError(415, "unsupported_source", detected.reason);
    return this.add(w, who, { kind: "upload", title: titleOfFile(name), origin: name, fileName: name, mediaType: detected.mediaType, bytes });
  }

  async text(workspaceId: string, body: unknown, identity: Identity | null): Promise<ResearchSourceSummary> {
    const who = requireIdentity(identity);
    const w = this.access.workspace(workspaceId, identity);
    const req = accepted(checkAddTextSource(body));
    return this.add(w, who, { kind: "text", title: req.title, origin: null, fileName: null, mediaType: req.format === "markdown" ? "markdown" : "text", bytes: Buffer.from(req.text, "utf8") });
  }

  // A URL: the source is made at once (queued), and the page is fetched in the background.
  url(workspaceId: string, body: unknown, identity: Identity | null): ResearchSourceSummary {
    const who = requireIdentity(identity);
    const w = this.access.workspace(workspaceId, identity);
    if (!this.config.research.urlImport) throw new ApiError(403, "url_import_off", "Importing from a URL is switched off on this Orbit Web (ORBIT_WEB_RESEARCH_URL_IMPORT=off). Upload the page as a file instead.");
    const req = accepted(checkAddUrlSource(body));
    const source = this.sources.create({ id: randomUUID(), workspaceId: w.id, kind: "url", title: req.title ?? titleOfUrl(req.url), origin: req.url, state: "queued", createdBy: who.email });
    this.added(w, source);
    this.ingestion.fetch(source.id);
    return this.views.source(source);
  }

  get(id: string, identity: Identity | null): ResearchSourceSummary {
    return this.views.source(this.access.source(id, identity).source);
  }

  revisions(id: string, identity: Identity | null): ResearchSourceRevision[] {
    const { source } = this.access.source(id, identity);
    return this.sources.revisions(source.id).map((r) => ({
      ...revisionInfo(r),
      byteSize: r.byteSize,
      mediaType: r.mediaType,
      fileName: r.fileName,
      url: r.url,
      finalUrl: r.finalUrl,
      status: r.status,
      error: r.error,
      createdAt: r.createdAt,
      current: r.id === source.currentRevisionId,
    }));
  }

  // A window of a revision's extracted text: around a chunk (a citation's), or from one; the current revision unless
  // another of this source is named.
  content(id: string, query: { revision?: unknown; around?: unknown; from?: unknown }, identity: Identity | null): ResearchSourceContent {
    const { source } = this.access.source(id, identity);
    const revisionId = query.revision === undefined ? source.currentRevisionId : isResearchId(query.revision) ? query.revision : null;
    const revision = revisionId === null ? null : this.sources.revision(revisionId);
    if (revision === null || revision.sourceId !== source.id) throw notFound("Revision");
    if (revision.status !== "indexed") throw conflict("not_indexed", "This revision's text is not indexed (yet).");
    const around = Number(query.around);
    const from = Number.isInteger(around) && around >= 0 ? Math.max(0, around - Math.floor(WINDOW / 2)) : Math.max(0, Number.isInteger(Number(query.from)) ? Number(query.from) : 0);
    const chunks: ResearchChunkView[] = this.sources.chunks(revision.id, from, WINDOW).map((c) => ({ ordinal: c.ordinal, page: c.page, section: c.section, charStart: c.charStart, charEnd: c.charEnd, text: c.text }));
    return { sourceId: source.id, revisionId: revision.id, revisionNumber: revision.number, current: revision.id === source.currentRevisionId, title: source.title, mediaType: revision.mediaType, totalChunks: revision.chunkCount, chunks };
  }

  rename(id: string, body: unknown, identity: Identity | null): ResearchSourceSummary {
    const { source } = this.access.source(id, identity);
    const renamed = this.sources.rename(source.id, accepted(checkUpdateSource(body)).title);
    this.views.notifySource(source.id);
    return this.views.source(renamed);
  }

  // A source that failed, read (or fetched) again from the start.
  retry(id: string, identity: Identity | null): ResearchSourceSummary {
    const { source } = this.access.source(id, identity);
    if (source.state !== "failed") throw conflict("not_failed", "Only a source that failed can be tried again.");
    if (source.kind === "url") return this.refetch(source);
    const latest = this.sources.latestRevision(source.id);
    if (latest === null) throw conflict("nothing_stored", "Nothing of this source was stored: add it again.");
    this.sources.restart(latest.id);
    const queued = this.sources.setState(source.id, "queued", null);
    this.views.notifySource(source.id);
    this.ingestion.read(latest.id);
    return this.views.source(queued);
  }

  // A URL fetched again: a new revision when the page changed; the earlier snapshot is used until it is indexed.
  refresh(id: string, identity: Identity | null): ResearchSourceSummary {
    const { source } = this.access.source(id, identity);
    if (source.kind !== "url") throw conflict("not_a_url", "Only a source imported from a URL can be refreshed.");
    if (source.state === "queued" || source.state === "processing") throw conflict("busy", "This source is already being read.");
    return this.refetch(source);
  }

  async delete(id: string, identity: Identity | null): Promise<void> {
    const { source, workspace } = this.access.source(id, identity);
    this.access.mayRemove(workspace, source.createdBy, identity);
    if (this.runs.runningInWorkspace(workspace.id)) throw conflict("run_active", "A session of this workspace is answering from its sources: wait for it to finish, or stop it, before deleting a source.");
    const hashes = this.sources.hashesOf(source.id);
    this.sources.delete(source.id);
    for (const hash of hashes) if (!this.sources.hashInUse(workspace.id, hash)) await this.objects.remove(workspace.id, hash);
    this.workspaces.touch(workspace.id);
    this.bus.publishApp("research.source.removed", { workspaceId: workspace.id, sourceId: source.id });
    this.views.notifyWorkspace(workspace.id);
    for (const s of this.sessions.ofWorkspace(workspace.id)) this.views.notifySession(s.id);
  }

  private refetch(source: SourceRecord): ResearchSourceSummary {
    if (!this.config.research.urlImport) throw new ApiError(403, "url_import_off", "Importing from a URL is switched off on this Orbit Web (ORBIT_WEB_RESEARCH_URL_IMPORT=off).");
    const queued = this.sources.setState(source.id, "queued", null);
    this.views.notifySource(source.id);
    this.ingestion.fetch(source.id);
    return this.views.source(queued);
  }

  private async add(w: WorkspaceRecord, who: Identity, o: { kind: "upload" | "text"; title: string; origin: string | null; fileName: string | null; mediaType: ResearchMediaType; bytes: Buffer }): Promise<ResearchSourceSummary> {
    if (!(RESEARCH_MEDIA_TYPES as readonly string[]).includes(o.mediaType)) throw new ApiError(415, "unsupported_source", "Research does not read this kind of document.");
    const hash = sha256(o.bytes);
    const twin = this.sources.list(w.id).find((s) => this.sources.hashesOf(s.id).includes(hash));
    if (twin !== undefined) throw conflict("duplicate_source", `This is already a source of the workspace: “${twin.title}”.`);
    const stored = await this.objects.put(w.id, o.bytes);
    const source = this.sources.create({ id: randomUUID(), workspaceId: w.id, kind: o.kind, title: o.title, origin: o.origin, state: "queued", createdBy: who.email });
    const revision = this.sources.addRevision({ id: randomUUID(), sourceId: source.id, workspaceId: w.id, contentHash: stored.hash, byteSize: stored.size, mediaType: o.mediaType, fileName: o.fileName, url: null, finalUrl: null, fetchedAt: null });
    this.added(w, source);
    this.ingestion.read(revision.id);
    return this.views.source(source);
  }

  // A new source is offered to every session that had all the workspace's sources selected.
  private added(w: WorkspaceRecord, source: SourceRecord): void {
    this.sessions.selectEverywhere(w.id, source.id);
    this.workspaces.touch(w.id);
    this.views.notifySource(source.id);
    this.views.notifyWorkspace(w.id);
    for (const s of this.sessions.ofWorkspace(w.id)) this.views.notifySession(s.id);
  }
}

export const tooLarge = (max: number): ApiError => new ApiError(413, "payload_too_large", `The file is larger than research reads (${Math.round(max / 1_048_576)} MB).`);
