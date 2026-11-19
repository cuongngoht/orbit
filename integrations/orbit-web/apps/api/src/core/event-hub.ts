// THE SESSION EVENT HUB: the one way an application event is emitted. A durable event is stored first (and so gets
// its sequence number) and then published; a transient one is only published. Subscribers are the open SSE streams
// of that session. The text of an assistant message still being written is kept here -- bounded -- so a client that
// reconnects mid-message is handed what it missed; it is dropped when the message completes or the run ends.
import { Injectable } from "@nestjs/common";
import { isDurableType, type AnyAppEvent, type AppEventType, type DurableEventType, type EventDataMap } from "@orbit-web/contracts";
import { EventStore } from "../infra/storage/stores.js";

type Listener = (event: AnyAppEvent) => void;

export const LIVE_TEXT_LIMIT = 256 * 1024;

interface LiveMessage {
  text: string;
  runId: string | null;
}

@Injectable()
export class EventHub {
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly live = new Map<string, Map<string, LiveMessage>>();

  constructor(private readonly events: EventStore) {}

  emit<T extends AppEventType>(sessionId: string, type: T, data: EventDataMap[T], runId: string | null): AnyAppEvent {
    const event = isDurableType(type)
      ? this.events.append(sessionId, type as DurableEventType, data as EventDataMap[DurableEventType], runId)
      : ({ type, sessionId, seq: null, runId, at: new Date().toISOString(), data } as AnyAppEvent);
    this.track(event);
    for (const listener of this.listeners.get(sessionId) ?? []) listener(event);
    return event;
  }

  subscribe(sessionId: string, listener: Listener): () => void {
    const set = this.listeners.get(sessionId) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(sessionId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(sessionId);
    };
  }

  subscriberCount(sessionId: string): number {
    return this.listeners.get(sessionId)?.size ?? 0;
  }

  // The messages of this session still being written, as one delta each from offset 0.
  liveSnapshots(sessionId: string): AnyAppEvent[] {
    const at = new Date().toISOString();
    return [...(this.live.get(sessionId) ?? new Map<string, LiveMessage>()).entries()].map(
      ([messageId, m]) => ({ type: "message.delta", sessionId, seq: null, runId: m.runId, at, data: { messageId, offset: 0, text: m.text } }) as AnyAppEvent,
    );
  }

  // What is still being written, for a run that ends before its message completes.
  liveText(sessionId: string, messageId: string): string | null {
    return this.live.get(sessionId)?.get(messageId)?.text ?? null;
  }

  dropLive(sessionId: string): void {
    this.live.delete(sessionId);
  }

  private track(event: AnyAppEvent): void {
    if (event.type === "message.started" && event.data.role === "assistant") this.liveOf(event.sessionId).set(event.data.messageId, { text: "", runId: event.runId });
    if (event.type === "message.delta") this.append(event.sessionId, event.data.messageId, event.data.offset, event.data.text, event.runId);
    if (event.type === "message.completed") this.live.get(event.sessionId)?.delete(event.data.messageId);
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
