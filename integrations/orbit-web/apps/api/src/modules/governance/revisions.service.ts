// THE ACCOUNT'S POLICY, through its lifecycle (governance-core lifecycle.ts):
//
//   DRAFT -> VALIDATED -> PUBLISHED -> SUPERSEDED            (or DISCARDED, from a draft)
//
// ONE OWNER: every move is the account owner's, names the content it read (its digest: a revision that moved since is
// refused, never overwritten), and is an audit record written in the same transaction as the move. Publishing is the
// owner's CONFIRMATION -- of exactly this content, against exactly the revision in effect it was compared with, having
// acknowledged the risk the server works out from the two policies (risk.ts), never from their words -- and nothing
// waits for a second person: there is none. It is recorded as a confirmation (policy.confirmed), never as an approval.
// A published revision never changes (the database refuses it too); a rollback is a copy of an earlier revision, taken
// through the whole lifecycle again.
//
// Every account starts with a published policy: the default of its deployment, published by Orbit Web itself when the
// account is created (`provision`, recorded as policy.provisioned) -- so a person can start right after signing in.
//
// An agent may hand in a draft (the agent gateway), and that is all: it never edits, validates or publishes anything --
// those routes refuse it at the gate, and every method here refuses a principal that is not the owner too.
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { canonicalJson, checkConstitution, confirmationRefusal, defaultAccountPolicy, evaluate, impactOf, lintRules, move, type Constitution, type GovernanceRequest, type Impact, type LifecycleOp } from "@orbit-web/governance-core";
import {
  checkCreateRevision,
  checkDigestRequest,
  checkPublishRevision,
  checkSimulate,
  checkUpdateRevision,
  type PolicyOverview,
  type RevisionSource,
  type RevisionStep,
  type RevisionSummary,
  type RevisionView,
  type SimulateResult,
} from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "../../config/config.js";
import { accountAudience, EventBus } from "../../core/events/event-bus.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { accepted, ApiError, conflict, notFound } from "../../common/errors.js";
import { Db } from "../../infra/db/db.js";
import { AuditStore, RevisionStore, sha256, type RevisionRecord } from "../../infra/governance/stores.js";
import { auditPrincipalOf, labelOf, systemContext, type GovernanceContext } from "../auth/principal.js";
import { AccessHooks } from "./access-hooks.js";
import { AuditService } from "./audit.service.js";
import { PolicyService } from "./policy.service.js";

const STEP_OF: Record<string, string> = {
  "policy.provisioned": "provisioned",
  "policy.draft.created": "created",
  "policy.draft.edited": "edited",
  "policy.validated": "validated",
  "policy.discarded": "discarded",
  "policy.confirmed": "confirmed",
  "policy.published": "published",
};

const PROVISIONING = "system:provisioning";

const REFUSALS: Record<string, { status: number; code: string; message: string }> = {
  STALE_CONTENT: { status: HttpStatus.CONFLICT, code: "stale_revision", message: "This revision is not the content you read: read it again." },
  STALE_BASE: { status: HttpStatus.CONFLICT, code: "stale_base", message: "The policy in effect changed since you compared this revision with it: read what it would change again." },
  RISK_NOT_ACKNOWLEDGED: { status: HttpStatus.CONFLICT, code: "risk_not_acknowledged", message: "This change carries a risk you have not acknowledged: read what it would change, then confirm it at that risk." },
};

function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

const summaryOf = (r: RevisionRecord): RevisionSummary => ({
  id: r.id,
  revision: r.revision,
  state: r.state,
  digest: r.digest,
  name: r.name,
  risk: r.risk,
  source: r.source,
  basedOn: r.basedOn,
  createdAt: r.createdAt,
  createdBy: r.createdBy,
  updatedAt: r.updatedAt,
  confirmedBy: r.confirmedBy,
  confirmedAt: r.confirmedAt,
  publishedAt: r.publishedAt,
  publishedBy: r.publishedBy,
});

