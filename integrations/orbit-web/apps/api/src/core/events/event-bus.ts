// THE EVENT BUS: the one way anything in Orbit Web says that something happened. A PRODUCER (the runner, a
// workspace, a sign-in flow, a project reader) publishes a typed event and knows nothing of who listens; SUBSCRIBERS
// (the SSE streams, the projections that keep read models and the app stream current, the Orbit refresh) each register
// for the events they handle. What exists is the event catalog in contracts: a type that is not in it, or on the wrong
// stream, is refused here before anything is stored or sent.
//
// A durable session event is written to the journal FIRST -- in the transaction of the change it reports, when there
// is one -- and delivered only once that is COMMITTED, so whatever a subscriber does, a reconnecting client can replay
// it, and nothing is ever said about a change that was rolled back. One chat's events are delivered in the order of
// their sequence numbers: publishing outside a transaction takes its turn behind the chat's previous event.
//
// An app-stream notification names its AUDIENCE: the account whose record it is about (and the people it is shared
// with), or everyone signed in for what is the deployment's (a connector's sign-in). The stream gateway sends it to
// those and no one else; nothing is looked up while it is delivered.
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
import { Db } from "../../infra/db/db.js";
import { EventStore } from "../../infra/storage/stores.js";

export type AnyStreamEvent = AnySessionEvent | AnyAppStreamEvent;

// Who may be told of an app-stream event.
export type Audience = { kind: "everyone" } | { kind: "account"; accountId: string; emails?: readonly string[] };

export const everyone: Audience = { kind: "everyone" };

export const accountAudience = (accountId: string, emails: readonly string[] = []): Audience => ({ kind: "account", accountId, emails });

export interface Delivered {
  event: AnyStreamEvent;
  // Set for an app-stream event: who may receive it.
  audience: Audience | null;
}

export interface EventFilter {
  stream?: StreamKind;
  // Only this chat's session events.
  sessionId?: string;
  types?: readonly EventType[];
}

export type EventHandler = (event: AnyStreamEvent, audience: Audience | null) => void;

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
  // Each chat's last publication still under way: the next one outside a transaction waits for it.
  private readonly turns = new Map<string, Promise<unknown>>();

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(EventStore) private readonly journal: EventStore,
  ) {}

  // An event of one chat. Durable: journaled, then delivered after commit. Transient: delivered in its turn.
  async publishSession<T extends SessionEventType>(sessionId: string, type: T, data: EventDataMap[T], runId: string | null = null): Promise<SessionEvent<T>> {
    assertStream(type, "session");
    const work = () => this.publishNow(sessionId, type, data, runId);
    if (this.db.inTransaction()) return work();
    return this.inTurn(sessionId, work);
  }

  // A notification of the app stream, to `audience`: delivered once what it says is committed, never stored.
  publishApp<T extends AppStreamEventType>(type: T, data: EventDataMap[T], audience: Audience): AppStreamEvent<T> {
    assertStream(type, "app");
    const event = { id: randomUUID(), type, stream: "app", sessionId: null, seq: null, runId: null, at: new Date().toISOString(), data } as AppStreamEvent<T>;
    this.db.afterCommit(() => this.deliver(event as AnyAppStreamEvent, audience));
    return event;
  }

  subscribe(filter: EventFilter, handler: EventHandler): () => void {
    const subscription = { filter, handler };
    this.subscriptions.add(subscription);
    return () => this.subscriptions.delete(subscription);
  }

  // Resolves once every publication of this chat under way has been delivered.
  async settled(sessionId: string): Promise<void> {
    await this.turns.get(sessionId)?.catch(() => undefined);
  }

  private async publishNow<T extends SessionEventType>(sessionId: string, type: T, data: EventDataMap[T], runId: string | null): Promise<SessionEvent<T>> {
    if (!isDurableType(type)) {
      const event = { id: randomUUID(), type, stream: "session", sessionId, seq: null, runId, at: new Date().toISOString(), data } as SessionEvent<T>;
      this.db.afterCommit(() => this.deliver(event as AnySessionEvent, null));
      return event;
    }
    const event = (await this.journal.append(sessionId, type as DurableEventType & T, data as never, runId)) as SessionEvent<T>;
    this.db.afterCommit(() => this.deliver(event as AnySessionEvent, null));
    return event;
  }

  private inTurn<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    const before = this.turns.get(sessionId) ?? Promise.resolve();
    const next = before.catch(() => undefined).then(work);
    this.turns.set(sessionId, next);
    void next.finally(() => {
      if (this.turns.get(sessionId) === next) this.turns.delete(sessionId);
    }).catch(() => undefined);
    return next;
  }

  private deliver(event: AnyStreamEvent, audience: Audience | null): void {
    for (const s of [...this.subscriptions]) {
      if (!matches(s.filter, event)) continue;
      try {
        s.handler(event, audience);
      } catch (err) {
        this.logger.error(`a subscriber of ${event.type} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}
