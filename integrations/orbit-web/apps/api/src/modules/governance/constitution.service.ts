// THE COMPANY CONSTITUTION'S REVISIONS, through their lifecycle (governance-core lifecycle.ts):
//
//   DRAFT -> VALIDATED -> PENDING_APPROVAL -> APPROVED -> PUBLISHED -> SUPERSEDED     (+ REJECTED, withdrawn to DRAFT)
//
// Every move is one permission's (the route says which), names the content it read (its digest: a revision that moved
// since is refused, never overwritten), and is an audit record written in the same transaction as the move. What a
// change of policy DOES is worked out from the two policies (risk.ts), never from its words; a high-risk change is
// approved by somebody who wrote none of it. A published revision never changes (the database refuses it too); a
// rollback is a copy of an earlier revision, taken through the whole lifecycle again.
//
// An agent may hand in a draft (the agent gateway), and that is all: it never edits, validates, asks for approval,
// approves or publishes anything -- those routes refuse it, and the draft waits for a person.
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  approvalRefusal,
  canonicalJson,
  checkConstitution,
  defaultConstitution,
  evaluate,
  impactOf,
  lintRules,
  move,
  type Constitution,
  type GovernanceRequest,
  type Impact,
  type LifecycleOp,
  type RiskLevel,
} from "@orbit-web/governance-core";
import {
  checkCreateRevision,
  checkDigestRequest,
  checkSimulate,
  checkUpdateRevision,
  type ConstitutionOverview,
  type RevisionStep,
  type RevisionSummary,
  type RevisionView,
  type SimulateResult,
} from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import { EventBus } from "../../core/events/event-bus.js";
import { accepted, ApiError, conflict, notFound } from "../../common/errors.js";
import { GovernanceDatabase } from "../../infra/governance/governance-db.js";
import { AuditStore, OperatorStore, RevisionStore, sha256, type RevisionRecord } from "../../infra/governance/stores.js";
import { AuditService } from "./audit.service.js";
import { labelOf, type GovernanceContext } from "./principal.js";
import { PolicyService } from "./policy.service.js";

const RISK_RANK: Record<RiskLevel, number> = { low: 0, elevated: 1, high: 2 };

const STEP_OF: Record<string, string> = {
  "constitution.draft.created": "created",
  "constitution.draft.edited": "edited",
  "constitution.validated": "validated",
  "constitution.approval.requested": "approval requested",
  "constitution.withdrawn": "withdrawn",
  "constitution.approved": "approved",
  "constitution.rejected": "rejected",
  "constitution.published": "published",
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
  publishedAt: r.publishedAt,
});

const nameOf = (document: unknown): string => {
  const name = (document as { metadata?: { name?: unknown } } | null)?.metadata?.name;
  return typeof name === "string" && name.trim().length > 0 ? name.trim().slice(0, 120) : "(unnamed draft)";
};

@Injectable()
export class ConstitutionService {
  constructor(
    @Inject(GovernanceDatabase) private readonly database: GovernanceDatabase,
    @Inject(RevisionStore) private readonly revisions: RevisionStore,
    @Inject(OperatorStore) private readonly operators: OperatorStore,
    @Inject(AuditStore) private readonly auditStore: AuditStore,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(EventBus) private readonly bus: EventBus,
  ) {}

  overview(): ConstitutionOverview {
    const effective = this.revisions.effective();
    return { effective: effective === null ? null : this.viewOf(effective), revisions: this.revisions.list().map(summaryOf) };
  }

  view(id: string): RevisionView {
    return this.viewOf(this.existing(id));
  }

  // ---- writing a draft ----------------------------------------------------------------------------------------------

  create(ctx: GovernanceContext, body: unknown): RevisionView {
    const req = accepted(checkCreateRevision(body));
    const org = this.organizationId();
    const from = req.from !== undefined ? this.existing(req.from) : null;
    const effective = this.revisions.effective();
    const document = req.document ?? (from !== null ? parsed(from.document) : effective !== null ? parsed(effective.document) : defaultConstitution(org));
    const source = req.document !== undefined ? "operator" : from !== null || effective !== null ? "copy" : "default";
    return this.insert(ctx, document, source, from?.id ?? (req.document === undefined ? (effective?.id ?? null) : null));
  }

  // A draft an agent handed in through its gateway: a draft only, written by the agent, waiting for a person.
  propose(ctx: GovernanceContext, document: unknown): RevisionView {
    return this.insert(ctx, document, "agent", this.revisions.effective()?.id ?? null);
  }

  private insert(ctx: GovernanceContext, document: unknown, source: RevisionRecord["source"], basedOn: string | null): RevisionView {
    const text = canonicalJson(document);
    const at = new Date().toISOString();
    const who = labelOf(ctx.principal);
    const record: RevisionRecord = {
      id: `rev-${randomUUID()}`,
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
      approvedDigest: null,
      approvedBy: null,
      approvedAt: null,
      publishedAt: null,
      publishedBy: null,
      supersededAt: null,
    };
    return this.database.transaction(() => {
      this.revisions.insert(record);
      this.audit.record(ctx, { type: "constitution.draft.created", outcome: "draft", data: { revisionId: record.id, digest: record.digest, source } });
      this.changed(record.id);
      return this.viewOf(record);
    });
  }

