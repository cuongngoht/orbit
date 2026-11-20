// /api/research/... -- every route behind the Claude sign-in, every one answering only an account that may open the
// workspace it reaches (access.ts). The one body that is not JSON is an uploaded source: the file's own bytes
// (application/octet-stream), its name in the x-orbit-filename header, read here up to the upload bound -- the
// mutation guard lets that one route's octet-stream through and holds it to the same header and origin as any change.
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, Req, Res } from "@nestjs/common";
import { UPLOAD_NAME_HEADER, type AccessList, type ResearchEvidence, type ResearchFinding, type ResearchNote, type ResearchSelection, type ResearchSessionDetail, type ResearchSessionSummary, type ResearchSourceContent, type ResearchSourceRevision, type ResearchSourceSummary, type ResearchWorkspaceDetail, type ResearchWorkspaceSummary, type RunAccepted } from "@orbit-web/contracts";
import type { Request, Response } from "express";
import type { AppConfig } from "../../config/config.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { ApiError } from "../../common/errors.js";
import { readRawBody } from "../../common/raw-body.js";
import { ResearchAccess } from "./access.js";
import { ResearchEvidenceService } from "./evidence.service.js";
import { ResearchSessionsService } from "./sessions.service.js";
import { ResearchSourcesService, tooLarge } from "./sources.service.js";
import { ResearchWorkspacesService } from "./workspaces.service.js";

