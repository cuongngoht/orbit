// GET /api/events: the APP stream -- notifications every page may need (the chats in the sidebar, the connectors and
// their sign-in flows, the projects' skills and plugins), delivered by the stream gateway as the bus publishes them.
// Gated by the Claude sign-in like every route but the sign-in itself.
import { Controller, Get, Inject, Module, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { StreamGateway } from "../../core/events/stream-gateway.js";

@Controller("events")
export class EventsController {
  constructor(@Inject(StreamGateway) private readonly streams: StreamGateway) {}

  @Get()
  stream(@Req() req: Request, @Res() res: Response): void {
    this.streams.app(req, res);
  }
}

@Module({
  controllers: [EventsController],
})
export class EventsModule {}
