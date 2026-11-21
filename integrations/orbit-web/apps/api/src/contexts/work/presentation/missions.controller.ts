// WORK's routes: giving work, deciding on its results, and what needs the owner. Every route is the owner's (the
// session's account). A new mission names its request once (Idempotency-Key); a command on an assignment names the
// version it was made against (If-Match → 412), and a review names the handoff digest the person looked at (→ 409).
//
//   GET  /api/missions?state=open|closed&employee=&cursor=     missions, newest change first
//   POST /api/missions                                         give work: 201 claimed now · 202 queued · 409 busy
//   GET  /api/missions/:id                                     one mission in full (assignments, handoffs, timeline)
//   POST /api/assignments/:id/accept                           { handoffDigest, note? }
//   POST /api/assignments/:id/request-revision                 { handoffDigest, criteria }
//   POST /api/assignments/:id/cancel | pause                   { reason? }
//   POST /api/assignments/:id/resume | retry                   {}
//   POST /api/assignments/:id/answer                           { answer }
//   GET  /api/inbox?state=open|history&cursor=                 Needs me
//   GET  /api/artifacts/:id/content                            an artifact's bytes (verified against its hash)
import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Query, Req, Res, StreamableFile } from "@nestjs/common";
import { isWorkforceId, type CommandResult, type Inbox, type MissionDetail, type MissionList } from "@orbit-web/contracts";
import type { Request, Response } from "express";
import { ApiError, notFound } from "../../../common/errors.js";
import { ArtifactStore } from "../../execution/infrastructure/artifact-store.js";
import { ownerActor } from "../../shared/application/commands.js";
import { expectedVersion, sendStored } from "../../shared/presentation/http.js";
import { MissionQueries } from "../application/mission.queries.js";
import { MissionsService } from "../application/missions.service.js";

// What a browser may show in place (a sandboxed page, never script); everything else downloads.
const INLINE: Record<string, string> = {
  "text/markdown": "text/plain; charset=utf-8",
  "text/plain": "text/plain; charset=utf-8",
  "text/csv": "text/plain; charset=utf-8",
  "application/json": "application/json; charset=utf-8",
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "application/pdf": "application/pdf",
};

const safeName = (name: string): string => name.replace(/[^\w.\- ]/g, "_").slice(0, 120) || "artifact";

@Controller()
export class MissionsController {
  constructor(
    @Inject(MissionsService) private readonly missions: MissionsService,
    @Inject(MissionQueries) private readonly queries: MissionQueries,
    @Inject(ArtifactStore) private readonly artifacts: ArtifactStore,
  ) {}

  @Get("missions")
  list(@Query("state") state?: string, @Query("employee") employee?: string, @Query("cursor") cursor?: string): Promise<MissionList> {
    return this.queries.list(ownerActor().command.orbitId, { state, employee, cursor });
  }

  @Post("missions")
  async create(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<unknown> {
    const answer = await this.missions.create(ownerActor(), body, req.headers["idempotency-key"]);
    return sendStored(res, answer);
  }

  @Get("missions/:id")
  mission(@Param("id") id: string): Promise<MissionDetail> {
    return this.queries.detail(ownerActor().command.orbitId, id);
  }

  @Post("assignments/:id/accept")
  @HttpCode(HttpStatus.OK)
  accept(@Param("id") id: string, @Body() body: unknown, @Req() req: Request): Promise<CommandResult> {
    return this.missions.accept(ownerActor(), id, body, expectedVersion(req));
  }

  @Post("assignments/:id/request-revision")
  @HttpCode(HttpStatus.OK)
  requestRevision(@Param("id") id: string, @Body() body: unknown, @Req() req: Request): Promise<CommandResult> {
    return this.missions.requestRevision(ownerActor(), id, body, expectedVersion(req));
  }

  @Post("assignments/:id/cancel")
  @HttpCode(HttpStatus.OK)
  cancel(@Param("id") id: string, @Body() body: unknown, @Req() req: Request): Promise<CommandResult> {
    return this.missions.cancel(ownerActor(), id, body ?? {}, expectedVersion(req));
  }

  @Post("assignments/:id/pause")
  @HttpCode(HttpStatus.OK)
  pause(@Param("id") id: string, @Body() body: unknown, @Req() req: Request): Promise<CommandResult> {
    return this.missions.pause(ownerActor(), id, body ?? {}, expectedVersion(req));
  }

  @Post("assignments/:id/resume")
  @HttpCode(HttpStatus.OK)
  resume(@Param("id") id: string, @Req() req: Request): Promise<CommandResult> {
    return this.missions.resume(ownerActor(), id, expectedVersion(req));
  }

  @Post("assignments/:id/retry")
  @HttpCode(HttpStatus.OK)
  retry(@Param("id") id: string, @Req() req: Request): Promise<CommandResult> {
    return this.missions.retry(ownerActor(), id, expectedVersion(req));
  }

  @Post("assignments/:id/answer")
  @HttpCode(HttpStatus.OK)
  answer(@Param("id") id: string, @Body() body: unknown, @Req() req: Request): Promise<CommandResult> {
    return this.missions.answer(ownerActor(), id, body, expectedVersion(req));
  }

  @Get("inbox")
  inbox(@Query("state") state?: string, @Query("cursor") cursor?: string): Promise<Inbox> {
    return this.queries.inbox(ownerActor().command.orbitId, { open: state !== "history", cursor: cursor !== undefined && isWorkforceId(cursor) ? cursor : null });
  }

  // The bytes of an artifact of the session's account, verified against their hash before they are sent. Never shown as
  // a page that could run script: a type a browser may show is sent sandboxed; anything else downloads.
  @Get("artifacts/:id/content")
  async content(@Param("id") id: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const orbitId = ownerActor().command.orbitId;
    const a = await this.queries.artifact(orbitId, id);
    if (a === null) throw notFound("The artifact");
    const bytes = this.artifacts.read(orbitId, a.sha256);
    if (bytes === null) throw new ApiError(HttpStatus.CONFLICT, "artifact_unavailable", "The artifact's bytes are missing or do not match their hash: restore them from a backup.");
    const inline = INLINE[a.mediaType];
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
    res.setHeader("Content-Type", inline ?? "application/octet-stream");
    res.setHeader("Content-Disposition", `${inline !== undefined ? "inline" : "attachment"}; filename="${safeName(a.name)}"`);
    res.setHeader("ETag", `"${a.sha256}"`);
    return new StreamableFile(bytes);
  }
}
