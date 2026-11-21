// THE OUTBOX: integration events are written in the transaction of the change they report (`workforce.events`), with
// their envelope -- id, type and schema version, account, aggregate id/type/version, the order within one save, actor,
// time, correlation and causation. Nothing is delivered before the change commits: consumers read the journal
// (consumers.ts) and the pages are told only after commit (`office.changed`, an invalidation that carries no content).
//
// Every command that changes what the office shows also moves the account's OFFICE VERSION, in the same transaction:
// the `resourceVersion` a command answers, which a page keeps until its read has caught up.
import { Inject, Injectable } from "@nestjs/common";
import { INTEGRATION_EVENTS, isIntegrationEventType, type IntegrationEvent, type OfficeArea } from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import { accountAudience, EventBus } from "../../../core/events/event-bus.js";
import { Db, jsonParam, type Row } from "../../../infra/db/db.js";
import type { RaisedEvent } from "../domain.js";

export interface CommandContext {
  orbitId: string;
  // Who: `owner:<account>`, `system:<task>`, `agent:<run>` (principal.ts labelOf).
  actor: string;
  correlationId: string;
  causationId?: string | null;
}

const SCALAR = (v: unknown): boolean => v === null || ["string", "number", "boolean"].includes(typeof v);

// The payload is a flat record of scalars, checked when it is written AND when it is read.
function checkedPayload(type: string, payload: unknown): IntegrationEvent["payload"] {
  if (!isIntegrationEventType(type)) throw new Error(`${type} is not in the integration event catalog`);
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new Error(`${type}: its payload must be a record`);
  for (const [k, v] of Object.entries(payload)) if (!SCALAR(v)) throw new Error(`${type}: payload field ${k} must be a scalar`);
  return payload as IntegrationEvent["payload"];
}

export const eventOf = (r: Row): IntegrationEvent => ({
  id: String(r.id),
  type: String(r.type) as IntegrationEvent["type"],
  schemaVersion: Number(r.schema_version),
  accountId: String(r.account_id),
  aggregateType: String(r.aggregate_type) as IntegrationEvent["aggregateType"],
  aggregateId: String(r.aggregate_id),
  aggregateVersion: Number(r.aggregate_version),
  ordinal: Number(r.ordinal),
  actor: String(r.actor),
  occurredAt: String(r.occurred_at),
  correlationId: String(r.correlation_id),
  causationId: r.causation_id === null ? null : String(r.causation_id),
  payload: checkedPayload(String(r.type), r.payload),
});

@Injectable()
export class Outbox {
  private readonly listeners: (() => void)[] = [];

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(EventBus) private readonly bus: EventBus,
  ) {}

  // Told (after commit) that events were written: the dispatcher wakes instead of waiting for its next poll.
  onAppended(listener: () => void): void {
    this.listeners.push(listener);
  }

  // Writes the events in the caller's transaction; returns their ids.
  async append(ctx: CommandContext, events: readonly RaisedEvent[]): Promise<string[]> {
    if (events.length > 0) this.db.afterCommit(() => this.listeners.forEach((l) => l()));
    const ids: string[] = [];
    const ordinals = new Map<string, number>();
    const at = new Date().toISOString();
    for (const e of events) {
      const key = `${e.aggregateId}:${e.aggregateVersion}`;
      const ordinal = ordinals.get(key) ?? (await this.nextOrdinal(e.aggregateId, e.aggregateVersion));
      ordinals.set(key, ordinal + 1);
      const id = randomUUID();
      ids.push(id);
      await this.db.query(
        `INSERT INTO workforce.events (id, account_id, type, schema_version, aggregate_type, aggregate_id, aggregate_version, ordinal, actor, occurred_at, correlation_id, causation_id, mission_id, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)`,
        [id, ctx.orbitId, e.type, INTEGRATION_EVENTS[e.type], e.aggregateType, e.aggregateId, e.aggregateVersion, ordinal, ctx.actor, at, ctx.correlationId, ctx.causationId ?? null, e.missionId ?? null, jsonParam(checkedPayload(e.type, e.payload))],
      );
    }
    return ids;
  }

  // Moves the account's office version and, once committed, tells the account's pages which areas to read again.
  async touched(orbitId: string, areas: readonly OfficeArea[], missionId: string | null = null): Promise<number> {
    const row = await this.db.one(
      "INSERT INTO workforce.office_versions (account_id, version) VALUES ($1, 1) ON CONFLICT (account_id) DO UPDATE SET version = workforce.office_versions.version + 1 RETURNING version",
      [orbitId],
    );
    const version = Number(row?.version ?? 0);
    this.bus.publishApp("office.changed", { areas: [...areas], missionId, version }, accountAudience(orbitId));
    return version;
  }

  async version(orbitId: string): Promise<number> {
    return Number((await this.db.one("SELECT version FROM workforce.office_versions WHERE account_id = $1", [orbitId]))?.version ?? 0);
  }

  private async nextOrdinal(aggregateId: string, version: number): Promise<number> {
    const row = await this.db.one("SELECT COALESCE(MAX(ordinal) + 1, 0) AS n FROM workforce.events WHERE aggregate_id = $1 AND aggregate_version = $2", [aggregateId, version]);
    return Number(row?.n ?? 0);
  }
}
