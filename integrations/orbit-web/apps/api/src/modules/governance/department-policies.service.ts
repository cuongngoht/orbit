// A DEPARTMENT'S POLICY, through its lifecycle (governance-core department.ts): what one department decides for its
// employees' work, inside what the company's policy in effect delegates to it. The same lifecycle as the company's --
// DRAFT → VALIDATED → PUBLISHED → SUPERSEDED, or DISCARDED -- in tables of its own; a rollback is a copy published anew.
//
// Only the account's owner writes, validates, discards and publishes (governance.policy.modify is people-only); an
// appointee may PROPOSE a draft for its own scope through its tools (governance.policy.propose), never publish. Each
// publication is confirmed against exactly the content read, the department revision in effect read AND the company
// revision in effect read (the company's delegation decides what the department may say), at the risk acknowledged; and
// it is checked again against the company's policy in effect at that moment. Simulation asks the same evaluate() the
// decisions use. Nothing here applies to a chat, a research question or a person: the company's policy alone decides
// those.
import { HttpStatus, Inject, Injectable, Optional } from "@nestjs/common";
import {
  canonicalJson,
  checkDepartmentPolicy,
  composeEmployeeModels,
  composeEmployeeNetwork,
  composeRuntimeSecurity,
  confirmationRefusal,
  departmentImpactOf,
  departmentPolicyErrors,
  departmentTableOf,
  DEPARTMENT_POLICY_KIND,
  API_VERSION,
  evaluate,
  lintRules,
  move,
  runtimeSecurityOf,
  type Constitution,
  type DepartmentPolicy,
  type GovernanceRequest,
  type Impact,
  type LifecycleOp,
  type RuntimeMode,
} from "@orbit-web/governance-core";
import {
  checkCreateRevision,
  checkDigestRequest,
  checkPublishDepartmentRevision,
  checkSimulate,
  checkUpdateRevision,
  type DepartmentPolicyOverview,
  type DepartmentRevisionView,
  type RevisionSource,
  type RevisionStep,
  type RevisionSummary,
  type SimulateResult,
} from "@orbit-web/contracts";
import type { AppConfig } from "../../config/config.js";
import { loadSandboxConfig } from "../../config/sandbox-config.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { randomUUID } from "node:crypto";
import { accountAudience, EventBus } from "../../core/events/event-bus.js";
import { accepted, ApiError, conflict, notFound } from "../../common/errors.js";
import { Db } from "../../infra/db/db.js";
import { AuditStore, DepartmentRevisionStore, sha256, type DepartmentRevisionRecord } from "../../infra/governance/stores.js";
import { auditPrincipalOf, labelOf, type GovernanceContext } from "../auth/principal.js";
import { AccessHooks } from "./access-hooks.js";
import { AuditService } from "./audit.service.js";
import { PolicyService } from "./policy.service.js";

const STEPS: Record<string, string> = {
  "policy.draft.created": "created",
  "policy.draft.edited": "edited",
  "policy.validated": "validated",
  "policy.discarded": "discarded",
  "policy.confirmed": "confirmed",
  "policy.published": "published",
};

const REFUSALS: Record<string, { status: number; code: string; message: string }> = {
  STALE_CONTENT: { status: HttpStatus.CONFLICT, code: "stale_revision", message: "This revision is not the content you read: read it again." },
  STALE_BASE: { status: HttpStatus.CONFLICT, code: "stale_base", message: "The department's policy in effect changed since you compared this revision with it: read what it would change again." },
  STALE_COMPANY_POLICY: { status: HttpStatus.CONFLICT, code: "stale_company_policy", message: "The company's policy changed since you read this: what the department may say may have changed too. Read it again." },
  RISK_NOT_ACKNOWLEDGED: { status: HttpStatus.CONFLICT, code: "risk_not_acknowledged", message: "This change carries a risk you have not acknowledged: read what it would change, then confirm it at that risk." },
};

const parsed = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

