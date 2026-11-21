// THE DISPATCHER: delivers the outbox journal to its consumers -- at least once, applied once. A consumer handles an
// event in ONE transaction with the row that says it did (`workforce.consumer_inbox`, primary key consumer × event):
// two replicas that pick the same event both insert that row, the second waits for the first to commit and then finds
// it there, and does nothing. A rolled-back handling leaves no row, so the event is delivered again.
//
// A handler that fails is retried with a growing delay (with jitter); after MAX_ATTEMPTS it is set aside as DEAD with
// its reason (the inbox row says so) for a person to look at -- it never blocks the events after it. Rebuilding a read
// model never goes through here: consumers are the effects (claiming work, admitting runs, preparing sandboxes), and a
// read is computed from the write tables.
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import type { IntegrationEvent, IntegrationEventType } from "@orbit-web/contracts";
import { Db } from "../../../infra/db/db.js";
import { eventOf, Outbox } from "./outbox.js";

export interface Consumer {
  id: string;
  types: readonly IntegrationEventType[];
  // Runs inside the transaction that records the event as handled.
  handle(event: IntegrationEvent): Promise<void>;
}

const MAX_ATTEMPTS = 8;
const BATCH = 50;
const POLL_MS = 500;
// Events older than this are not looked at again (a consumer registered later does not replay history).
const WINDOW_DAYS = 14;

@Injectable()
export class EventDispatcher implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("EventDispatcher");
  private readonly consumers: Consumer[] = [];
  private readonly failures = new Map<string, { attempts: number; retryAt: number }>();
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private stopped = false;

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(Outbox) outbox: Outbox,
  ) {
    outbox.onAppended(() => this.wake());
  }

  register(consumer: Consumer): void {
    if (this.consumers.some((c) => c.id === consumer.id)) throw new Error(`consumer ${consumer.id} is registered twice`);
    this.consumers.push(consumer);
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => this.wake(), POLL_MS);
    this.timer.unref();
    this.wake();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) clearInterval(this.timer);
    await this.running?.catch(() => undefined);
  }

  // Runs a pass now (or right after the one under way).
  wake(): void {
    if (this.stopped) return;
    if (this.running !== null) {
      this.again = true;
      return;
    }
    this.running = this.pass()
      .catch((err: unknown) => this.logger.error(`a dispatch pass failed: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => {
        this.running = null;
        if (this.again && !this.stopped) {
          this.again = false;
          this.wake();
        }
      });
  }

  // Resolves once no event waits for any consumer (tests; a clean shutdown).
  async drained(timeoutMs = 10_000): Promise<void> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      await this.running;
      if ((await this.pending()) === 0) return;
      if (Date.now() > until) throw new Error("events are still waiting for their consumers");
      this.wake();
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  private async pending(): Promise<number> {
    let n = 0;
    for (const c of this.consumers) {
      const row = await this.db.one(
        `SELECT count(*) AS n FROM workforce.events e WHERE e.type = ANY($1) AND e.occurred_at > now() - ($2 || ' days')::interval
           AND NOT EXISTS (SELECT 1 FROM workforce.consumer_inbox i WHERE i.consumer_id = $3 AND i.event_id = e.id)`,
        [[...c.types], String(WINDOW_DAYS), c.id],
      );
      n += Number(row?.n ?? 0);
    }
    return n;
  }

  private async pass(): Promise<void> {
    for (const c of this.consumers) {
      if (this.stopped) return;
      const rows = await this.db.query(
        `SELECT e.* FROM workforce.events e WHERE e.type = ANY($1) AND e.occurred_at > now() - ($2 || ' days')::interval
           AND NOT EXISTS (SELECT 1 FROM workforce.consumer_inbox i WHERE i.consumer_id = $3 AND i.event_id = e.id)
         ORDER BY e.seq LIMIT $4`,
        [[...c.types], String(WINDOW_DAYS), c.id, BATCH],
      );
      for (const row of rows) await this.deliver(c, eventOf(row));
    }
  }

  private async deliver(c: Consumer, event: IntegrationEvent): Promise<void> {
    const key = `${c.id}:${event.id}`;
    const failed = this.failures.get(key);
    if (failed !== undefined && failed.retryAt > Date.now()) return;
    try {
      await this.db.tx(async () => {
        const n = await this.db.run("INSERT INTO workforce.consumer_inbox (account_id, consumer_id, event_id, processed_at, attempts) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING", [event.accountId, c.id, event.id, new Date().toISOString(), (failed?.attempts ?? 0) + 1]);
        if (n === 0) return;
        await c.handle(event);
      });
      this.failures.delete(key);
    } catch (err) {
      const attempts = (failed?.attempts ?? 0) + 1;
      const why = err instanceof Error ? err.message : String(err);
      if (attempts >= MAX_ATTEMPTS) {
        this.failures.delete(key);
        this.logger.error(`${c.id} gave up on ${event.type} ${event.id} after ${attempts} attempts: ${why}`);
        await this.db.run("INSERT INTO workforce.consumer_inbox (account_id, consumer_id, event_id, processed_at, outcome, error, attempts) VALUES ($1, $2, $3, $4, 'dead', $5, $6) ON CONFLICT DO NOTHING", [event.accountId, c.id, event.id, new Date().toISOString(), why.slice(0, 500), attempts]).catch(() => 0);
        return;
      }
      const delay = Math.min(60_000, 250 * 2 ** attempts) * (0.75 + Math.random() * 0.5);
      this.failures.set(key, { attempts, retryAt: Date.now() + delay });
      this.logger.warn(`${c.id} failed on ${event.type} ${event.id} (attempt ${attempts}, retried in ${Math.round(delay)} ms): ${why}`);
    }
  }
}
