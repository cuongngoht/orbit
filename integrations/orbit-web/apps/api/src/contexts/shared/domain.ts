// What every bounded context of the virtual office shares in its DOMAIN layer: the account (OrbitId) every aggregate
// belongs to, the errors a command refuses with, and the shape of the events an aggregate raises. Pure TypeScript: no
// NestJS, no PostgreSQL, no HTTP, no filesystem (a test greps the imports of every `domain/` file).
import type { IntegrationEvent, IntegrationEventType } from "@orbit-web/contracts";

// The id of the Orbit account (the tenant) a record belongs to.
export type OrbitId = string;

// Every aggregate of the office is one account's: its repository is always asked with the OrbitId first, and an id of
// another account's record is as if it did not exist.
export abstract class AccountOwned {
  protected constructor(readonly orbitId: OrbitId) {}
}

// Why a command was refused, in the terms of the domain. The presentation layer maps the kind to an HTTP status.
export type RefusalKind = "invalid" | "not_found" | "conflict" | "stale" | "forbidden" | "unprocessable" | "unavailable";

export class DomainError extends Error {
  constructor(
    readonly kind: RefusalKind,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const invalid = (code: string, message: string, details?: unknown) => new DomainError("invalid", code, message, details);
export const missing = (what: string) => new DomainError("not_found", "not_found", `${what} was not found`);
export const conflictWith = (code: string, message: string, details?: unknown) => new DomainError("conflict", code, message, details);
export const stale = (message: string, details?: unknown) => new DomainError("stale", "stale_version", message, details);
export const refused = (code: string, message: string, details?: unknown) => new DomainError("forbidden", code, message, details);
export const unprocessable = (code: string, message: string, details?: unknown) => new DomainError("unprocessable", code, message, details);

// An event an aggregate raised, before the outbox gives it an id, an actor and a correlation.
export interface RaisedEvent {
  type: IntegrationEventType;
  aggregateType: IntegrationEvent["aggregateType"];
  aggregateId: string;
  // The aggregate's version once the change that raised it is saved.
  aggregateVersion: number;
  missionId?: string | null;
  payload: IntegrationEvent["payload"];
}
