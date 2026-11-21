// THE STREAM GATEWAY: the bus's subscriber on the far side of HTTP. Each open Server-Sent Events connection is one
// subscription, held for the browser session that opened it:
//
//   session stream   SUBSCRIBES FIRST and buffers what arrives, then reads the chat's journal after Last-Event-ID up
//                    to what it holds now (each sent with `id: <seq>`), then sends what the buffer holds beyond that,
//                    and only then goes live: an event written while the journal was being read is neither lost nor
//                    sent twice. Then the text of messages still being written.
//   app stream       notifications to the account the connection's session is for (and to everyone signed in, for what
//                    is the deployment's), and to no other: each event names its audience when it is published, so
//                    nothing is looked up while it is delivered.
//
// When a browser session ends -- signed out, revoked, or its account no longer the runtime's -- every stream it opened
// is closed at once (closeSession, closeAccount): a page of account A never goes on hearing anything after the switch.
import { Inject, Injectable } from "@nestjs/common";
import type { AnyAppStreamEvent, AnySessionEvent } from "@orbit-web/contracts";
import type { Request, Response } from "express";
import { openSse, resumeAfter, type SseChannel } from "../../infra/sse/sse.js";
import { EventStore } from "../../infra/storage/stores.js";
import { EventBus, type Audience } from "./event-bus.js";
import { LiveText } from "./live-text.js";

// Who a stream was opened for.
export interface StreamHolder {
  accountId: string;
  email: string;
  // The browser session it was opened with.
  sessionId: string;
}

interface Open {
  holder: StreamHolder;
  channel: SseChannel;
}

export const reaches = (audience: Audience | null, holder: StreamHolder): boolean =>
  audience === null || audience.kind === "everyone" || audience.accountId === holder.accountId || (audience.emails ?? []).includes(holder.email);

// The journal read in pages, from `after`, up to `until` (inclusive).
export type JournalReader = (after: number, until: number) => Promise<AnySessionEvent[]>;

// SUBSCRIBE, READ, CATCH UP, GO LIVE -- for any journal (a chat's, a research session's). `subscribe` hands each live
// event to `push`; `head` is the journal's last sequence number now.
export async function replayThenLive(o: {
  channel: SseChannel;
  after: number;
  head: () => Promise<number>;
  read: JournalReader;
  subscribe: (push: (event: AnySessionEvent) => void) => () => void;
}): Promise<() => void> {
  const buffered: AnySessionEvent[] = [];
  let live = false;
  let last = o.after;
  const send = (event: AnySessionEvent): void => {
    if (typeof event.seq === "number") {
      if (event.seq <= last) return;
      last = event.seq;
    }
    o.channel.send(event, event.seq);
  };
  const unsubscribe = o.subscribe((event) => (live ? send(event) : buffered.push(event)));
  try {
    const until = await o.head();
    for (let page = await o.read(last, until); page.length > 0 && !o.channel.closed; page = await o.read(last, until)) {
      for (const event of page) send(event);
    }
    for (const event of buffered.splice(0)) send(event);
    live = true;
  } catch (err) {
    unsubscribe();
    throw err;
  }
  return unsubscribe;
}

@Injectable()
export class StreamGateway {
  private readonly open = new Set<Open>();

  constructor(
    @Inject(EventBus) private readonly bus: EventBus,
    @Inject(EventStore) private readonly journal: EventStore,
    @Inject(LiveText) private readonly liveText: LiveText,
  ) {}

  async session(sessionId: string, holder: StreamHolder, req: Request, res: Response): Promise<void> {
    let unsubscribe: () => void = () => undefined;
    const channel = this.openStream(holder, req, res, () => unsubscribe());
    unsubscribe = await replayThenLive({
      channel,
      after: resumeAfter(req),
      head: () => this.journal.head(sessionId),
      read: (after, until) => this.journal.since(sessionId, after, 1_000, until),
      subscribe: (push) => this.bus.subscribe({ stream: "session", sessionId }, (e) => push(e as AnySessionEvent)),
    });
    if (channel.closed) return unsubscribe();
    for (const snapshot of this.liveText.snapshots(sessionId)) channel.send(snapshot, null);
  }

  app(holder: StreamHolder, req: Request, res: Response): void {
    let unsubscribe: () => void = () => undefined;
    const channel = this.openStream(holder, req, res, () => unsubscribe());
    unsubscribe = this.bus.subscribe({ stream: "app" }, (event, audience) => {
      if (reaches(audience, holder)) channel.send(event as AnyAppStreamEvent, null);
    });
  }

  // An SSE stream held for `holder`, closed with the others of its session or account (a research session's stream
  // opens its own this way). `onClose` runs once, however it ends.
  openStream(holder: StreamHolder, req: Request, res: Response, onClose: () => void): SseChannel {
    let entry: Open | null = null;
    const channel = openSse(req, res, () => {
      if (entry !== null) this.open.delete(entry);
      onClose();
    });
    entry = { holder, channel };
    this.open.add(entry);
    return channel;
  }

  // Every stream a browser session opened ends now.
  closeSession(sessionId: string): number {
    return this.closeWhere((h) => h.sessionId === sessionId);
  }

  // Every stream of an account ends now.
  closeAccount(accountId: string): number {
    return this.closeWhere((h) => h.accountId === accountId);
  }

  closeAll(): number {
    return this.closeWhere(() => true);
  }

  openFor(accountId: string): number {
    return [...this.open].filter((o) => o.holder.accountId === accountId && !o.channel.closed).length;
  }

  // The accounts, and the browser sessions, that hold a stream now.
  accounts(): string[] {
    return [...new Set([...this.open].map((o) => o.holder.accountId))];
  }

  sessions(): string[] {
    return [...new Set([...this.open].map((o) => o.holder.sessionId))];
  }

  private closeWhere(test: (h: StreamHolder) => boolean): number {
    let n = 0;
    for (const o of [...this.open]) {
      if (!test(o.holder)) continue;
      this.open.delete(o);
      if (o.channel.closed) continue;
      o.channel.close();
      n += 1;
    }
    return n;
  }
}
