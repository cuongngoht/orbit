// THE STREAM GATEWAY: the bus's subscriber on the far side of HTTP. Each open Server-Sent Events connection is one
// subscription:
//
//   session stream   replays the chat's journal after Last-Event-ID (each with `id: <seq>`), subscribes in the same
//                    synchronous step (so nothing falls between), then sends the text of messages still being written.
//   app stream       subscribes to the app stream's notifications; nothing is replayed (a client reads the read
//                    models again when it (re)connects, then applies what arrives). A notification about a record the
//                    Claude account signed in now may not see (a chat or a research workspace of another account) is
//                    not sent: each owner of such records registers a filter here.
import { Inject, Injectable } from "@nestjs/common";
import type { AnyAppStreamEvent } from "@orbit-web/contracts";
import type { Request, Response } from "express";
import { openSse, resumeAfter } from "../../infra/sse/sse.js";
import { EventStore } from "../../infra/storage/stores.js";
import { EventBus } from "./event-bus.js";
import { LiveText } from "./live-text.js";

export type AppStreamFilter = (event: AnyAppStreamEvent) => boolean;

@Injectable()
export class StreamGateway {
  private readonly appFilters: AppStreamFilter[] = [];

  constructor(
    @Inject(EventBus) private readonly bus: EventBus,
    @Inject(EventStore) private readonly journal: EventStore,
    @Inject(LiveText) private readonly liveText: LiveText,
  ) {}

  session(sessionId: string, req: Request, res: Response): void {
    let unsubscribe: () => void = () => undefined;
    const channel = openSse(req, res, () => unsubscribe());
    for (const event of this.journal.since(sessionId, resumeAfter(req))) channel.send(event, event.seq);
    unsubscribe = this.bus.subscribe({ stream: "session", sessionId }, (event) => channel.send(event, event.seq));
    for (const snapshot of this.liveText.snapshots(sessionId)) channel.send(snapshot, null);
  }

  app(req: Request, res: Response): void {
    let unsubscribe: () => void = () => undefined;
    const channel = openSse(req, res, () => unsubscribe());
    unsubscribe = this.bus.subscribe({ stream: "app" }, (event) => {
      if (this.appFilters.every((allows) => allows(event as AnyAppStreamEvent))) channel.send(event, null);
    });
  }

  // A notification is sent only when every filter lets it through.
  filterApp(filter: AppStreamFilter): void {
    this.appFilters.push(filter);
  }
}
