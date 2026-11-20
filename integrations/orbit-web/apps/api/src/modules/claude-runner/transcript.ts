// A SUBSCRIBER that keeps a chat's transcript -- the top-level message of each turn, the person's and Claude's -- in the
// messages table, from the session stream's `message.completed` events. It is the conversation the session detail
// returns; the runner only publishes.
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../core/events/event-bus.js";
import { MessageStore } from "../../infra/storage/stores.js";

@Injectable()
export class TranscriptProjection implements OnModuleInit {
  constructor(
    @Inject(EventBus) private readonly bus: EventBus,
    @Inject(MessageStore) private readonly messages: MessageStore,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe({ stream: "session", types: ["message.completed"] }, (e) => {
      if (e.type !== "message.completed" || e.sessionId === null || e.data.parentToolUseId !== null) return;
      this.messages.add({ id: e.data.messageId, sessionId: e.sessionId, role: e.data.role, text: e.data.text, runId: e.runId, createdAt: e.at });
    });
  }
}