const nameOf = (document: unknown): string => {
  const name = (document as { metadata?: { name?: unknown } } | null)?.metadata?.name;
  return typeof name === "string" && name.trim().length > 0 ? name.trim().slice(0, 120) : "(unnamed draft)";
};

@Injectable()
export class RevisionsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(Db) private readonly db: Db,
    @Inject(RevisionStore) private readonly revisions: RevisionStore,
    @Inject(AuditStore) private readonly auditStore: AuditStore,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(EventBus) private readonly bus: EventBus,
    @Inject(AccessHooks) private readonly hooks: AccessHooks,
  ) {}

  async overview(accountId: string): Promise<PolicyOverview> {
    const effective = await this.revisions.effective(accountId);
    return { effective: effective === null ? null : await this.viewOf(accountId, effective), revisions: (await this.revisions.list(accountId)).map(summaryOf) };
  }

  async view(accountId: string, id: string): Promise<RevisionView> {
    return this.viewOf(accountId, await this.existing(accountId, id));
  }

  // ---- provisioning ---------------------------------------------------------------------------------------------------

  // The default policy of the deployment, published for a new account (inside the transaction that creates it). Nothing
  // happens when the account has a policy in effect already.
  async provision(accountId: string): Promise<RevisionRecord | null> {
    return this.db.tx(async () => {
      await this.revisions.lockHead(accountId);
      if ((await this.revisions.effective(accountId)) !== null) return null;
      const deployment = this.config.governance.deployment;
      const document = defaultAccountPolicy(accountId, deployment);
      const text = canonicalJson(document);
      const at = new Date().toISOString();
      const record: RevisionRecord = {
        id: `rev-${randomUUID()}`,
        accountId,
        revision: await this.revisions.nextNumber(accountId),
        state: "PUBLISHED",
        document: text,
        digest: sha256(text),
        name: document.metadata.name,
        risk: null,
        source: "default",
        basedOn: null,
        authors: [PROVISIONING],
        createdAt: at,
        createdBy: PROVISIONING,
        updatedAt: at,
        confirmedDigest: null,
        confirmedBase: null,
        confirmedRisk: null,
        confirmedBy: null,
        confirmedAt: null,
        publishedAt: at,
        publishedBy: PROVISIONING,
        supersededAt: null,
      };
      await this.revisions.insert(record);
      await this.audit.record(systemContext("provisioning", accountId), { type: "policy.provisioned", outcome: "published", policyRevision: record.id, data: { revisionId: record.id, revision: record.revision, digest: record.digest, deployment } });
      this.changed(accountId, record.id);
      return record;
    });
  }

  // Whether the account's governance can decide its office's commands: a policy in effect that still reads as valid.
  // Missing (an account made before its default was provisioned), it is provisioned now -- once, under the head's lock;
  // one that no longer reads as valid is reported and never overwritten (its owner publishes a valid one).
  async ensureReady(accountId: string): Promise<"ready" | "provisioned" | "invalid"> {
    const record = await this.revisions.effective(accountId);
    if (record === null) return (await this.provision(accountId)) === null ? "ready" : "provisioned";
    return checkConstitution(parsed(record.document)).ok ? "ready" : "invalid";
  }

  // ---- writing a draft ----------------------------------------------------------------------------------------------

  async create(ctx: GovernanceContext, body: unknown): Promise<RevisionView> {
    const accountId = await this.owner(ctx, "create a draft");
    const req = accepted(checkCreateRevision(body));
    const from = req.from !== undefined ? await this.existing(accountId, req.from) : null;
    const effective = await this.revisions.effective(accountId);
    const document = req.document ?? (from !== null ? parsed(from.document) : effective !== null ? parsed(effective.document) : defaultAccountPolicy(accountId, this.config.governance.deployment));
    const source: RevisionSource = req.document !== undefined ? "owner" : from !== null || effective !== null ? "copy" : "default";
    return this.insert(ctx, accountId, document, source, from?.id ?? (req.document === undefined ? (effective?.id ?? null) : null));
  }

  // A draft an agent handed in through its gateway: a draft only, written by the agent, waiting for the owner.
  async propose(ctx: GovernanceContext, document: unknown): Promise<RevisionView> {
    if (ctx.principal.kind !== "agent") throw new ApiError(HttpStatus.FORBIDDEN, "not_an_agent", "Only a run's agent hands in a proposal here.");
    const accountId = ctx.principal.binding.accountId;
    return this.insert(ctx, accountId, document, "agent", (await this.revisions.effective(accountId))?.id ?? null);
  }

  private async insert(ctx: GovernanceContext, accountId: string, document: unknown, source: RevisionSource, basedOn: string | null): Promise<RevisionView> {
    const text = canonicalJson(document);
    const at = new Date().toISOString();
    const who = labelOf(ctx.principal);
    const record: RevisionRecord = {
      id: `rev-${randomUUID()}`,
      accountId,
      revision: null,
      state: "DRAFT",
      document: text,
      digest: sha256(text),
      name: nameOf(document),
      risk: null,
      source,
      basedOn,
      authors: [who],
      createdAt: at,
      createdBy: who,
      updatedAt: at,
      confirmedDigest: null,
      confirmedBase: null,
      confirmedRisk: null,
      confirmedBy: null,
      confirmedAt: null,
      publishedAt: null,
      publishedBy: null,
      supersededAt: null,
    };
    await this.db.tx(async () => {
      await this.revisions.insert(record);
      await this.audit.record(ctx, { type: "policy.draft.created", outcome: "draft", accountId, data: { revisionId: record.id, digest: record.digest, source, ...(source === "agent" ? { proposedBy: who } : {}) } });
    });
    this.changed(accountId, record.id);
    return this.viewOf(accountId, record);
  }

  async update(ctx: GovernanceContext, id: string, body: unknown): Promise<RevisionView> {
    const accountId = await this.owner(ctx, "edit a draft");
    const req = accepted(checkUpdateRevision(body));
    const next = await this.db.tx(async () => {
      const r = this.moved(await this.existing(accountId, id), "edit");
      if (r.digest !== req.expectedDigest) throw conflict("stale_revision", "This revision changed since it was read: read it again, then edit.");
      const text = canonicalJson(req.document);
      const who = labelOf(ctx.principal);
      const edited: RevisionRecord = { ...r, state: "DRAFT", document: text, digest: sha256(text), name: nameOf(req.document), risk: null, authors: [...new Set([...r.authors, who])], updatedAt: new Date().toISOString() };
      await this.save(edited, r);
      await this.audit.record(ctx, { type: "policy.draft.edited", outcome: "draft", accountId, data: { revisionId: id, digest: edited.digest } });
      return edited;
    });
    this.changed(accountId, id);
    return this.viewOf(accountId, next);
  }

  // ---- the lifecycle ------------------------------------------------------------------------------------------------

  async validate(ctx: GovernanceContext, id: string): Promise<RevisionView> {
    const accountId = await this.owner(ctx, "validate a draft");
    const next = await this.db.tx(async () => {
      const r = this.moved(await this.existing(accountId, id), "validate");
      const errors = this.errorsOf(accountId, r);
      if (errors.length > 0) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, "invalid_policy", `This draft is not a valid policy: ${errors.join("; ")}`, { errors });
      const validated: RevisionRecord = { ...r, state: "VALIDATED", updatedAt: new Date().toISOString() };
      await this.save(validated, r);
      await this.audit.record(ctx, { type: "policy.validated", outcome: "validated", accountId, data: { revisionId: id, digest: r.digest } });
      return validated;
    });
    this.changed(accountId, id);
    return this.viewOf(accountId, next);
  }

  async discard(ctx: GovernanceContext, id: string, body: unknown): Promise<RevisionView> {
    const accountId = await this.owner(ctx, "discard a draft");
    const req = accepted(checkDigestRequest(body));
    const next = await this.db.tx(async () => {
      const r = this.moved(await this.existing(accountId, id), "discard");
      if (r.digest !== req.digest) throw conflict("stale_revision", "This revision is not the content you read: read it again.");
      const discarded: RevisionRecord = { ...r, state: "DISCARDED", updatedAt: new Date().toISOString() };
      await this.save(discarded, r);
      await this.audit.record(ctx, { type: "policy.discarded", outcome: "discarded", accountId, data: { revisionId: id, digest: r.digest } });
      return discarded;
    });
    this.changed(accountId, id);
    return this.viewOf(accountId, next);
  }

  // THE OWNER'S CONFIRMATION: exactly the content read, against exactly the base read, at the risk acknowledged --
  // becomes the account's policy in effect, under its next number. The account's publications take turns (its head row
  // is locked), so two at once cannot both replace the same revision.
  async publish(ctx: GovernanceContext, id: string, body: unknown): Promise<RevisionView> {
    const accountId = await this.owner(ctx, "publish the policy");
    const req = accepted(checkPublishRevision(body));
    const next = await this.db.tx(async () => {
      await this.revisions.lockHead(accountId);
      const r = this.moved(await this.existing(accountId, id), "publish");
      if (this.errorsOf(accountId, r).length > 0) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, "invalid_policy", "This revision no longer reads as a valid policy.");
      const effective = await this.revisions.effective(accountId);
      const risk = this.impactAgainst(accountId, r, effective)?.risk ?? "high";
      const refusal = confirmationRefusal({ actorType: auditPrincipalOf(ctx.principal).principalType, risk, acknowledgedRisk: req.acknowledgedRisk, readDigest: req.digest, digest: r.digest, readBase: req.base, base: effective?.id ?? null });
      if (refusal !== null) {
        const said = REFUSALS[refusal] ?? { status: HttpStatus.FORBIDDEN, code: "not_a_person", message: "Only the account's owner confirms a publication." };
        throw new ApiError(said.status, said.code, said.message, { risk, base: effective?.id ?? null });
      }
      const at = new Date().toISOString();
      const who = labelOf(ctx.principal);
      if (effective !== null) await this.save({ ...effective, state: "SUPERSEDED", supersededAt: at, updatedAt: at }, effective);
      const published: RevisionRecord = {
        ...r,
        state: "PUBLISHED",
        revision: await this.revisions.nextNumber(accountId),
        risk,
        confirmedDigest: r.digest,
        confirmedBase: effective?.id ?? null,
        confirmedRisk: risk,
        confirmedBy: who,
        confirmedAt: at,
        publishedAt: at,
        publishedBy: who,
        updatedAt: at,
      };
      await this.save(published, r);
      await this.audit.record(ctx, { type: "policy.confirmed", outcome: "confirmed", accountId, data: { revisionId: id, digest: r.digest, base: effective?.id ?? null, risk } });
      await this.audit.record(ctx, { type: "policy.published", outcome: "published", accountId, policyRevision: id, data: { revisionId: id, revision: published.revision, digest: r.digest, replaces: effective?.id ?? null, risk } });
      return published;
    });
    this.changed(accountId, id);
    // What every employee may do may have changed: live attempts are held to it from now on.
    this.hooks.changed(accountId, { cause: "company policy published" });
    return this.viewOf(accountId, next);
  }

  // ---- asking a policy without deciding anything ----------------------------------------------------------------------

  async simulate(accountId: string, body: unknown): Promise<SimulateResult> {
    const req = accepted(checkSimulate(body));
    const record = req.revisionId !== undefined ? await this.existing(accountId, req.revisionId) : await this.revisions.effective(accountId);
    const checked = record === null ? null : checkConstitution(parsed(record.document));
    const constitution = checked?.ok === true ? checked.value : null;
    const request: GovernanceRequest = { ...req.request, principalId: "simulation", accountId };
    return { revisionId: record?.id ?? null, revision: record?.revision ?? null, evaluation: evaluate(await this.policy.policy(accountId, constitution), request) };
  }

  // ---- reading ------------------------------------------------------------------------------------------------------

  private async viewOf(accountId: string, r: RevisionRecord): Promise<RevisionView> {
    const document = parsed(r.document);
    const checked = checkConstitution(document);
    const effective = await this.revisions.effective(accountId);
    const done = r.state === "SUPERSEDED" || r.state === "DISCARDED";
    return {
      ...summaryOf(r),
      document,
      errors: this.errorsOf(accountId, r),
      warnings: checked.ok ? lintRules(checked.value.rules) : [],
      impact: done ? null : this.impactAgainst(accountId, r, effective),
      base: effective === null || effective.id === r.id ? null : effective.id,
      authors: r.authors,
      history: await this.historyOf(accountId, r.id),
    };
  }

  private async historyOf(accountId: string, id: string): Promise<RevisionStep[]> {
    const events = (await this.auditStore.page(accountId, { limit: 1000, types: Object.keys(STEP_OF) })).filter((e) => e.data.revisionId === id);
    return events.reverse().map((e) => ({ what: STEP_OF[e.eventType] ?? e.eventType, by: e.principalType === "agent" ? `agent:${e.principalId}` : e.principalType === "system" ? `system:${e.principalId}` : e.principalId, at: e.occurredAt, digest: typeof e.data.digest === "string" ? e.data.digest : null, eventId: e.eventId }));
  }

  private errorsOf(accountId: string, r: RevisionRecord): string[] {
    const checked = checkConstitution(parsed(r.document));
    if (!checked.ok) return checked.errors;
    return checked.value.metadata.accountId === accountId ? [] : [`metadata.accountId must be this account's id, ${accountId}`];
  }

  // What publishing `r` would change, against the revision in effect (or, were there none, the deployment's default).
  private impactAgainst(accountId: string, r: RevisionRecord, effective: RevisionRecord | null): Impact | null {
    const checked = checkConstitution(parsed(r.document));
    if (!checked.ok) return null;
    const base = effective !== null && effective.id !== r.id ? checkConstitution(parsed(effective.document)) : null;
    const baseline: Constitution = base?.ok === true ? base.value : effective?.id === r.id ? checked.value : defaultAccountPolicy(accountId, this.config.governance.deployment);
    return impactOf(baseline, effective?.id === r.id ? baseline : checked.value);
  }

  // Refused, and recorded, unless the context is the account's owner: an agent or a service never writes the policy.
  private async owner(ctx: GovernanceContext, what: string): Promise<string> {
    if (ctx.principal.kind === "owner") return ctx.principal.accountId;
    await this.audit.record(ctx, { type: "authz.denied", outcome: "refused", data: { action: "governance.policy.modify", route: what, cause: "not_the_owner" } });
    throw new ApiError(HttpStatus.FORBIDDEN, "owner_required", "Only the account's owner changes its policy.");
  }

  private moved(r: RevisionRecord, op: LifecycleOp): RevisionRecord {
    const m = move(r.state, op);
    if (!m.ok) throw conflict("wrong_state", m.message);
    return r;
  }

  // Written back only while it is still what was read: two writers racing on one revision cannot both move it.
  private async save(next: RevisionRecord, read: RevisionRecord): Promise<void> {
    if (!(await this.revisions.save(next, { state: read.state, digest: read.digest }))) throw conflict("stale_revision", "This revision changed while it was being moved: read it again.");
  }

  private async existing(accountId: string, id: string): Promise<RevisionRecord> {
    const r = await this.revisions.get(accountId, id);
    if (r === null) throw notFound("The revision");
    return r;
  }

  private changed(accountId: string, id: string): void {
    this.bus.publishApp("governance.changed", { area: "policy", id }, accountAudience(accountId));
  }
}
