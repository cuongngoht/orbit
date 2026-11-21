// The conversation of a session: send a message (a new turn of Claude Code), follow its session stream over SSE (the
// stream gateway: replayed from the journal after Last-Event-ID, then live), stop the run, and read the Orbit panel.
import { Body, Controller, Get, HttpCode, Inject, Module, Param, Post, Req, Res } from "@nestjs/common";
import { checkSendMessage, type OrbitPanel, type RunAccepted } from "@orbit-web/contracts";
import type { Request, Response } from "express";
import { StreamGateway } from "../../core/events/stream-gateway.js";
import { accepted } from "../../common/errors.js";
import { viewer } from "../../common/request-scope.js";
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
  ) {}

  // The owner whose browser sends the message is who starts the run (its records name them as its cause).
  @Post("messages")
  @HttpCode(202)
  async send(@Param("id") id: string, @Body() body: unknown): Promise<RunAccepted> {
    const session = await this.sessions.record(id);
    const req = accepted(checkSendMessage(body));
    const who = viewer();
    // The images it names: the sender's own uploads, unsent -- claimed for this chat before the run is asked for.
    const images = (req.images ?? []).length > 0 ? await this.images.claim(req.images ?? [], who, session) : [];
    return this.runner.send(id, req.text, images, who);
  }

  @Post("stop")
  @HttpCode(202)
  async stop(@Param("id") id: string): Promise<{ stopping: true }> {
    await this.sessions.record(id);
    this.runner.stop(id);
    return { stopping: true };
  }

  @Get("verification")
  async verification(@Param("id") id: string): Promise<OrbitPanel> {
    await this.sessions.record(id);
    return this.orbit.panel(id);
  }

  // The chat's stream, held for this browser's session: it closes when the session ends.
  @Get("events")
  async stream(@Param("id") id: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    await this.sessions.record(id);
    const who = viewer();
    // The stream's headers are sent before its journal is read: a read that fails ends the stream (the page reconnects
    // and replays from the last event it holds), never an error answer after the headers.
    await this.streams.session(id, { accountId: who.accountId, email: who.email, sessionId: who.sessionId }, req, res).catch(() => res.end());
  }
}

@Module({
  imports: [SessionsModule, ClaudeRunnerModule, OrbitModule, ImagesModule],
  controllers: [ChatController],
})
export class ChatModule {}
