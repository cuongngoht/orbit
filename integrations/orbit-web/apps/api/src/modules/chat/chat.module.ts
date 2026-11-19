// The conversation of a session: send a message (a new turn of Claude Code), follow its events over SSE (replayed
// from the store after Last-Event-ID, then live), stop the run, and read the Orbit panel.
import { Body, Controller, Get, HttpCode, Inject, Module, Param, Post, Req, Res } from "@nestjs/common";
import { checkSendMessage, type OrbitPanel, type RunAccepted } from "@orbit-web/contracts";
import type { Request, Response } from "express";
import { EventHub } from "../../core/event-hub.js";
import { accepted } from "../../common/errors.js";
import { openSse, resumeAfter } from "../../infra/sse/sse.js";
import { EventStore } from "../../infra/storage/stores.js";
import { ClaudeRunnerModule } from "../claude-runner/claude-runner.module.js";
import { ClaudeRunnerService } from "../claude-runner/claude-runner.service.js";
import { OrbitModule } from "../orbit/orbit.module.js";
import { OrbitService } from "../orbit/orbit.service.js";
import { SessionsModule } from "../sessions/sessions.module.js";
import { SessionsService } from "../sessions/sessions.service.js";

@Controller("sessions/:id")
export class ChatController {
  constructor(
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Inject(ClaudeRunnerService) private readonly runner: ClaudeRunnerService,
    @Inject(EventHub) private readonly hub: EventHub,
    @Inject(EventStore) private readonly events: EventStore,
    @Inject(OrbitService) private readonly orbit: OrbitService,
  ) {}

  @Post("messages")
  @HttpCode(202)
  send(@Param("id") id: string, @Body() body: unknown): RunAccepted {
    this.sessions.record(id);
    return this.runner.send(id, accepted(checkSendMessage(body)).text);
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

  // Replay and subscription happen in one synchronous step, so no event falls between them; then the text of a
  // message still being written is sent from its start (the client keeps only what it lacks).
  @Get("events")
  stream(@Param("id") id: string, @Req() req: Request, @Res() res: Response): void {
    this.sessions.record(id);
    let unsubscribe: () => void = () => undefined;
    const channel = openSse(req, res, () => unsubscribe());
    for (const event of this.events.since(id, resumeAfter(req))) channel.send(event, event.seq);
    unsubscribe = this.hub.subscribe(id, (event) => channel.send(event, event.seq));
    for (const snapshot of this.hub.liveSnapshots(id)) channel.send(snapshot, null);
  }
}

@Module({
  imports: [SessionsModule, ClaudeRunnerModule, OrbitModule],
  controllers: [ChatController],
})
export class ChatModule {}
