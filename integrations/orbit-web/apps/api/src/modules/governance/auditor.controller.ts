// FINDINGS AND DAILY REPORTS:
//
//   GET  /api/governance/findings                      findings.read    worked out from the audit record, now
//   POST /api/governance/findings/:id/resolve          findings.manage  { resolution, note }
//   GET  /api/governance/reports                       reports.read
//   GET  /api/governance/reports/:id                   reports.read
//   GET  /api/governance/reports/:id/markdown          reports.read     the report as text
//   POST /api/governance/reports                       reports.generate { day: YYYY-MM-DD }
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from "@nestjs/common";
import type { FindingList, FindingView, ReportList, ReportView } from "@orbit-web/contracts";
import type { Request, Response } from "express";
import { RequirePermission } from "./decorators.js";
import { FindingsService } from "./findings.service.js";
import { PrincipalResolver } from "./principals.js";

@Controller("governance")
export class AuditorController {
  constructor(
    @Inject(FindingsService) private readonly findings: FindingsService,
    @Inject(PrincipalResolver) private readonly principals: PrincipalResolver,
  ) {}

  @Get("findings")
  @RequirePermission("findings.read")
  list(): FindingList {
    return this.findings.current();
  }

  @Post("findings/:id/resolve")
  @RequirePermission("findings.manage")
  @HttpCode(200)
  resolve(@Req() req: Request, @Param("id") id: string, @Body() body: unknown): FindingView {
    return this.findings.resolve(this.principals.context(req), id, body);
  }

  @Get("reports")
  @RequirePermission("reports.read")
  reports(): ReportList {
    return { reports: this.findings.reportList() };
  }

  @Post("reports")
  @RequirePermission("reports.generate")
  generate(@Req() req: Request, @Body() body: unknown): ReportView {
    return this.findings.generate(this.principals.context(req), body);
  }

  @Get("reports/:id")
  @RequirePermission("reports.read")
  report(@Param("id") id: string): ReportView {
    return this.findings.report(id);
  }

  @Get("reports/:id/markdown")
  @RequirePermission("reports.read")
  markdown(@Param("id") id: string, @Res() res: Response): void {
    const view = this.findings.report(id);
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="governance-report-${view.day}.md"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(view.markdown);
  }
}
