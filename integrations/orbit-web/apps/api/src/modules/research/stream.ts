// THE RESEARCH STREAM of one research session (`GET /api/research/sessions/:id/events`), a journal of its own beside
// the chats' -- a research session is not a chat.
//
//   PUBLISHING  a DURABLE event is written to the session's journal first (which numbers it, in the transaction of the
//               change it reports when there is one) and delivered only once that is committed; the answer still being
//               written travels as transient deltas. One session's events are delivered in the order of their sequence
//               numbers: a publication outside a transaction takes its turn behind the session's previous one, however
//               many callbacks publish at once. The text of an answer in progress is kept (bounded) so a client that
//               connects mid-answer is handed what it missed, once, from offset 0.
//   SERVING     the stream SUBSCRIBES FIRST and buffers, then reads the journal after Last-Event-ID up to its head, sends
//               what the buffer holds beyond that, and only then goes live (core/events/stream-gateway.ts
//               replayThenLive): an event written while the journal was being read is neither lost nor sent twice. The
//               stream is held for the browser session that opened it, and closed with it (its sign-out, a switch of
//               account).
import { Inject, Injectable, Logger } from "@nestjs/common";
import { EVENT_CATALOG, isDurableType, type AnyResearchEvent, type AnySessionEvent, type DurableResearchEventType, type EventDataMap, type ResearchEvent, type ResearchEventType } from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { replayThenLive, StreamGateway, type StreamHolder } from "../../core/events/stream-gateway.js";
import { Db } from "../../infra/db/db.js";
import { resumeAfter } from "../../infra/sse/sse.js";
import { ResearchSessionStore } from "./store/sessions.js";

export const LIVE_ANSWER_LIMIT = 256 * 1024;

const RUN_ENDS = new Set<string>(["research.run.completed", "research.run.failed", "research.run.interrupted"]);

type Handler = (event: AnyResearchEvent) => void;

// A research event read where the journal reader of the chats' streams is reused: it is only ever handed back to the
// SSE channel as it is (its `seq` decides what was already sent).
const asJournal = (e: AnyResearchEvent): AnySessionEvent => e as unknown as AnySessionEvent;

@Injectable()
export class ResearchStream {
  private readonly logger = new Logger("ResearchStream");
  private readonly subscribers = new Map<string, Set<Handler>>();
  private readonly live = new Map<string, Map<string, { text: string; runId: string | null }>>();
  // Each session's last publication still under way: the next one outside a transaction waits for it.
  private readonly turns = new Map<string, Promise<unknown>>();

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(ResearchSessionStore) private readonly sessions: ResearchSessionStore,
    @Inject(StreamGateway) private readonly gateway: StreamGateway,
  ) {}

  async publish<T extends ResearchEventType>(sessionId: string, type: T, data: EventDataMap[T], runId: string | null = null): Promise<AnyResearchEvent> {
    if ((EVENT_CATALOG as Record<string, { stream: string }>)[type]?.stream !== "research") throw new Error(`${type} is not a research event`);
    const work = () => this.publishNow(sessionId, type, data, runId);
    if (this.db.inTransaction()) return work();
    return this.inTurn(sessionId, work);
  }

  // A publication nobody waits for (a run's stream, read as the CLI writes it): it still takes its turn, and a failure
  // is logged -- never left unhandled.
  emit<T extends ResearchEventType>(sessionId: string, type: T, data: EventDataMap[T], runId: string | null = null): void {
    this.publish(sessionId, type, data, runId).catch((err: unknown) => this.logger.error(`a ${type} of research session ${sessionId} was not published: ${err instanceof Error ? err.message : String(err)}`));
  }

  // Resolves once every publication of this session under way has been delivered.
  async settled(sessionId: string): Promise<void> {
    await this.turns.get(sessionId)?.catch(() => undefined);
  }

  subscribe(sessionId: string, handler: Handler): () => void {
    const set = this.subscribers.get(sessionId) ?? new Set<Handler>();
    set.add(handler);
    this.subscribers.set(sessionId, set);
    return () => set.delete(handler);
  }

  // Subscribe, replay the journal after Last-Event-ID, catch up, go live -- then the answer still being written.
  async serve(sessionId: string, holder: StreamHolder, req: Request, res: Response): Promise<void> {
    let unsubscribe: () => void = () => undefined;
    const channel = this.gateway.openStream(holder, req, res, () => unsubscribe());
    unsubscribe = await replayThenLive({
      channel,
      after: resumeAfter(req),
      head: () => this.sessions.head(sessionId),
      read: async (after, until) => (await this.sessions.since(sessionId, after, 1_000, until)).map(asJournal),
      subscribe: (push) => this.subscribe(sessionId, (event) => push(asJournal(event))),
    });
    if (channel.closed) return unsubscribe();
    for (const snapshot of this.snapshots(sessionId)) channel.send(snapshot, null);
  }

  forget(sessionId: string): void {
    this.live.delete(sessionId);
    this.subscribers.delete(sessionId);
  }

  private async publishNow<T extends ResearchEventType>(sessionId: string, type: T, data: EventDataMap[T], runId: string | null): Promise<AnyResearchEvent> {
    const event = isDurableType(type)
      ? await this.sessions.append(sessionId, type as DurableResearchEventType & T, data as never, runId)
      : ({ id: randomUUID(), type, stream: "research", sessionId, seq: null, runId, at: new Date().toISOString(), data } as ResearchEvent<T> as AnyResearchEvent);
    this.db.afterCommit(() => this.deliver(event));
    return event;
  }

  private inTurn<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    const before = this.turns.get(sessionId) ?? Promise.resolve();
    const next = before.catch(() => undefined).then(work);
    this.turns.set(sessionId, next);
    next
      .finally(() => {
        if (this.turns.get(sessionId) === next) this.turns.delete(sessionId);
      })
      .catch(() => undefined);
    return next;
  }

  private deliver(event: AnyResearchEvent): void {
    this.track(event);
    for (const handler of [...(this.subscribers.get(event.sessionId) ?? [])]) {
      try {
        handler(event);
      } catch (err) {
        this.logger.error(`a subscriber of ${event.type} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
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
