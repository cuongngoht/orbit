// A DEPARTMENT'S POLICY's routes (Governance stays the company's menu; each department's policy is reached from it and
// from the department's page). The owner's alone: an agent's request is refused and recorded by the service.
//
//   GET  /api/governance/departments/:departmentId/policy                       in effect, row by row, and every revision
//   GET  /api/governance/departments/:departmentId/policy/revisions/:id         one revision
//   POST /api/governance/departments/:departmentId/policy/revisions             a draft (a document, `from` a revision, or the one in effect)
//   PUT  /api/governance/departments/:departmentId/policy/revisions/:id         edit a draft ({document, expectedDigest})
//   POST /api/governance/departments/:departmentId/policy/revisions/:id/validate
//   POST /api/governance/departments/:departmentId/policy/revisions/:id/discard  ({digest})
//   POST /api/governance/departments/:departmentId/policy/revisions/:id/publish  ({digest, base, companyBase, acknowledgedRisk})
//   POST /api/governance/departments/:departmentId/policy/simulate               ({request, revisionId?}): nothing recorded
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Req } from "@nestjs/common";
import type { DepartmentPolicyOverview, DepartmentRevisionView, SimulateResult } from "@orbit-web/contracts";
import type { Request } from "express";
import { viewer } from "../../common/request-scope.js";
import { PrincipalResolver } from "../auth/principals.js";
import { DepartmentPoliciesService } from "./department-policies.service.js";

@Controller("governance/departments/:departmentId/policy")
export class DepartmentPoliciesController {
  constructor(
    @Inject(DepartmentPoliciesService) private readonly policies: DepartmentPoliciesService,
    @Inject(PrincipalResolver) private readonly principals: PrincipalResolver,
  ) {}

  @Get()
  overview(@Param("departmentId") departmentId: string): Promise<DepartmentPolicyOverview> {
    return this.policies.overview(viewer().accountId, departmentId);
  }

  @Get("revisions/:id")
  revision(@Param("departmentId") departmentId: string, @Param("id") id: string): Promise<DepartmentRevisionView> {
    return this.policies.view(viewer().accountId, departmentId, id);
  }

  @Post("revisions")
  create(@Req() req: Request, @Param("departmentId") departmentId: string, @Body() body: unknown): Promise<DepartmentRevisionView> {
    return this.policies.create(this.principals.context(req), departmentId, body);
  }

  @Put("revisions/:id")
  update(@Req() req: Request, @Param("departmentId") departmentId: string, @Param("id") id: string, @Body() body: unknown): Promise<DepartmentRevisionView> {
    return this.policies.update(this.principals.context(req), departmentId, id, body);
  }

  @Post("revisions/:id/validate")
  @HttpCode(200)
  validate(@Req() req: Request, @Param("departmentId") departmentId: string, @Param("id") id: string): Promise<DepartmentRevisionView> {
    return this.policies.validate(this.principals.context(req), departmentId, id);
  }

  @Post("revisions/:id/discard")
  @HttpCode(200)
  discard(@Req() req: Request, @Param("departmentId") departmentId: string, @Param("id") id: string, @Body() body: unknown): Promise<DepartmentRevisionView> {
    return this.policies.discard(this.principals.context(req), departmentId, id, body);
  }

  @Post("revisions/:id/publish")
  @HttpCode(200)
  publish(@Req() req: Request, @Param("departmentId") departmentId: string, @Param("id") id: string, @Body() body: unknown): Promise<DepartmentRevisionView> {
    return this.policies.publish(this.principals.context(req), departmentId, id, body);
  }

  @Post("simulate")
  @HttpCode(200)
  simulate(@Param("departmentId") departmentId: string, @Body() body: unknown): Promise<SimulateResult> {
    return this.policies.simulate(viewer().accountId, departmentId, body);
  }
}
