// THE ACCOUNT'S AUDIT RECORD, read by its owner -- its own chain, never another account's, never the deployment's (that
// one is the installation terminal's: cli/governance.ts):
//
//   GET  /api/governance/audit?before=<seq>&limit=<n>&type=<t>[,<t>]   newest first
//   GET  /api/governance/audit/:eventId
//   POST /api/governance/audit/verify                                   the chain checked whole, and the check recorded
//
// Nothing here writes a record of its own choosing, and no route changes or removes one: there is no such route.
import { Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from "@nestjs/common";
import { isAuditEventType, type AuditEvent } from "@orbit-web/governance-core";
import type { AuditPage, ChainVerification } from "@orbit-web/contracts";
import type { Request } from "express";
import { badRequest, notFound } from "../../common/errors.js";
import { viewer } from "../../common/request-scope.js";
import { AuditStore } from "../../infra/governance/stores.js";
import { PrincipalResolver } from "../auth/principals.js";
import { AuditService } from "./audit.service.js";

const MAX_PAGE = 200;

function pageQuery(before: string | undefined, limit: string | undefined, type: string | undefined): { before?: number; limit: number; types: string[] } {
  const b = before === undefined ? undefined : Number(before);
  const l = limit === undefined ? 50 : Number(limit);
  if (b !== undefined && (!Number.isInteger(b) || b < 1)) throw badRequest("before must be a record's seq");
  if (!Number.isInteger(l) || l < 1 || l > MAX_PAGE) throw badRequest(`limit must be 1-${MAX_PAGE}`);
  const types = (type ?? "").split(",").filter((t) => t.length > 0);
  if (!types.every(isAuditEventType)) throw badRequest("type must name audit event types");
  return { ...(b !== undefined ? { before: b } : {}), limit: l, types };
}

@Controller("governance/audit")
export class AuditController {
  constructor(
    @Inject(AuditStore) private readonly store: AuditStore,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PrincipalResolver) private readonly principals: PrincipalResolver,
  ) {}

  @Get()
  async page(@Query("before") before?: string, @Query("limit") limit?: string, @Query("type") type?: string): Promise<AuditPage> {
    const accountId = viewer().accountId;
    const q = pageQuery(before, limit, type);
    const events = await this.store.page(accountId, q);
    const last = events.at(-1);
    return { events, next: events.length === q.limit && last !== undefined && last.seq > 1 ? last.seq : null, head: await this.store.head(accountId) };
  }

  @Post("verify")
  @HttpCode(200)
  verify(@Req() req: Request): Promise<ChainVerification> {
    return this.audit.verifyAndRecord(this.principals.context(req), viewer().accountId);
  }

  @Get(":eventId")
  async one(@Param("eventId") eventId: string): Promise<AuditEvent> {
    const event = await this.store.get(viewer().accountId, eventId);
    if (event === null) throw notFound("The audit record");
    return event;
  }
}
