// A SUBSCRIBER that keeps the text of each assistant message still being written -- bounded -- so a client that
// connects mid-message is handed what it missed (one `message.delta` from offset 0; the client keeps only what it
// lacks). A message leaves it when it completes; a chat's messages leave it when its run ends or the chat is deleted.
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { AnySessionEvent, SessionEvent } from "@orbit-web/contracts";
import { EventBus, type AnyStreamEvent } from "./event-bus.js";

export const LIVE_TEXT_LIMIT = 256 * 1024;

interface LiveMessage {
  text: string;
  runId: string | null;
}

const RUN_ENDS = new Set(["session.completed", "session.failed", "session.interrupted"]);

@Injectable()
export class LiveText implements OnModuleInit {
  private readonly live = new Map<string, Map<string, LiveMessage>>();

  constructor(@Inject(EventBus) private readonly bus: EventBus) {}

  onModuleInit(): void {
    this.bus.subscribe({ stream: "session", types: ["message.started", "message.delta", "message.completed", "session.completed", "session.failed", "session.interrupted"] }, (e) => this.track(e as AnySessionEvent));
    this.bus.subscribe({ stream: "app", types: ["session.removed"] }, (e: AnyStreamEvent) => {
      if (e.type === "session.removed") this.live.delete(e.data.sessionId);
    });
  }

  // The messages of this chat still being written, as one delta each from offset 0.
  snapshots(sessionId: string): SessionEvent<"message.delta">[] {
    const at = new Date().toISOString();
    return [...(this.live.get(sessionId) ?? new Map<string, LiveMessage>()).entries()].map(([messageId, m]) => ({
      id: randomUUID(),
      type: "message.delta",
      stream: "session",
      sessionId,
      seq: null,
      runId: m.runId,
      at,
      data: { messageId, offset: 0, text: m.text },
    }));
  }

  private track(event: AnySessionEvent): void {
    if (event.type === "message.started" && event.data.role === "assistant") this.liveOf(event.sessionId).set(event.data.messageId, { text: "", runId: event.runId });
    if (event.type === "message.delta") this.append(event.sessionId, event.data.messageId, event.data.offset, event.data.text, event.runId);
    if (event.type === "message.completed") this.live.get(event.sessionId)?.delete(event.data.messageId);
    if (RUN_ENDS.has(event.type)) this.live.delete(event.sessionId);
  }

  private liveOf(sessionId: string): Map<string, LiveMessage> {
    const map = this.live.get(sessionId) ?? new Map<string, LiveMessage>();
    this.live.set(sessionId, map);
    return map;
  }

  private append(sessionId: string, messageId: string, offset: number, text: string, runId: string | null): void {
    const map = this.liveOf(sessionId);
    const current = map.get(messageId) ?? { text: "", runId };
    if (offset !== current.text.length || current.text.length + text.length > LIVE_TEXT_LIMIT) return;
    map.set(messageId, { text: current.text + text, runId });
  }
}