@Controller("research")
export class ResearchController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ResearchAccess) private readonly access: ResearchAccess,
    @Inject(ResearchWorkspacesService) private readonly workspaces: ResearchWorkspacesService,
    @Inject(ResearchSourcesService) private readonly sources: ResearchSourcesService,
    @Inject(ResearchSessionsService) private readonly sessions: ResearchSessionsService,
    @Inject(ResearchEvidenceService) private readonly evidence: ResearchEvidenceService,
  ) {}

  @Get("workspaces")
  async listWorkspaces(): Promise<ResearchWorkspaceSummary[]> {
    return this.workspaces.list(await this.access.viewer());
  }

  @Post("workspaces")
  @HttpCode(201)
  async createWorkspace(@Body() body: unknown): Promise<ResearchWorkspaceSummary> {
    return this.workspaces.create(body, await this.access.viewer());
  }

  @Get("workspaces/:id")
  async workspace(@Param("id") id: string): Promise<ResearchWorkspaceDetail> {
    return this.workspaces.detail(id, await this.access.viewer());
  }

  @Patch("workspaces/:id")
  async updateWorkspace(@Param("id") id: string, @Body() body: unknown): Promise<ResearchWorkspaceSummary> {
    return this.workspaces.update(id, body, await this.access.viewer());
  }

  @Delete("workspaces/:id")
  @HttpCode(204)
  async deleteWorkspace(@Param("id") id: string, @Body() body: unknown): Promise<void> {
    await this.workspaces.delete(id, body, await this.access.viewer());
  }

  @Get("workspaces/:id/access")
  async workspacePeople(@Param("id") id: string): Promise<AccessList> {
    return this.workspaces.people(id, await this.access.viewer());
  }

  @Put("workspaces/:id/access")
  async shareWorkspace(@Param("id") id: string, @Body() body: unknown): Promise<AccessList> {
    return this.workspaces.share(id, body, await this.access.viewer());
  }

  @Get("workspaces/:id/sources")
  async listSources(@Param("id") id: string): Promise<ResearchSourceSummary[]> {
    return this.sources.list(id, await this.access.viewer());
  }

  @Post("workspaces/:id/sources/upload")
  @HttpCode(202)
  async upload(@Param("id") id: string, @Req() req: Request): Promise<ResearchSourceSummary> {
    const identity = await this.access.viewer();
    this.access.workspace(id, identity);
    if (!String(req.headers["content-type"] ?? "").startsWith("application/octet-stream")) throw new ApiError(415, "octet_stream_required", "Send the file's own bytes as application/octet-stream.");
    const bytes = await readRawBody(req, this.config.research.maxUploadBytes, tooLarge);
    return this.sources.upload(id, req.headers[UPLOAD_NAME_HEADER], bytes, identity);
  }

  @Post("workspaces/:id/sources/url")
  @HttpCode(202)
  async addUrl(@Param("id") id: string, @Body() body: unknown): Promise<ResearchSourceSummary> {
    return this.sources.url(id, body, await this.access.viewer());
  }

  @Post("workspaces/:id/sources/text")
  @HttpCode(202)
  async addText(@Param("id") id: string, @Body() body: unknown): Promise<ResearchSourceSummary> {
    return this.sources.text(id, body, await this.access.viewer());
  }

  @Get("workspaces/:id/sessions")
  async workspaceSessions(@Param("id") id: string): Promise<ResearchSessionSummary[]> {
    return this.sessions.ofWorkspace(id, await this.access.viewer());
  }

  @Post("workspaces/:id/sessions")
  @HttpCode(201)
  async createSession(@Param("id") id: string, @Body() body: unknown): Promise<ResearchSessionDetail> {
    return this.sessions.create(id, body, await this.access.viewer());
  }

  @Get("workspaces/:id/notes")
  async notes(@Param("id") id: string): Promise<ResearchNote[]> {
    return this.evidence.notes(id, await this.access.viewer());
  }

  @Post("workspaces/:id/notes")
  @HttpCode(201)
  async createNote(@Param("id") id: string, @Body() body: unknown): Promise<ResearchNote> {
    return this.evidence.createNote(id, body, await this.access.viewer());
  }

  @Get("workspaces/:id/findings")
  async findings(@Param("id") id: string): Promise<ResearchFinding[]> {
    return this.evidence.findings(id, await this.access.viewer());
  }

  @Post("workspaces/:id/findings")
  @HttpCode(201)
  async createFinding(@Param("id") id: string, @Body() body: unknown): Promise<ResearchFinding> {
    return this.evidence.createFinding(id, body, await this.access.viewer());
  }

  @Get("sources/:id")
  async source(@Param("id") id: string): Promise<ResearchSourceSummary> {
    return this.sources.get(id, await this.access.viewer());
  }

  @Patch("sources/:id")
  async renameSource(@Param("id") id: string, @Body() body: unknown): Promise<ResearchSourceSummary> {
    return this.sources.rename(id, body, await this.access.viewer());
  }

  @Delete("sources/:id")
  @HttpCode(204)
  async deleteSource(@Param("id") id: string): Promise<void> {
    await this.sources.delete(id, await this.access.viewer());
  }

  @Get("sources/:id/content")
  async content(@Param("id") id: string, @Query("revision") revision?: unknown, @Query("around") around?: unknown, @Query("from") from?: unknown): Promise<ResearchSourceContent> {
    return this.sources.content(id, { revision, around, from }, await this.access.viewer());
  }

  @Get("sources/:id/revisions")
  async revisions(@Param("id") id: string): Promise<ResearchSourceRevision[]> {
    return this.sources.revisions(id, await this.access.viewer());
  }

  @Post("sources/:id/retry")
  @HttpCode(202)
  async retry(@Param("id") id: string): Promise<ResearchSourceSummary> {
    return this.sources.retry(id, await this.access.viewer());
  }

  @Post("sources/:id/refresh")
  @HttpCode(202)
  async refresh(@Param("id") id: string): Promise<ResearchSourceSummary> {
    return this.sources.refresh(id, await this.access.viewer());
  }

  @Get("sessions")
  async allSessions(): Promise<ResearchSessionSummary[]> {
    return this.sessions.all(await this.access.viewer());
  }

  @Get("sessions/:id")
  async session(@Param("id") id: string): Promise<ResearchSessionDetail> {
    return this.sessions.detail(id, await this.access.viewer());
  }

  @Patch("sessions/:id")
  async updateSession(@Param("id") id: string, @Body() body: unknown): Promise<ResearchSessionSummary> {
    return this.sessions.update(id, body, await this.access.viewer());
  }

  @Delete("sessions/:id")
  @HttpCode(204)
  async deleteSession(@Param("id") id: string): Promise<void> {
    this.sessions.delete(id, await this.access.viewer());
  }

  @Put("sessions/:id/sources")
  async select(@Param("id") id: string, @Body() body: unknown): Promise<ResearchSelection> {
    return this.sessions.select(id, body, await this.access.viewer());
  }

  @Post("sessions/:id/messages")
  @HttpCode(202)
  async ask(@Param("id") id: string, @Body() body: unknown): Promise<RunAccepted> {
    return this.sessions.ask(id, body, await this.access.viewer());
  }

  @Post("sessions/:id/stop")
  @HttpCode(202)
  async stop(@Param("id") id: string): Promise<void> {
    this.sessions.stop(id, await this.access.viewer());
  }

  @Get("sessions/:id/events")
  async events(@Param("id") id: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    this.sessions.events(id, await this.access.viewer(), req, res);
  }

  @Get("sessions/:id/evidence")
  async sessionEvidence(@Param("id") id: string): Promise<ResearchEvidence> {
    return this.sessions.evidenceOf(id, await this.access.viewer());
  }

  @Patch("notes/:id")
  async updateNote(@Param("id") id: string, @Body() body: unknown): Promise<ResearchNote> {
    return this.evidence.updateNote(id, body, await this.access.viewer());
  }

  @Delete("notes/:id")
  @HttpCode(204)
  async deleteNote(@Param("id") id: string): Promise<void> {
    this.evidence.deleteNote(id, await this.access.viewer());
  }

  @Patch("findings/:id")
  async updateFinding(@Param("id") id: string, @Body() body: unknown): Promise<ResearchFinding> {
    return this.evidence.updateFinding(id, body, await this.access.viewer());
  }

  @Delete("findings/:id")
  @HttpCode(204)
  async deleteFinding(@Param("id") id: string): Promise<void> {
    this.evidence.deleteFinding(id, await this.access.viewer());
  }
}
