// THE AUDIT RECORD, read:
//
//   GET  /api/governance/audit?before=<seq>&limit=<n>&type=<t>[,<t>]   audit.read, newest first
//   GET  /api/governance/audit/:eventId                                audit.read
//   POST /api/governance/audit/verify                                   audit.verify -- the chain checked whole, and
//                                                                       the check itself recorded
//
// Nothing here writes a record of its own choosing, and no route changes or removes one: there is no such route.
import { Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from "@nestjs/common";
import { isAuditEventType, type AuditEvent } from "@orbit-web/governance-core";
import type { AuditPage, ChainVerification } from "@orbit-web/contracts";
import type { Request } from "express";
import { badRequest, notFound } from "../../common/errors.js";
import { AuditStore } from "../../infra/governance/stores.js";
import { AuditService } from "./audit.service.js";
import { RequirePermission } from "./decorators.js";
import { PrincipalResolver } from "./principals.js";

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
  @RequirePermission("audit.read")
  page(@Query("before") before?: string, @Query("limit") limit?: string, @Query("type") type?: string): AuditPage {
    const q = pageQuery(before, limit, type);
    const events = this.store.page(q);
    const last = events.at(-1);
    return { events, next: events.length === q.limit && last !== undefined && last.seq > 1 ? last.seq : null, head: this.store.head() };
  }

  @Post("verify")
  @RequirePermission("audit.verify")
  @HttpCode(200)
  verify(@Req() req: Request): ChainVerification {
    return this.audit.verifyAndRecord(this.principals.context(req));
  }

  @Get(":eventId")
  @RequirePermission("audit.read")
  one(@Param("eventId") eventId: string): AuditEvent {
    const event = this.store.get(eventId);
    if (event === null) throw notFound("The audit record");
    return event;
  }
}
