// The conversation of a session: send a message (a new turn of Claude Code), follow its session stream over SSE (the
// stream gateway: replayed from the journal after Last-Event-ID, then live), stop the run, and read the Orbit panel.
import { Body, Controller, Get, HttpCode, Inject, Module, Param, Post, Req, Res } from "@nestjs/common";
import { checkSendMessage, type OrbitPanel, type RunAccepted } from "@orbit-web/contracts";
import type { Request, Response } from "express";
import { StreamGateway } from "../../core/events/stream-gateway.js";
import { accepted } from "../../common/errors.js";
import { AccessModule } from "../access/access.module.js";
import { OwnershipService } from "../access/ownership.service.js";
import { ClaudeRunnerModule } from "../claude-runner/claude-runner.module.js";
import { ClaudeRunnerService } from "../claude-runner/claude-runner.service.js";
import { ImagesModule } from "../images/images.module.js";
import { ImagesService } from "../images/images.service.js";
import { OrbitModule } from "../orbit/orbit.module.js";
import { OrbitService } from "../orbit/orbit.service.js";
import { SessionsModule } from "../sessions/sessions.module.js";
import { SessionsService } from "../sessions/sessions.service.js";

@Controller("sessions/:id")
export class ChatController {
  constructor(
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Inject(ClaudeRunnerService) private readonly runner: ClaudeRunnerService,
    @Inject(StreamGateway) private readonly streams: StreamGateway,
    @Inject(OrbitService) private readonly orbit: OrbitService,
    @Inject(ImagesService) private readonly images: ImagesService,
    @Inject(OwnershipService) private readonly ownership: OwnershipService,
  ) {}

  @Post("messages")
  @HttpCode(202)
  async send(@Param("id") id: string, @Body() body: unknown): Promise<RunAccepted> {
    this.sessions.record(id);
    const req = accepted(checkSendMessage(body));
    // The images it names: the sender's own uploads, unsent -- claimed for this chat before the run is asked for.
    const images = (req.images ?? []).length > 0 ? this.images.claim(req.images ?? [], await this.ownership.viewer(), id) : [];
    return this.runner.send(id, req.text, images);
  }

  @Post("stop")
  @HttpCode(202)
  stop(@Param("id") id: string): { stopping: true } {
    this.sessions.record(id);
    this.runner.stop(id);
    return { stopping: true };
  }

  @Get("verification")
  verification(@Param("id") id: string): Promise<OrbitPanel> {
    this.sessions.record(id);
    return this.orbit.panel(id);
  }

  @Get("events")
  stream(@Param("id") id: string, @Req() req: Request, @Res() res: Response): void {
    this.sessions.record(id);
    this.streams.session(id, req, res);
  }
}

@Module({
  imports: [SessionsModule, ClaudeRunnerModule, OrbitModule, AccessModule, ImagesModule],
  controllers: [ChatController],
})
export class ChatModule {}
