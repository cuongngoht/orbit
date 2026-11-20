// THE EVENT BUS: the one way anything in Orbit Web says that something happened. A PRODUCER (the runner, a
// workspace, a sign-in flow, a project reader) publishes a typed event and knows nothing of who listens; SUBSCRIBERS
// (the SSE streams, the projections that keep read models and the app stream current, the Orbit refresh) each register
// for the events they handle. What exists is the event catalog in contracts: a type that is not in it, or on the wrong
// stream, is refused here before anything is stored or sent.
//
// A durable session event is written to the journal FIRST (which gives it its sequence number) and only then
// delivered, so whatever a subscriber does, a reconnecting client can replay it. Delivery is synchronous, in
// subscription order; a subscriber that throws is logged and the others still get the event.
import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  EVENT_CATALOG,
  isDurableType,
  type AnyAppStreamEvent,
  type AnySessionEvent,
  type AppStreamEvent,
  type AppStreamEventType,
  type DurableEventType,
  type EventDataMap,
  type EventType,
  type SessionEvent,
  type SessionEventType,
  type StreamKind,
} from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import { EventStore } from "../../infra/storage/stores.js";

export type AnyStreamEvent = AnySessionEvent | AnyAppStreamEvent;

export interface EventFilter {
  stream?: StreamKind;
  // Only this chat's session events.
  sessionId?: string;
  types?: readonly EventType[];
}

export type EventHandler = (event: AnyStreamEvent) => void;

interface Subscription {
  filter: EventFilter;
  handler: EventHandler;
}

const matches = (f: EventFilter, e: AnyStreamEvent): boolean =>
  (f.stream === undefined || f.stream === e.stream) && (f.sessionId === undefined || f.sessionId === e.sessionId) && (f.types === undefined || f.types.includes(e.type));

function assertStream(type: EventType, stream: StreamKind): void {
  const spec = (EVENT_CATALOG as Record<string, { stream: StreamKind } | undefined>)[type];
  if (spec === undefined) throw new Error(`${type} is not in the event catalog`);
  if (spec.stream !== stream) throw new Error(`${type} travels on the ${spec.stream} stream, not the ${stream} stream`);
}

@Injectable()
export class EventBus {
  private readonly logger = new Logger("EventBus");
  private readonly subscriptions = new Set<Subscription>();

  constructor(@Inject(EventStore) private readonly journal: EventStore) {}

  // An event of one chat. Durable: journaled, then delivered. Transient: delivered only.
  publishSession<T extends SessionEventType>(sessionId: string, type: T, data: EventDataMap[T], runId: string | null = null): SessionEvent<T> {
    assertStream(type, "session");
    const event = isDurableType(type)
      ? (this.journal.append(sessionId, type as DurableEventType & T, data as never, runId) as SessionEvent<T>)
      : ({ id: randomUUID(), type, stream: "session", sessionId, seq: null, runId, at: new Date().toISOString(), data } as SessionEvent<T>);
    this.deliver(event as AnySessionEvent);
    return event;
  }

  // A notification of the app stream: delivered, never stored.
  publishApp<T extends AppStreamEventType>(type: T, data: EventDataMap[T]): AppStreamEvent<T> {
    assertStream(type, "app");
    const event = { id: randomUUID(), type, stream: "app", sessionId: null, seq: null, runId: null, at: new Date().toISOString(), data } as AppStreamEvent<T>;
    this.deliver(event as AnyAppStreamEvent);
    return event;
  }

  subscribe(filter: EventFilter, handler: EventHandler): () => void {
    const subscription = { filter, handler };
    this.subscriptions.add(subscription);
    return () => this.subscriptions.delete(subscription);
  }

  private deliver(event: AnyStreamEvent): void {
    for (const s of [...this.subscriptions]) {
      if (!matches(s.filter, event)) continue;
      try {
        s.handler(event);
      } catch (err) {
        this.logger.error(`a subscriber of ${event.type} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}
