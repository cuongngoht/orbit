// THE RESEARCH STREAM of one research session (`GET /api/research/sessions/:id/events`), a journal of its own beside
// the chats' -- a research session is not a chat. A DURABLE event is written to the session's journal first (which
// numbers it) and then delivered; the answer still being written travels as transient deltas, and the text of an answer
// in progress is kept (bounded) so a client that connects mid-answer is handed what it missed, once, from offset 0. A
// reconnecting client sends Last-Event-ID and gets only what came after: nothing is doubled.
import { Inject, Injectable } from "@nestjs/common";
import { EVENT_CATALOG, isDurableType, type AnyResearchEvent, type DurableResearchEventType, type EventDataMap, type ResearchEvent, type ResearchEventType } from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { openSse, resumeAfter } from "../../infra/sse/sse.js";
import { ResearchSessionStore } from "./store/sessions.js";

export const LIVE_ANSWER_LIMIT = 256 * 1024;

const RUN_ENDS = new Set<string>(["research.run.completed", "research.run.failed", "research.run.interrupted"]);

type Handler = (event: AnyResearchEvent) => void;

@Injectable()
export class ResearchStream {
  private readonly subscribers = new Map<string, Set<Handler>>();
  private readonly live = new Map<string, Map<string, { text: string; runId: string | null }>>();

  constructor(@Inject(ResearchSessionStore) private readonly sessions: ResearchSessionStore) {}

  publish<T extends ResearchEventType>(sessionId: string, type: T, data: EventDataMap[T], runId: string | null = null): AnyResearchEvent {
    if ((EVENT_CATALOG as Record<string, { stream: string }>)[type]?.stream !== "research") throw new Error(`${type} is not a research event`);
    const event = isDurableType(type)
      ? this.sessions.append(sessionId, type as DurableResearchEventType & T, data as never, runId)
      : ({ id: randomUUID(), type, stream: "research", sessionId, seq: null, runId, at: new Date().toISOString(), data } as ResearchEvent<T> as AnyResearchEvent);
    this.track(event);
    for (const handler of [...(this.subscribers.get(sessionId) ?? [])]) handler(event);
    return event;
  }

  subscribe(sessionId: string, handler: Handler): () => void {
    const set = this.subscribers.get(sessionId) ?? new Set<Handler>();
    set.add(handler);
    this.subscribers.set(sessionId, set);
    return () => set.delete(handler);
  }

  // Replays the journal after Last-Event-ID, subscribes in the same step (nothing falls between), then sends the answer
  // still being written.
  serve(sessionId: string, req: Request, res: Response): void {
    let unsubscribe: () => void = () => undefined;
    const channel = openSse(req, res, () => unsubscribe());
    for (const event of this.sessions.since(sessionId, resumeAfter(req))) channel.send(event, event.seq);
    unsubscribe = this.subscribe(sessionId, (event) => channel.send(event, event.seq));
    for (const snapshot of this.snapshots(sessionId)) channel.send(snapshot, null);
  }

  forget(sessionId: string): void {
    this.live.delete(sessionId);
    this.subscribers.delete(sessionId);
  }

  private snapshots(sessionId: string): AnyResearchEvent[] {
    const at = new Date().toISOString();
    return [...(this.live.get(sessionId) ?? new Map<string, { text: string; runId: string | null }>()).entries()].map(
      ([messageId, m]) => ({ id: randomUUID(), type: "research.message.delta", stream: "research", sessionId, seq: null, runId: m.runId, at, data: { messageId, offset: 0, text: m.text } }) as AnyResearchEvent,
    );
  }

  private track(e: AnyResearchEvent): void {
    const live = this.live.get(e.sessionId) ?? new Map<string, { text: string; runId: string | null }>();
    this.live.set(e.sessionId, live);
    if (e.type === "research.message.started" && e.data.role === "assistant") live.set(e.data.messageId, { text: "", runId: e.runId });
    if (e.type === "research.message.delta") {
      const current = live.get(e.data.messageId);
      if (current !== undefined && e.data.offset === current.text.length && current.text.length + e.data.text.length <= LIVE_ANSWER_LIMIT) current.text += e.data.text;
    }
    if (e.type === "research.message.completed") live.delete(e.data.messageId);
    if (RUN_ENDS.has(e.type)) this.live.delete(e.sessionId);
  }
}
