// OVERRIDES: what narrows the account's policy for ONE of its chats or research workspaces. An override's rules can only
// make a decision stricter -- governance-core takes the strictest of every layer, so an allow in one changes nothing (and
// is said beside it) -- and the deployment's own limits (each action's ceiling, an action nothing can carry out) stand
// above both. Loosening something for one resource is done in the account's policy, through its whole lifecycle.
//
// The document is made here, from the rules the owner gave: the account and the resource are never taken from a body,
// and a resource that is not the account's own is not found.
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { API_VERSION, canonicalJson, checkOverlay, lintRules, OVERRIDE_KIND, type PolicyOverlay } from "@orbit-web/governance-core";
import { checkSetOverride, type OverrideView } from "@orbit-web/contracts";
import { accountAudience, EventBus } from "../../core/events/event-bus.js";
import { accepted, ApiError, conflict, notFound } from "../../common/errors.js";
import { Db } from "../../infra/db/db.js";
import { OverrideStore, ResourceStore, sha256, type OverrideRecord, type ResourceKind } from "../../infra/governance/stores.js";
import { labelOf, type GovernanceContext } from "../auth/principal.js";
import { AuditService } from "./audit.service.js";

export const overrideViewOf = (o: OverrideRecord): OverrideView => {
  const override = JSON.parse(o.document) as PolicyOverlay;
  return { kind: o.kind, resourceId: o.resourceId, override, digest: o.digest, setAt: o.setAt, setBy: o.setBy, warnings: lintRules(override.rules, true) };
};

@Injectable()
export class OverridesService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(OverrideStore) private readonly store: OverrideStore,
    @Inject(ResourceStore) private readonly resources: ResourceStore,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EventBus) private readonly bus: EventBus,
  ) {}

  async get(accountId: string, kind: ResourceKind, resourceId: string): Promise<OverrideView | null> {
    const o = await this.store.get(accountId, kind, resourceId);
    return o === null ? null : overrideViewOf(o);
  }

  async list(accountId: string): Promise<OverrideView[]> {
    return (await this.store.list(accountId)).map(overrideViewOf);
  }

  async set(ctx: GovernanceContext, kind: ResourceKind, resourceId: string, body: unknown): Promise<OverrideView> {
    const accountId = this.owner(ctx);
    const req = accepted(checkSetOverride(body));
    const resource = await this.resources.get(accountId, kind, resourceId);
    if (resource === null) throw notFound(kind === "workspace" ? "The chat" : "The research workspace");
    if (resource.deletedAt !== null) throw conflict("resource_deleted", "It was deleted: nothing runs there to narrow.");
    const document = { apiVersion: API_VERSION, kind: OVERRIDE_KIND, metadata: { accountId, level: kind, target: resourceId, name: req.name ?? `override for ${resource.title}`.slice(0, 120) }, rules: req.rules };
    const checked = checkOverlay(document);
    if (!checked.ok) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, "invalid_override", `This is not a valid override: ${checked.errors.join("; ")}`, { errors: checked.errors });
    const text = canonicalJson(checked.value);
    const record: OverrideRecord = { accountId, kind, resourceId, document: text, digest: sha256(text), setAt: new Date().toISOString(), setBy: labelOf(ctx.principal) };
    await this.db.tx(async () => {
      await this.store.set(record);
      await this.audit.record(ctx, { type: "override.set", outcome: "set", accountId, workspaceId: resourceId, data: { kind, target: resourceId, digest: record.digest } });
    });
    this.changed(accountId, `${kind}:${resourceId}`);
    return overrideViewOf(record);
  }

  async remove(ctx: GovernanceContext, kind: ResourceKind, resourceId: string): Promise<void> {
    const accountId = this.owner(ctx);
    await this.db.tx(async () => {
      if (!(await this.store.remove(accountId, kind, resourceId))) throw notFound("The override");
      await this.audit.record(ctx, { type: "override.removed", outcome: "removed", accountId, workspaceId: resourceId, data: { kind, target: resourceId } });
    });
    this.changed(accountId, `${kind}:${resourceId}`);
  }

  private owner(ctx: GovernanceContext): string {
    if (ctx.principal.kind !== "owner") throw new ApiError(HttpStatus.FORBIDDEN, "owner_required", "Only the account's owner sets an override.");
    return ctx.principal.accountId;
  }

  private changed(accountId: string, id: string): void {
    this.bus.publishApp("governance.changed", { area: "overrides", id }, accountAudience(accountId));
  }
}
