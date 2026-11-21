// WHAT AN ACCOUNT'S GOVERNANCE POINTS AT: its chats (Claude Code workspaces) and its research workspaces. Each is
// registered as the account's in the transaction that creates it, and outlives it: deleting a chat or a research
// workspace marks its row deleted and records that it was -- the policy that narrowed it, the approvals and the audit
// that concerned it stay on record, never cascaded away with it. A run is bound to one of these rows, so a run can only
// ever be bound to a resource of its own account.
import { Inject, Injectable } from "@nestjs/common";
import { accountAudience, EventBus } from "../../core/events/event-bus.js";
import { ResourceStore, type ResourceKind, type ResourceRecord } from "../../infra/governance/stores.js";
import type { GovernanceContext } from "../auth/principal.js";
import { AuditService } from "./audit.service.js";

@Injectable()
export class GovernedResources {
  constructor(
    @Inject(ResourceStore) private readonly store: ResourceStore,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EventBus) private readonly bus: EventBus,
  ) {}

  // A chat or a research workspace is its account's: call inside the transaction that creates it.
  async register(kind: ResourceKind, r: { accountId: string; id: string; title: string }): Promise<void> {
    await this.store.register({ accountId: r.accountId, kind, id: r.id, title: r.title, createdAt: new Date().toISOString() });
    this.changed(r.accountId, `${kind}:${r.id}`);
  }

  // Registered as the account's when it was not yet (a run of a record created before it was): its title kept if it was.
  async ensure(kind: ResourceKind, r: { accountId: string; id: string; title: string }): Promise<void> {
    if ((await this.store.get(r.accountId, kind, r.id)) === null) await this.register(kind, r);
  }

  async retitle(kind: ResourceKind, accountId: string, id: string, title: string): Promise<void> {
    await this.store.retitle(accountId, kind, id, title);
    this.changed(accountId, `${kind}:${id}`);
  }

  // The record is gone; what concerned it stays, and that it was deleted is itself a record.
  async deleted(kind: ResourceKind, accountId: string, id: string, ctx: GovernanceContext): Promise<void> {
    await this.store.deleted(accountId, kind, id, new Date().toISOString());
    await this.audit.record(ctx, { type: "resource.deleted", outcome: "deleted", accountId, workspaceId: id, data: { kind } });
    this.changed(accountId, `${kind}:${id}`);
  }

  async get(accountId: string, kind: ResourceKind, id: string): Promise<ResourceRecord | null> {
    return this.store.get(accountId, kind, id);
  }

  async list(accountId: string, kind: ResourceKind): Promise<ResourceRecord[]> {
    return this.store.list(accountId, kind);
  }

  private changed(accountId: string, id: string): void {
    this.bus.publishApp("governance.changed", { area: "resources", id }, accountAudience(accountId));
  }
}
