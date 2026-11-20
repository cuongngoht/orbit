// A PROJECTION: the chats as the sidebar shows them. Whenever a chat's status changes on its session stream (created,
// preparing, ready, running, an outcome), its summary as it is now is published on the app stream, so every open page
// follows without polling. (A rename or a new model, effort or mode is published by the sessions service itself; a
// deletion as `session.removed`.)
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../core/events/event-bus.js";
import { SessionStore } from "../../infra/storage/stores.js";
import { OwnershipService } from "../access/ownership.service.js";
import { summaryOf } from "./sessions.service.js";

@Injectable()
export class SessionDirectory implements OnModuleInit {
  constructor(
    @Inject(EventBus) private readonly bus: EventBus,
    @Inject(SessionStore) private readonly sessions: SessionStore,
    @Inject(OwnershipService) private readonly ownership: OwnershipService,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe({ stream: "session", types: ["session.status"] }, (e) => {
      const session = e.sessionId === null ? null : this.sessions.get(e.sessionId);
      if (session !== null) this.bus.publishApp("session.summary", { session: summaryOf(session, this.ownership.levelNow(session) ?? "owner") });
    });
  }
}
