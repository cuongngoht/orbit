// A PROJECTION: the chats as the sidebar shows them. Whenever a chat's status changes on its session stream (created,
// preparing, ready, running, an outcome), its summary as it is now is published on the app stream -- to its owner
// account's pages and to the pages of the people it is shared with -- so every open page follows without polling. (A
// rename or a new model, effort or mode is published by the sessions service itself; a deletion as `session.removed`.)
//
// One chat's summaries are published one after another, in the order its statuses changed, each with the status its
// event carried (the rest as the chat is now): a page sees every status in turn, and the last it receives is the last.
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { SessionStatus } from "@orbit-web/contracts";
import { EventBus } from "../../core/events/event-bus.js";
import { SessionStore } from "../../infra/storage/stores.js";
import { OwnershipService } from "../access/ownership.service.js";
import { publishSummary } from "./sessions.service.js";

@Injectable()
export class SessionDirectory implements OnModuleInit {
  private readonly logger = new Logger("SessionDirectory");
  private readonly turns = new Map<string, Promise<void>>();

  constructor(
    @Inject(EventBus) private readonly bus: EventBus,
    @Inject(SessionStore) private readonly sessions: SessionStore,
    @Inject(OwnershipService) private readonly ownership: OwnershipService,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe({ stream: "session", types: ["session.status"] }, (e) => {
      if (e.type === "session.status" && e.sessionId !== null) this.inTurn(e.sessionId, e.data.status, e.data.reason);
    });
  }

  private inTurn(sessionId: string, status: SessionStatus, reason: string | null): void {
    const next = (this.turns.get(sessionId) ?? Promise.resolve()).then(() => this.announce(sessionId, status, reason));
    this.turns.set(sessionId, next);
    void next.finally(() => {
      if (this.turns.get(sessionId) === next) this.turns.delete(sessionId);
    });
  }

  private async announce(sessionId: string, status: SessionStatus, reason: string | null): Promise<void> {
    try {
      const session = await this.sessions.get(sessionId);
      if (session !== null) await publishSummary(this.bus, this.ownership, { ...session, status, statusReason: reason });
    } catch (err) {
      this.logger.warn(`the summary of ${sessionId} was not published: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