  update(ctx: GovernanceContext, id: string, body: unknown): RevisionView {
    const req = accepted(checkUpdateRevision(body));
    return this.database.transaction(() => {
      const r = this.moved(this.existing(id), "edit");
      if (r.digest !== req.expectedDigest) throw conflict("stale_revision", "This revision changed since it was read: read it again, then edit.");
      const text = canonicalJson(req.document);
      const who = labelOf(ctx.principal);
      const next: RevisionRecord = { ...r, state: "DRAFT", document: text, digest: sha256(text), name: nameOf(req.document), risk: null, authors: [...new Set([...r.authors, who])], updatedAt: new Date().toISOString(), approvedDigest: null, approvedBy: null, approvedAt: null };
      this.revisions.save(next);
      this.audit.record(ctx, { type: "constitution.draft.edited", outcome: "draft", data: { revisionId: id, digest: next.digest } });
      this.changed(id);
      return this.viewOf(next);
    });
  }

  // ---- the lifecycle ------------------------------------------------------------------------------------------------

  validate(ctx: GovernanceContext, id: string): RevisionView {
    return this.database.transaction(() => {
      const r = this.moved(this.existing(id), "validate");
      const errors = this.errorsOf(r);
      if (errors.length > 0) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, "invalid_constitution", `This draft is not a valid Constitution: ${errors.join("; ")}`, { errors });
      const next: RevisionRecord = { ...r, state: "VALIDATED", updatedAt: new Date().toISOString() };
      this.revisions.save(next);
      this.audit.record(ctx, { type: "constitution.validated", outcome: "validated", data: { revisionId: id, digest: r.digest } });
      this.changed(id);
      return this.viewOf(next);
    });
  }

  requestApproval(ctx: GovernanceContext, id: string): RevisionView {
    return this.database.transaction(() => {
      const r = this.moved(this.existing(id), "request_approval");
      const impact = this.impactOf(r);
      const who = labelOf(ctx.principal);
      // Whoever asks for a change's approval answers for it, as its author does.
      const next: RevisionRecord = { ...r, state: "PENDING_APPROVAL", risk: impact?.risk ?? "high", authors: [...new Set([...r.authors, who])], updatedAt: new Date().toISOString() };
      this.revisions.save(next);
      this.audit.record(ctx, { type: "constitution.approval.requested", outcome: "pending", data: { revisionId: id, digest: r.digest, risk: next.risk } });
      this.changed(id);
      return this.viewOf(next);
    });
  }

  withdraw(ctx: GovernanceContext, id: string): RevisionView {
    return this.database.transaction(() => {
      const r = this.moved(this.existing(id), "withdraw");
      const next: RevisionRecord = { ...r, state: "DRAFT", risk: null, approvedDigest: null, approvedBy: null, approvedAt: null, updatedAt: new Date().toISOString() };
      this.revisions.save(next);
      this.audit.record(ctx, { type: "constitution.withdrawn", outcome: "draft", data: { revisionId: id } });
      this.changed(id);
      return this.viewOf(next);
    });
  }

  approve(ctx: GovernanceContext, id: string, body: unknown): RevisionView {
    const req = accepted(checkDigestRequest(body));
    return this.database.transaction(() => {
      const r = this.moved(this.existing(id), "approve");
      // The risk is worked out again now: the policy in effect may have moved since approval was asked for.
      const risk = this.impactOf(r)?.risk ?? "high";
      const refusal = approvalRefusal({ risk, authors: r.authors, approverId: labelOf(ctx.principal), readDigest: req.digest, digest: r.digest });
      if (refusal === "STALE_CONTENT") throw conflict("stale_revision", "This revision is not the content you read: read it again.");
      if (refusal === "SELF_APPROVAL") {
        this.audit.record(ctx, { type: "authz.denied", outcome: "refused", data: { permission: "constitution.approve", route: `approve ${id}`, cause: "self_approval" } });
        throw new ApiError(HttpStatus.FORBIDDEN, "self_approval", "This is a high-risk change you wrote or asked for: somebody who wrote none of it approves it.");
      }
      const at = new Date().toISOString();
      const next: RevisionRecord = { ...r, state: "APPROVED", risk, approvedDigest: r.digest, approvedBy: labelOf(ctx.principal), approvedAt: at, updatedAt: at };
      this.revisions.save(next);
      this.audit.record(ctx, { type: "constitution.approved", outcome: "approved", data: { revisionId: id, digest: r.digest, risk } });
      this.changed(id);
      return this.viewOf(next);
    });
  }

  reject(ctx: GovernanceContext, id: string, body: unknown): RevisionView {
    const req = accepted(checkDigestRequest(body));
    return this.database.transaction(() => {
      const r = this.moved(this.existing(id), "reject");
      if (r.digest !== req.digest) throw conflict("stale_revision", "This revision is not the content you read: read it again.");
      const next: RevisionRecord = { ...r, state: "REJECTED", updatedAt: new Date().toISOString() };
      this.revisions.save(next);
      this.audit.record(ctx, { type: "constitution.rejected", outcome: "rejected", data: { revisionId: id, digest: r.digest } });
      this.changed(id);
      return this.viewOf(next);
    });
  }

  // The approved content -- exactly it -- becomes the Constitution in effect, under the next number.
  publish(ctx: GovernanceContext, id: string, body: unknown): RevisionView {
    const req = accepted(checkDigestRequest(body));
    return this.database.transaction(() => {
      const r = this.moved(this.existing(id), "publish");
      if (r.digest !== req.digest || r.approvedDigest !== r.digest) throw conflict("approval_stale", "What was approved is not this content: it is approved again before it is published.");
      if (this.errorsOf(r).length > 0) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, "invalid_constitution", "This revision no longer reads as a valid Constitution.");
      const risk = this.impactOf(r)?.risk ?? "high";
      if (RISK_RANK[risk] > RISK_RANK[r.risk ?? "high"]) throw conflict("approval_stale", `Against the policy in effect now this change is ${risk} risk, more than when it was approved: withdraw it and ask again.`);
      const previous = this.revisions.effective();
      const at = new Date().toISOString();
      if (previous !== null) this.revisions.save({ ...previous, state: "SUPERSEDED", supersededAt: at, updatedAt: at });
      const next: RevisionRecord = { ...r, state: "PUBLISHED", revision: this.revisions.nextNumber(), publishedAt: at, publishedBy: labelOf(ctx.principal), updatedAt: at };
      this.revisions.save(next);
      this.audit.record(ctx, { type: "constitution.published", outcome: "published", policyRevision: id, data: { revisionId: id, revision: next.revision, digest: r.digest, replaces: previous?.id ?? null, risk } });
      this.changed(id);
      return this.viewOf(next);
    });
  }

  // ---- asking a policy without deciding anything ----------------------------------------------------------------------

  simulate(body: unknown): SimulateResult {
    const req = accepted(checkSimulate(body));
    const record = req.revisionId !== undefined ? this.existing(req.revisionId) : this.revisions.effective();
    const checked = record === null ? null : checkConstitution(parsed(record.document));
    const constitution = checked?.ok === true ? checked.value : null;
    const request: GovernanceRequest = { ...req.request, principalId: "simulation", organizationId: constitution?.metadata.organizationId ?? this.organizationId() };
    return { revisionId: record?.id ?? null, revision: record?.revision ?? null, evaluation: evaluate(this.policy.policy(constitution), request) };
  }

  // ---- reading ------------------------------------------------------------------------------------------------------

  private viewOf(r: RevisionRecord): RevisionView {
    const document = parsed(r.document);
    const checked = checkConstitution(document);
    return {
      ...summaryOf(r),
      document,
      errors: this.errorsOf(r),
      warnings: checked.ok ? lintRules(checked.value.rules) : [],
      impact: r.state === "SUPERSEDED" ? null : this.impactOf(r),
      authors: r.authors,
      history: this.historyOf(r.id),
    };
  }

  private historyOf(id: string): RevisionStep[] {
    const events = this.auditStore.page({ limit: 1000, types: Object.keys(STEP_OF) }).filter((e) => e.data.revisionId === id);
    return events.reverse().map((e) => ({ what: STEP_OF[e.eventType] ?? e.eventType, by: e.principalType === "agent" ? `agent:${e.principalId}` : e.principalId, at: e.occurredAt, digest: typeof e.data.digest === "string" ? e.data.digest : null, eventId: e.eventId }));
  }

  private errorsOf(r: RevisionRecord): string[] {
    const checked = checkConstitution(parsed(r.document));
    if (!checked.ok) return checked.errors;
    const org = this.organizationId();
    return checked.value.metadata.organizationId === org ? [] : [`metadata.organizationId must be this organization's id, ${org}`];
  }

  // What publishing `r` would change, against the revision in effect -- or, before any, the default Constitution.
  impactOf(r: RevisionRecord): Impact | null {
    const checked = checkConstitution(parsed(r.document));
    if (!checked.ok) return null;
    const effective = this.revisions.effective();
    const base = effective !== null && effective.id !== r.id ? checkConstitution(parsed(effective.document)) : null;
    const baseline: Constitution = base?.ok === true ? base.value : defaultConstitution(this.organizationId());
    if (effective?.id === r.id) return impactOf(baseline, baseline);
    return impactOf(baseline, checked.value);
  }

  private moved(r: RevisionRecord, op: LifecycleOp): RevisionRecord {
    const m = move(r.state, op);
    if (!m.ok) throw conflict("wrong_state", m.message);
    return r;
  }

  private existing(id: string): RevisionRecord {
    const r = this.revisions.get(id);
    if (r === null) throw notFound("The revision");
    return r;
  }

  private organizationId(): string {
    return this.operators.organization()?.id ?? "uninitialized";
  }

  private changed(id: string): void {
    this.database.afterCommit(() => this.bus.publishApp("governance.changed", { area: "constitution", id }));
  }
}
