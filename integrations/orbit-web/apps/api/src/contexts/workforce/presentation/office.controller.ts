// THE OFFICE's routes (Workforce): the roster, departments, templates and resource presets, hiring, and one employee.
// Every route is the owner's (the session's account; a change carries the session's CSRF token); every change of an
// existing record names the version it was made against (If-Match → 412 when it moved).
//
//   GET   /api/office/roster?department=&q=&status=&cursor=   the office, its departments and employee cards
//   POST  /api/office/setup                                    set up the office (idempotent)
//   POST  /api/office/departments                              create a department
//   PATCH /api/office/departments/:id                          rename / reorder              (If-Match)
//   POST  /api/office/departments/:id/archive                  archive, moving its members   (If-Match)
//   GET   /api/office/templates                                employee templates
//   GET   /api/office/resource-presets                         resource presets (suggestions)
//   GET   /api/office/resources                                capacity, budget, reservations, storage, attempts
//   PATCH /api/office/resources/budget                         lower (or restore) the budget (If-Match)
//   POST  /api/office/resources/capacity/check                 Re-check: the host's capacity read again now
//   POST  /api/employees                                       hire                          → EmployeeDetail (201)
//   GET   /api/employees/:id                                   one employee in full
//   GET   /api/employees/:id/revisions/:revision               a profile revision (to restore from)
//   PATCH /api/employees/:id                                   a new profile revision        (If-Match)
//   PATCH /api/employees/:id/resources                         a new resource revision       (If-Match)
//   POST  /api/employees/:id/department                        move to a department          (If-Match)
//   POST  /api/employees/:id/employment                        probation, activate, suspend… (If-Match)
//   GET   /api/office/desks                                    Governance → Employee desks: who left, what desk each holds
import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { checkUpdateBudget, type Department, type EmployeeDeskList, type EmployeeDetail, type EmployeeProfile, type EmployeeTemplate, type Office, type ResourcePreset, type ResourceSummary, type Roster } from "@orbit-web/contracts";
import type { Request } from "express";
import { accepted } from "../../../common/errors.js";
import { ResourcesService } from "../../execution/application/resources.service.js";
import { OfficeGovernance, ownerActor } from "../../shared/application/commands.js";
import { expectedVersion } from "../../shared/presentation/http.js";
import { Outbox } from "../../shared/infrastructure/outbox.js";
import { EmployeeQueries } from "../application/employee.queries.js";
import { HiringService } from "../application/hiring.service.js";
import { OfficeService } from "../application/office.service.js";

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 && v.length <= 200 ? v : undefined);

@Controller()
export class OfficeController {
  constructor(
    @Inject(OfficeService) private readonly office: OfficeService,
    @Inject(HiringService) private readonly hiring: HiringService,
    @Inject(EmployeeQueries) private readonly employees: EmployeeQueries,
    @Inject(ResourcesService) private readonly resources: ResourcesService,
    @Inject(OfficeGovernance) private readonly governance: OfficeGovernance,
    @Inject(Outbox) private readonly outbox: Outbox,
  ) {}

  @Get("office/roster")
  roster(@Query() q: Record<string, unknown>): Promise<Roster> {
    return this.office.roster(ownerActor().command.orbitId, { department: str(q.department), q: str(q.q), status: str(q.status), cursor: str(q.cursor) });
  }

  @Post("office/setup")
  @HttpCode(HttpStatus.OK)
  setUp(@Body() body: unknown): Promise<Office> {
    return this.office.setUp(ownerActor(), body);
  }

  @Post("office/departments")
  createDepartment(@Body() body: unknown): Promise<Department> {
    return this.office.createDepartment(ownerActor(), body);
  }

  @Patch("office/departments/:id")
  updateDepartment(@Param("id") id: string, @Body() body: unknown, @Req() req: Request): Promise<Department> {
    return this.office.updateDepartment(ownerActor(), id, body, expectedVersion(req));
  }

  @Post("office/departments/:id/archive")
  @HttpCode(HttpStatus.OK)
  archiveDepartment(@Param("id") id: string, @Body() body: unknown, @Req() req: Request): Promise<Department> {
    return this.office.archiveDepartment(ownerActor(), id, body, expectedVersion(req));
  }

  @Get("office/templates")
  templates(): EmployeeTemplate[] {
    ownerActor();
    return this.office.templates();
  }

  @Get("office/resource-presets")
  presets(): ResourcePreset[] {
    ownerActor();
    return this.resources.presets();
  }

  @Get("office/resources")
  summary(): Promise<ResourceSummary> {
    return this.resources.summary(ownerActor().command.orbitId);
  }

