// FINDINGS AND DAILY REPORTS, of the session's account only:
//
//   GET  /api/governance/findings                      worked out from the account's audit record, now
//   POST /api/governance/findings/:id/resolve          { resolution, note }
//   GET  /api/governance/reports
//   GET  /api/governance/reports/:id
//   GET  /api/governance/reports/:id/markdown          the report as text (an export: the account's records alone)
//   POST /api/governance/reports                       { day: YYYY-MM-DD }
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from "@nestjs/common";
import type { FindingList, FindingView, ReportList, ReportView } from "@orbit-web/contracts";
import type { Request, Response } from "express";
import { viewer } from "../../common/request-scope.js";
import { PrincipalResolver } from "../auth/principals.js";
import { FindingsService } from "./findings.service.js";

@Controller("governance")
export class AuditorController {
  constructor(
    @Inject(FindingsService) private readonly findings: FindingsService,
    @Inject(PrincipalResolver) private readonly principals: PrincipalResolver,
  ) {}

  @Get("findings")
  list(): Promise<FindingList> {
    return this.findings.current(viewer().accountId);
  }

  @Post("findings/:id/resolve")
  @HttpCode(200)
  resolve(@Req() req: Request, @Param("id") id: string, @Body() body: unknown): Promise<FindingView> {
    return this.findings.resolve(this.principals.context(req), id, body);
  }

  @Get("reports")
  async reports(): Promise<ReportList> {
    return { reports: await this.findings.reportList(viewer().accountId) };
  }

  @Post("reports")
  generate(@Req() req: Request, @Body() body: unknown): Promise<ReportView> {
    return this.findings.generate(this.principals.context(req), body);
  }

  @Get("reports/:id")
  report(@Param("id") id: string): Promise<ReportView> {
    return this.findings.report(viewer().accountId, id);
  }

  @Get("reports/:id/markdown")
  async markdown(@Param("id") id: string, @Res() res: Response): Promise<void> {
    const view = await this.findings.report(viewer().accountId, id);
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="governance-report-${view.day}.md"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(view.markdown);
  }
}