const summaryOf = (r: DepartmentRevisionRecord): RevisionSummary => ({
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
export class DepartmentPoliciesService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(DepartmentRevisionStore) private readonly revisions: DepartmentRevisionStore,
    @Inject(AuditStore) private readonly auditStore: AuditStore,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(EventBus) private readonly bus: EventBus,
    @Inject(AccessHooks) private readonly hooks: AccessHooks,
    @Optional() @Inject(APP_CONFIG) private readonly config: AppConfig | null = null,
  ) {}

  // ---- reading --------------------------------------------------------------------------------------------------------

  async overview(accountId: string, departmentId: string): Promise<DepartmentPolicyOverview> {
    const name = await this.departmentName(accountId, departmentId);
    const company = await this.policy.effective(accountId);
    const effective = await this.revisions.effective(accountId, departmentId);
    const current = effective === null ? null : this.documentOf(effective);
    return {
      departmentId,
      departmentName: name,
      companyRevision: company === null ? null : { id: company.record.id, revision: company.record.revision },
      effective: effective === null ? null : await this.viewOf(accountId, departmentId, effective),
      revisions: (await this.revisions.list(accountId, departmentId)).map(summaryOf),
      rows: company === null ? [] : departmentTableOf(company.constitution, current, departmentId),
      network: company === null ? null : composeEmployeeNetwork(company.constitution, current),
      models: company === null ? { allow: null, capped: false } : composeEmployeeModels(company.constitution, current),
      delegation: company?.constitution.delegation?.departments ?? null,
      runtimeSecurity: company === null ? null : { company: runtimeSecurityOf(company.constitution), effective: composeRuntimeSecurity(company.constitution, current, this.runtimeFloor()) },
    };
  }

  // The deployment's floor for employees' runtime security (ORBIT_WEB_RUNTIME_SECURITY_FLOOR), as run governance reads it;
  // a sandbox configuration that does not load is said where the sandbox is made, and holds nothing here.
  private runtimeFloor(): RuntimeMode {
    try {
      return this.config === null ? "disabled" : loadSandboxConfig(this.config.sourceEnv).runtimeSecurity.floor;
    } catch {
      return "disabled";
    }
  }

  async view(accountId: string, departmentId: string, id: string): Promise<DepartmentRevisionView> {
    return this.viewOf(accountId, departmentId, await this.existing(accountId, departmentId, id));
  }

  // ---- writing a draft ------------------------------------------------------------------------------------------------

  // A draft: a document, a copy of a revision (a rollback is a copy of an earlier one), or -- neither -- the revision in
  // effect, else an empty policy that inherits everything from the company.
  async create(ctx: GovernanceContext, departmentId: string, body: unknown): Promise<DepartmentRevisionView> {
    const accountId = await this.owner(ctx, "create a department policy draft");
    const name = await this.departmentName(accountId, departmentId, true);
    const req = accepted(checkCreateRevision(body));
    const from = req.from !== undefined ? await this.existing(accountId, departmentId, req.from) : null;
    const effective = await this.revisions.effective(accountId, departmentId);
    const document = req.document ?? (from !== null ? parsed(from.document) : effective !== null ? parsed(effective.document) : this.emptyOf(accountId, departmentId, name));
    const source: RevisionSource = req.document !== undefined ? "owner" : from !== null || effective !== null ? "copy" : "default";
    return this.insert(ctx, accountId, departmentId, document, source, from?.id ?? (req.document === undefined ? (effective?.id ?? null) : null));
  }

  // A draft an appointee proposed through its tools (its authority over this department was checked by the caller):
  // a draft only, written by the agent, waiting for the owner.
  async propose(ctx: GovernanceContext, departmentId: string, document: unknown): Promise<DepartmentRevisionView> {
    if (ctx.principal.kind !== "agent") throw new ApiError(HttpStatus.FORBIDDEN, "not_an_agent", "Only an employee's run proposes a draft here.");
    const accountId = ctx.principal.binding.accountId;
    await this.departmentName(accountId, departmentId, true);
    return this.insert(ctx, accountId, departmentId, document, "agent", (await this.revisions.effective(accountId, departmentId))?.id ?? null);
  }

  async update(ctx: GovernanceContext, departmentId: string, id: string, body: unknown): Promise<DepartmentRevisionView> {
    const accountId = await this.owner(ctx, "edit a department policy draft");
    const req = accepted(checkUpdateRevision(body));
    const next = await this.db.tx(async () => {
      const r = this.moved(await this.existing(accountId, departmentId, id), "edit");
      if (r.digest !== req.expectedDigest) throw conflict("stale_revision", "This revision changed since it was read: read it again, then edit.");
      const text = canonicalJson(req.document);
      const who = labelOf(ctx.principal);
      const edited: DepartmentRevisionRecord = { ...r, state: "DRAFT", document: text, digest: sha256(text), name: nameOf(req.document), risk: null, authors: [...new Set([...r.authors, who])], updatedAt: new Date().toISOString() };
      await this.save(edited, r);
      await this.audit.record(ctx, { type: "policy.draft.edited", outcome: "draft", accountId, data: { revisionId: id, digest: edited.digest, departmentId } });
      return edited;
    });
    this.changed(accountId, departmentId, id);
    return this.viewOf(accountId, departmentId, next);
  }

  // ---- the lifecycle --------------------------------------------------------------------------------------------------

  // Valid in shape AND for this company: what it says must sit within the company's delegation in effect now.
  async validate(ctx: GovernanceContext, departmentId: string, id: string): Promise<DepartmentRevisionView> {
    const accountId = await this.owner(ctx, "validate a department policy draft");
    const next = await this.db.tx(async () => {
      const r = this.moved(await this.existing(accountId, departmentId, id), "validate");
      await this.refuseInvalid(accountId, departmentId, r);
      const validated: DepartmentRevisionRecord = { ...r, state: "VALIDATED", updatedAt: new Date().toISOString() };
      await this.save(validated, r);
      await this.audit.record(ctx, { type: "policy.validated", outcome: "validated", accountId, data: { revisionId: id, digest: r.digest, departmentId } });
      return validated;
    });
    this.changed(accountId, departmentId, id);
    return this.viewOf(accountId, departmentId, next);
  }

  async discard(ctx: GovernanceContext, departmentId: string, id: string, body: unknown): Promise<DepartmentRevisionView> {
    const accountId = await this.owner(ctx, "discard a department policy draft");
    const req = accepted(checkDigestRequest(body));
    const next = await this.db.tx(async () => {
      const r = this.moved(await this.existing(accountId, departmentId, id), "discard");
      if (r.digest !== req.digest) throw conflict("stale_revision", "This revision is not the content you read: read it again.");
      const discarded: DepartmentRevisionRecord = { ...r, state: "DISCARDED", updatedAt: new Date().toISOString() };
      await this.save(discarded, r);
      await this.audit.record(ctx, { type: "policy.discarded", outcome: "discarded", accountId, data: { revisionId: id, digest: r.digest, departmentId } });
      return discarded;
    });
    this.changed(accountId, departmentId, id);
    return this.viewOf(accountId, departmentId, next);
  }

  // THE OWNER'S CONFIRMATION of a department's revision: the content read, against the department revision read and the
  // company revision read, at the risk acknowledged. The department's publications take turns (its head row is locked);
  // it is checked against the company's delegation in effect NOW, and refused when the company moved since it was read.
  async publish(ctx: GovernanceContext, departmentId: string, id: string, body: unknown): Promise<DepartmentRevisionView> {
    const accountId = await this.owner(ctx, "publish a department policy");
    const req = accepted(checkPublishDepartmentRevision(body));
    const next = await this.db.tx(async () => {
      await this.departmentName(accountId, departmentId, true);
      await this.revisions.lockHead(accountId, departmentId);
      const r = this.moved(await this.existing(accountId, departmentId, id), "publish");
      const company = await this.refuseInvalid(accountId, departmentId, r);
      const effective = await this.revisions.effective(accountId, departmentId);
      const risk = this.impactAgainst(company.constitution, r, effective)?.risk ?? "high";
      const refusal = confirmationRefusal({ actorType: auditPrincipalOf(ctx.principal).principalType, risk, acknowledgedRisk: req.acknowledgedRisk, readDigest: req.digest, digest: r.digest, readBase: req.base, base: effective?.id ?? null, readCompanyBase: req.companyBase, companyBase: company.record.id });
      if (refusal !== null) {
        const said = REFUSALS[refusal] ?? { status: HttpStatus.FORBIDDEN, code: "not_a_person", message: "Only the account's owner confirms a publication." };
        throw new ApiError(said.status, said.code, said.message, { risk, base: effective?.id ?? null, companyBase: company.record.id });
      }
      const at = new Date().toISOString();
      const who = labelOf(ctx.principal);
      if (effective !== null) await this.save({ ...effective, state: "SUPERSEDED", supersededAt: at, updatedAt: at }, effective);
      const published: DepartmentRevisionRecord = {
        ...r,
        state: "PUBLISHED",
        revision: await this.revisions.nextNumber(accountId, departmentId),
        risk,
        confirmedDigest: r.digest,
        confirmedBase: effective?.id ?? null,
        confirmedCompanyBase: company.record.id,
        confirmedRisk: risk,
        confirmedBy: who,
        confirmedAt: at,
        publishedAt: at,
        publishedBy: who,
        updatedAt: at,
      };
      await this.save(published, r);
      await this.audit.record(ctx, { type: "policy.confirmed", outcome: "confirmed", accountId, data: { revisionId: id, digest: r.digest, base: effective?.id ?? null, risk, departmentId, companyBase: company.record.id } });
      await this.audit.record(ctx, { type: "policy.published", outcome: "published", accountId, data: { revisionId: id, revision: published.revision, digest: r.digest, replaces: effective?.id ?? null, risk, departmentId, companyBase: company.record.id } });
      return published;
    });
    this.changed(accountId, departmentId, id);
    // What the department's employees may do changed: live attempts are held to it from now on.
    this.db.afterCommit(() => this.hooks.changed(accountId, { departmentId }));
    return this.viewOf(accountId, departmentId, next);
  }

  // ---- asking without deciding anything ---------------------------------------------------------------------------------

  // What the company's policy in effect and this department's revision (a draft, or the one in effect) would decide for
  // one of its employees: the same evaluate() every decision uses. Nothing is recorded.
  async simulate(accountId: string, departmentId: string, body: unknown): Promise<SimulateResult> {
    const req = accepted(checkSimulate(body));
    const company = await this.policy.effective(accountId);
    const record = req.revisionId !== undefined ? await this.existing(accountId, departmentId, req.revisionId) : await this.revisions.effective(accountId, departmentId);
    const dept = record === null ? null : this.documentOf(record);
    const request: GovernanceRequest = { ...req.request, principalId: "simulation", accountId, principalType: "agent", runKind: "assignment", departmentId };
    const evaluation = evaluate({ constitution: company?.constitution ?? null, overlays: await this.policy.overrideList(accountId), departments: dept === null ? [] : [dept] }, request);
    return { revisionId: record?.id ?? null, revision: record?.revision ?? null, evaluation };
  }

  // ---- the rules a revision is held to ---------------------------------------------------------------------------------

  // Its shape, its account and department, and -- against the company's policy in effect -- its delegation. Refused with
  // what is wrong; the company's policy in effect is returned for the caller.
  private async refuseInvalid(accountId: string, departmentId: string, r: DepartmentRevisionRecord): Promise<{ record: { id: string }; constitution: Constitution }> {
    const company = await this.policy.effective(accountId);
    if (company === null) throw new ApiError(HttpStatus.CONFLICT, "governance_not_ready", "The company has no policy in effect: a department's policy is read against it.");
    const errors = this.errorsOf(accountId, departmentId, r, company.constitution);
    if (errors.shape.length > 0) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, "invalid_policy", `This draft is not a valid department policy: ${errors.shape.join("; ")}`, { errors: errors.shape });
    if (errors.delegation.length > 0) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, "exceeds_delegation", `This draft goes beyond what the company lets the department decide: ${errors.delegation.join("; ")}`, { errors: errors.delegation });
    return company;
  }

  private errorsOf(accountId: string, departmentId: string, r: DepartmentRevisionRecord, company: Constitution | null): { shape: string[]; delegation: string[] } {
    const checked = checkDepartmentPolicy(parsed(r.document));
    if (!checked.ok) return { shape: checked.errors, delegation: [] };
    const shape = [
      ...(checked.value.metadata.accountId === accountId ? [] : [`metadata.accountId must be this account's id, ${accountId}`]),
      ...(checked.value.metadata.departmentId === departmentId ? [] : [`metadata.departmentId must be this department's id, ${departmentId}`]),
    ];
    return { shape, delegation: company === null ? [] : departmentPolicyErrors(checked.value, company) };
  }

  private documentOf(r: DepartmentRevisionRecord): DepartmentPolicy | null {
    const checked = checkDepartmentPolicy(parsed(r.document));
    return checked.ok ? checked.value : null;
  }

  private impactAgainst(company: Constitution, r: DepartmentRevisionRecord, effective: DepartmentRevisionRecord | null): Impact | null {
    const candidate = this.documentOf(r);
    if (candidate === null) return null;
    const base = effective === null || effective.id === r.id ? null : this.documentOf(effective);
    return departmentImpactOf(company, effective?.id === r.id ? candidate : base, candidate);
  }

  private async viewOf(accountId: string, departmentId: string, r: DepartmentRevisionRecord): Promise<DepartmentRevisionView> {
    const company = await this.policy.effective(accountId);
    const effective = await this.revisions.effective(accountId, departmentId);
    const done = r.state === "SUPERSEDED" || r.state === "DISCARDED";
    const errors = this.errorsOf(accountId, departmentId, r, company?.constitution ?? null);
    const doc = this.documentOf(r);
    return {
      ...summaryOf(r),
      document: parsed(r.document),
      errors: [...errors.shape, ...errors.delegation],
      warnings: doc === null ? [] : lintRules(doc.rules, true).filter((w) => w.code !== "OVERLAY_CANNOT_WIDEN"),
      impact: done || company === null ? null : this.impactAgainst(company.constitution, r, effective),
      base: effective === null || effective.id === r.id ? null : effective.id,
      authors: r.authors,
      history: await this.historyOf(accountId, departmentId, r.id),
      departmentId,
      companyBase: company?.record.id ?? null,
    };
  }

  private async historyOf(accountId: string, departmentId: string, id: string): Promise<RevisionStep[]> {
    const events = (await this.auditStore.page(accountId, { limit: 1000, types: Object.keys(STEPS) })).filter((e) => e.data.revisionId === id && e.data.departmentId === departmentId);
    return events.reverse().map((e) => ({ what: STEPS[e.eventType] ?? e.eventType, by: e.principalType === "agent" ? `agent:${e.principalId}` : e.principalType === "system" ? `system:${e.principalId}` : e.principalId, at: e.occurredAt, digest: typeof e.data.digest === "string" ? e.data.digest : null, eventId: e.eventId }));
  }

  private async insert(ctx: GovernanceContext, accountId: string, departmentId: string, document: unknown, source: RevisionSource, basedOn: string | null): Promise<DepartmentRevisionView> {
    const text = canonicalJson(document);
    const at = new Date().toISOString();
    const who = labelOf(ctx.principal);
    const record: DepartmentRevisionRecord = {
      id: `dpr-${randomUUID()}`,
      accountId,
      departmentId,
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
      confirmedCompanyBase: null,
      confirmedRisk: null,
      confirmedBy: null,
      confirmedAt: null,
      publishedAt: null,
      publishedBy: null,
      supersededAt: null,
    };
    await this.db.tx(async () => {
      await this.revisions.insert(record);
      await this.audit.record(ctx, { type: "policy.draft.created", outcome: "draft", accountId, data: { revisionId: record.id, digest: record.digest, source, departmentId, ...(source === "agent" ? { proposedBy: who } : {}) } });
    });
    this.changed(accountId, departmentId, record.id);
    return this.viewOf(accountId, departmentId, record);
  }

  // A policy that inherits everything: what a department starts from.
  private emptyOf(accountId: string, departmentId: string, name: string): DepartmentPolicy {
    return { apiVersion: API_VERSION, kind: DEPARTMENT_POLICY_KIND, metadata: { accountId, departmentId, name: `${name} policy`.slice(0, 120) }, rules: [] };
  }

  // The department's name; not found for another account's or an unknown one (and, when `live`, for an archived one).
  private async departmentName(accountId: string, departmentId: string, live = false): Promise<string> {
    const row = /^[0-9a-f-]{36}$/.test(departmentId) ? await this.db.one("SELECT name, archived_at FROM workforce.departments WHERE account_id = $1 AND id = $2", [accountId, departmentId]) : null;
    if (row === null) throw notFound("Department");
    if (live && row.archived_at !== null) throw conflict("department_archived", "This department is archived: its policy no longer changes.");
    return String(row.name);
  }

  private async existing(accountId: string, departmentId: string, id: string): Promise<DepartmentRevisionRecord> {
    const r = await this.revisions.get(accountId, departmentId, id);
    if (r === null) throw notFound("Revision");
    return r;
  }

  // Refused, and recorded, unless the context is the account's owner: an agent or a service never writes a policy.
  private async owner(ctx: GovernanceContext, what: string): Promise<string> {
    if (ctx.principal.kind === "owner") return ctx.principal.accountId;
    await this.audit.record(ctx, { type: "authz.denied", outcome: "refused", data: { action: "governance.policy.modify", route: what, cause: "not_the_owner" } });
    throw new ApiError(HttpStatus.FORBIDDEN, "owner_required", "Only the account's owner changes a department's policy.");
  }

  private moved(r: DepartmentRevisionRecord, op: LifecycleOp): DepartmentRevisionRecord {
    const m = move(r.state, op);
    if (!m.ok) throw conflict("wrong_state", m.message);
    return r;
  }

  private async save(next: DepartmentRevisionRecord, read: DepartmentRevisionRecord): Promise<void> {
    if (!(await this.revisions.save(next, { state: read.state, digest: read.digest }))) throw conflict("stale_revision", "This revision changed while it was being moved: read it again.");
  }

  private changed(accountId: string, departmentId: string, id: string): void {
    this.bus.publishApp("governance.changed", { area: "policy", id: `${departmentId}:${id}` }, accountAudience(accountId));
  }
}

