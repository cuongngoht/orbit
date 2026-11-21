// GET /api/events: the APP stream -- notifications every page may need (the chats in the sidebar, the connectors and
// their sign-in flows, the projects' skills and plugins), delivered by the stream gateway as the bus publishes them -- to
// the account of this browser's session, and to nobody else. Gated by the Claude sign-in like every route but the sign-in
// itself.
import { Controller, Get, Inject, Module, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { viewer } from "../../common/request-scope.js";
import { StreamGateway } from "../../core/events/stream-gateway.js";

@Controller("events")
export class EventsController {
  constructor(@Inject(StreamGateway) private readonly streams: StreamGateway) {}

  // Held for this browser's session: the notifications its account may hear (and the deployment's), until it ends.
  @Get()
  stream(@Req() req: Request, @Res() res: Response): void {
    const who = viewer();
    this.streams.app({ accountId: who.accountId, email: who.email, sessionId: who.sessionId }, req, res);
  }
}

@Module({
  controllers: [EventsController],
})
export class EventsModule {}