  // The owner lowers the account's budget (or restores it up to what the operator authorized -- never above).
  @Patch("office/resources/budget")
  async budget(@Body() body: unknown, @Req() req: Request): Promise<ResourceSummary> {
    const actor = ownerActor();
    const request = accepted(checkUpdateBudget(body));
    const version = expectedVersion(req);
    const orbitId = actor.command.orbitId;
    await this.governance.command(actor, "resources.budget", orbitId, async () => {
      await this.governance.authorize(actor, "office.roster.manage", orbitId, { budget: true });
      const { after } = await this.resources.updateBudget(orbitId, request, version);
      await this.outbox.append(actor.command, [{ type: "BudgetChanged", aggregateType: "budget", aggregateId: orbitId, aggregateVersion: after.version, payload: { cpuMillis: after.cpuMillis, memoryMiB: after.memoryMiB, storageMiB: after.storageMiB, maxConcurrent: after.maxConcurrent } }]);
      await this.outbox.touched(orbitId, ["roster"]);
      await this.governance.recorded(actor, "resources.budget", "budget", orbitId, after.version, `${after.cpuMillis} millicores, ${after.memoryMiB} MiB, ${after.storageMiB} MiB storage, ${after.maxConcurrent} concurrent`);
    });
    return this.resources.summary(orbitId);
  }

  // Re-check: the host's capacity read again now (the sandbox provider's probe), and every budget whose authorization
  // follows the capacity moved with it (resources.service.ts) -- what a restart does, without one.
  @Post("office/resources/capacity/check")
  @HttpCode(200)
  async recheckCapacity(): Promise<ResourceSummary> {
    const actor = ownerActor();
    const orbitId = actor.command.orbitId;
    await this.governance.authorize(actor, "office.roster.manage", orbitId, { capacity: true });
    const { capacity, moved } = await this.resources.recheckCapacity();
    await this.governance.recorded(actor, "resources.capacity.check", "capacity", orbitId, 0, `usable ${capacity.usable.cpuMillis} millicores, ${capacity.usable.memoryMiB} MiB, ${capacity.usable.storageMiB} MiB storage; ${moved} budget(s) followed`);
    await this.outbox.touched(orbitId, ["roster"]);
    return this.resources.summary(orbitId);
  }

  // Governance → Employee desks: every employee who left and the desk it still holds, beside the account's storage.
  @Get("office/desks")
  async desks(): Promise<EmployeeDeskList> {
    const orbitId = ownerActor().command.orbitId;
    const summary = await this.resources.summary(orbitId);
    return { desks: await this.employees.desks(orbitId), storage: { budgetMiB: summary.storage.budgetMiB, committedMiB: summary.storage.committedMiB }, asOf: new Date().toISOString() };
  }

  @Post("employees")
  async hire(@Body() body: unknown): Promise<EmployeeDetail> {
    const actor = ownerActor();
    const id = await this.hiring.hire(actor, body);
    return this.employees.detail(actor.command.orbitId, id);
  }

  @Get("employees/:id")
  employee(@Param("id") id: string): Promise<EmployeeDetail> {
    return this.employees.detail(ownerActor().command.orbitId, id);
  }

  @Get("employees/:id/revisions/:revision")
  revision(@Param("id") id: string, @Param("revision") revision: string): Promise<{ revision: number; profile: EmployeeProfile }> {
    return this.employees.profileRevision(ownerActor().command.orbitId, id, Number(revision));
  }

  @Patch("employees/:id")
  async update(@Param("id") id: string, @Body() body: unknown, @Req() req: Request): Promise<EmployeeDetail> {
    const actor = ownerActor();
    await this.hiring.update(actor, id, body, expectedVersion(req));
    return this.employees.detail(actor.command.orbitId, id);
  }

  @Patch("employees/:id/resources")
  async updateResources(@Param("id") id: string, @Body() body: unknown, @Req() req: Request): Promise<EmployeeDetail> {
    const actor = ownerActor();
    await this.hiring.updateResources(actor, id, body, expectedVersion(req));
    return this.employees.detail(actor.command.orbitId, id);
  }

  @Post("employees/:id/department")
  @HttpCode(HttpStatus.OK)
  async move(@Param("id") id: string, @Body() body: unknown, @Req() req: Request): Promise<EmployeeDetail> {
    const actor = ownerActor();
    await this.hiring.move(actor, id, body, expectedVersion(req));
    return this.employees.detail(actor.command.orbitId, id);
  }

  @Post("employees/:id/employment")
  @HttpCode(HttpStatus.OK)
  async employment(@Param("id") id: string, @Body() body: unknown, @Req() req: Request): Promise<EmployeeDetail> {
    const actor = ownerActor();
    await this.hiring.employment(actor, id, body, expectedVersion(req));
    return this.employees.detail(actor.command.orbitId, id);
  }
}
