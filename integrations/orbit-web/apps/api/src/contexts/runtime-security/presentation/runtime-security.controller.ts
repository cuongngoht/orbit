// RUNTIME SECURITY, OF THE SESSION'S ACCOUNT ONLY (ADR 0063) -- the account comes from the session, never a body or a URL:
//
//   GET  /api/governance/runtime-security                       the summary: mode configured and in effect, the host,
//                                                               what holds the running attempts, incidents, 24 h counts
//   GET  /api/governance/runtime-security/host                  the host's probe and its sensor
//   GET  /api/governance/runtime-security/workloads[?employee=&live=1]
//   GET  /api/governance/runtime-security/events[?run=&employee=&kind=&outcome=&severity=&since=&before=&limit=]
//   GET  /api/governance/runtime-security/incidents[?open=1&employee=]
//   GET  /api/governance/runtime-security/incidents/:id
//   POST /api/governance/runtime-security/incidents/:id/review  { decision, note } with If-Match: the version read
//   GET  /api/office/employees/:id/runtime-security            one employee's tab
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { EmployeeRuntimeSecurityView, IncidentList, IncidentView, RuntimeEventPage, RuntimeHostView, RuntimeSecurityOverview, RuntimeWorkloadList } from "@orbit-web/contracts";
import type { Request } from "express";
import { viewer } from "../../../common/request-scope.js";
import { PrincipalResolver } from "../../../modules/auth/principals.js";
import { RuntimeSecurityService } from "../application/runtime-security.service.js";

const versionOf = (ifMatch: string | undefined): number | null => {
  const m = /^\s*(?:W\/)?"?(\d+)"?\s*$/.exec(ifMatch ?? "");
  return m === null ? null : Number(m[1]);
};

@Controller()
export class RuntimeSecurityController {
  constructor(
    @Inject(RuntimeSecurityService) private readonly security: RuntimeSecurityService,
    @Inject(PrincipalResolver) private readonly principals: PrincipalResolver,
  ) {}

  @Get("governance/runtime-security")
  overview(): Promise<RuntimeSecurityOverview> {
    return this.security.overview(viewer().accountId);
  }

  @Get("governance/runtime-security/host")
  host(): Promise<RuntimeHostView> {
    return this.security.host();
  }

  @Get("governance/runtime-security/workloads")
  workloads(@Query("employee") employee?: string, @Query("live") live?: string): Promise<RuntimeWorkloadList> {
    return this.security.workloads(viewer().accountId, { employeeId: employee, live: live === "1" });
  }

  @Get("governance/runtime-security/events")
  events(@Query() q: Record<string, string | undefined>): Promise<RuntimeEventPage> {
    return this.security.events(viewer().accountId, q);
  }

  @Get("governance/runtime-security/incidents")
  incidents(@Query("open") open?: string, @Query("employee") employee?: string): Promise<IncidentList> {
    return this.security.incidents(viewer().accountId, { open: open === "1", employeeId: employee });
  }

  @Get("governance/runtime-security/incidents/:id")
  incident(@Param("id") id: string): Promise<IncidentView> {
    return this.security.incident(viewer().accountId, id);
  }

  @Post("governance/runtime-security/incidents/:id/review")
  @HttpCode(200)
  review(@Req() req: Request, @Param("id") id: string, @Body() body: unknown, @Headers("if-match") ifMatch?: string): Promise<IncidentView> {
    return this.security.review(this.principals.context(req), id, body, versionOf(ifMatch));
  }

  @Get("office/employees/:id/runtime-security")
  employee(@Param("id") id: string): Promise<EmployeeRuntimeSecurityView> {
    return this.security.employee(viewer().accountId, id);
  }
}
