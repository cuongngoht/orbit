// THE STREAM OF ONE CEO CHAT CONVERSATION (`GET /api/executive/conversations/:id/events`; ADR 0062), a journal of its
// own -- a conversation is neither a chat nor a research session.
//
//   PUBLISHING  a DURABLE event is written to the conversation's journal first (which numbers it, in the transaction of
//               the change it reports when there is one) and delivered only once that is committed; the answer still
//               being written travels as transient deltas. One conversation's events are delivered in the order of
//               their numbers: a publication outside a transaction waits its turn behind the previous one. The text of
//               an answer in progress is kept (bounded) so a client that connects mid-answer is handed it once.
//   SERVING     subscribe first and buffer, read the journal after Last-Event-ID up to its head, send what the buffer
//               holds beyond that, then go live (replayThenLive): nothing written meanwhile is lost or sent twice. The
//               stream is held for the browser session that opened it, and closed with it.
//
// What a conversation said travels on ITS stream only, to its own account's browser sessions; the app stream carries
// ids alone.
import { Inject, Injectable, Logger } from "@nestjs/common";
import { EVENT_CATALOG, isDurableType, type AnyExecutiveEvent, type AnySessionEvent, type DurableExecutiveEventType, type EventDataMap, type ExecutiveEvent, type ExecutiveEventType } from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { replayThenLive, StreamGateway, type StreamHolder } from "../../../core/events/stream-gateway.js";
import { Db } from "../../../infra/db/db.js";
import { resumeAfter } from "../../../infra/sse/sse.js";
import { ExecutiveRepository } from "./executive.repository.js";

export const LIVE_ANSWER_LIMIT = 256 * 1024;

const ANSWER_ENDS = new Set<string>(["executive.response.completed", "executive.response.failed"]);

type Handler = (event: AnyExecutiveEvent) => void;

// The journal reader of the chats' streams is reused: an event is only ever handed back to the SSE channel as it is.
const asJournal = (e: AnyExecutiveEvent): AnySessionEvent => e as unknown as AnySessionEvent;

@Injectable()
export class ExecutiveStream {
  private readonly logger = new Logger("ExecutiveStream");
  private readonly subscribers = new Map<string, Set<Handler>>();
  private readonly live = new Map<string, Map<string, { text: string; turnId: string | null }>>();
  private readonly turns = new Map<string, Promise<unknown>>();

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(ExecutiveRepository) private readonly repo: ExecutiveRepository,
    @Inject(StreamGateway) private readonly gateway: StreamGateway,
  ) {}

  async publish<T extends ExecutiveEventType>(orbitId: string, conversationId: string, type: T, data: EventDataMap[T], turnId: string | null = null): Promise<AnyExecutiveEvent> {
    if ((EVENT_CATALOG as Record<string, { stream: string }>)[type]?.stream !== "executive") throw new Error(`${type} is not an executive event`);
    const work = () => this.publishNow(orbitId, conversationId, type, data, turnId);
    if (this.db.inTransaction()) return work();
    return this.inTurn(conversationId, work);
  }

  // A publication nobody waits for (an answer's deltas, read as the CLI writes them): it still takes its turn.
  emit<T extends ExecutiveEventType>(orbitId: string, conversationId: string, type: T, data: EventDataMap[T], turnId: string | null = null): void {
    this.publish(orbitId, conversationId, type, data, turnId).catch((err: unknown) => this.logger.error(`a ${type} of conversation ${conversationId} was not published: ${err instanceof Error ? err.message : String(err)}`));
  }

  async settled(conversationId: string): Promise<void> {
    await this.turns.get(conversationId)?.catch(() => undefined);
  }

  subscribe(conversationId: string, handler: Handler): () => void {
    const set = this.subscribers.get(conversationId) ?? new Set<Handler>();
    set.add(handler);
    this.subscribers.set(conversationId, set);
    return () => set.delete(handler);
  }

  async serve(conversationId: string, holder: StreamHolder, req: Request, res: Response): Promise<void> {
    let unsubscribe: () => void = () => undefined;
    const channel = this.gateway.openStream(holder, req, res, () => unsubscribe());
    unsubscribe = await replayThenLive({
      channel,
      after: resumeAfter(req),
      head: () => this.repo.head(conversationId),
      read: async (after, until) => (await this.repo.since(conversationId, after, 1_000, until)).map(asJournal),
      subscribe: (push) => this.subscribe(conversationId, (event) => push(asJournal(event))),
    });
    if (channel.closed) return unsubscribe();
    for (const snapshot of this.snapshots(conversationId)) channel.send(snapshot, null);
  }

  private async publishNow<T extends ExecutiveEventType>(orbitId: string, conversationId: string, type: T, data: EventDataMap[T], turnId: string | null): Promise<AnyExecutiveEvent> {
    const event = isDurableType(type)
      ? await this.repo.append(orbitId, conversationId, type as DurableExecutiveEventType & T, data as never, turnId)
      : ({ id: randomUUID(), type, stream: "executive", sessionId: conversationId, seq: null, runId: turnId, at: new Date().toISOString(), data } as ExecutiveEvent<T> as AnyExecutiveEvent);
    this.db.afterCommit(() => this.deliver(event));
    return event;
  }

  private inTurn<T>(conversationId: string, work: () => Promise<T>): Promise<T> {
    const before = this.turns.get(conversationId) ?? Promise.resolve();
    const next = before.catch(() => undefined).then(work);
    this.turns.set(conversationId, next);
    next
      .finally(() => {
        if (this.turns.get(conversationId) === next) this.turns.delete(conversationId);
      })
      .catch(() => undefined);
    return next;
  }

  private deliver(event: AnyExecutiveEvent): void {
    this.track(event);
    for (const handler of [...(this.subscribers.get(event.sessionId) ?? [])]) {
      try {
        handler(event);
      } catch (err) {
        this.logger.error(`a subscriber of ${event.type} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private snapshots(conversationId: string): AnyExecutiveEvent[] {
    const at = new Date().toISOString();
    return [...(this.live.get(conversationId) ?? new Map<string, { text: string; turnId: string | null }>()).entries()].map(
      ([messageId, m]) => ({ id: randomUUID(), type: "executive.response.delta", stream: "executive", sessionId: conversationId, seq: null, runId: m.turnId, at, data: { messageId, offset: 0, text: m.text } }) as AnyExecutiveEvent,
    );
  }

  private track(e: AnyExecutiveEvent): void {
    const live = this.live.get(e.sessionId) ?? new Map<string, { text: string; turnId: string | null }>();
    this.live.set(e.sessionId, live);
    if (e.type === "executive.response.started") live.set(e.data.messageId, { text: "", turnId: e.runId });
    if (e.type === "executive.response.delta") {
      const current = live.get(e.data.messageId);
      if (current !== undefined && e.data.offset === current.text.length && current.text.length + e.data.text.length <= LIVE_ANSWER_LIMIT) current.text += e.data.text;
    }
    if (ANSWER_ENDS.has(e.type)) live.clear();
  }
}
