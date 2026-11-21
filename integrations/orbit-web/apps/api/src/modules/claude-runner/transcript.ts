// A chat's TRANSCRIPT -- the top-level message of each turn, the person's and Claude's -- in the messages table, from
// the session stream's `message.completed` events. It is the conversation the session detail returns. It is kept in
// the SAME transaction that journals the event (the runner publishes through it): a message the stream said was
// completed is in the transcript by the time anybody hears of it, and a message rolled back is in neither.
import { Inject, Injectable } from "@nestjs/common";
import type { AnySessionEvent } from "@orbit-web/contracts";
import { MessageStore } from "../../infra/storage/stores.js";

@Injectable()
export class Transcript {
  constructor(@Inject(MessageStore) private readonly messages: MessageStore) {}

  // Whether an event is one the transcript keeps (a top-level message, not a subagent's).
  static keeps(type: string, data: unknown): boolean {
    return type === "message.completed" && (data as { parentToolUseId?: unknown } | null)?.parentToolUseId === null;
  }

  async keep(e: AnySessionEvent): Promise<void> {
    if (e.type !== "message.completed" || e.data.parentToolUseId !== null) return;
    await this.messages.add({ id: e.data.messageId, sessionId: e.sessionId, role: e.data.role, text: e.data.text, runId: e.runId, createdAt: e.at });
  }
}
