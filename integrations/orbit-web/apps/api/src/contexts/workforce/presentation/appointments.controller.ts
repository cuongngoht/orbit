// THE COMPANY'S AUTHORITY (Workforce): its CEO and its departments' managers, and the delegation grants of employees who
// hold no appointment. Every route is the owner's (the session's account; a change carries the session's CSRF token);
// a change of an existing record names the version it was read at (If-Match → 412 when it moved).
//
//   GET   /api/office/appointments                       the incumbents (CEO, managers) and every appointment, newest first
//   POST  /api/office/appointments                       appoint to an empty slot                          → 201
//   GET   /api/office/appointments/:id                   one appointment
//   POST  /api/office/appointments/:id/replace           the next appointee, the incumbent ends `replaced`  (If-Match)
//   POST  /api/office/appointments/:id/suspend           (If-Match)
//   POST  /api/office/appointments/:id/reinstate         (If-Match)
//   POST  /api/office/appointments/:id/revoke            the slot left empty                               (If-Match)
//   GET   /api/employees/:id/delegation-grants           whom an employee may give work to without an appointment
//   POST  /api/employees/:id/delegation-grants           grant it                                          → 201
//   POST  /api/delegation-grants/:id/revoke              (If-Match)
import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Req } from "@nestjs/common";
import type { AppointmentView, AppointmentsView, DelegationGrantView } from "@orbit-web/contracts";
import type { Request } from "express";
import { ownerActor } from "../../shared/application/commands.js";
import { expectedVersion } from "../../shared/presentation/http.js";
import { AppointmentsService } from "../application/appointments.service.js";

@Controller()
export class AppointmentsController {
  constructor(@Inject(AppointmentsService) private readonly appointments: AppointmentsService) {}

  @Get("office/appointments")
  list(): Promise<AppointmentsView> {
    return this.appointments.view(ownerActor().command.orbitId);
  }

  @Post("office/appointments")
  appoint(@Body() body: unknown): Promise<AppointmentView> {
    return this.appointments.appoint(ownerActor(), body);
  }

  @Get("office/appointments/:id")
  one(@Param("id") id: string): Promise<AppointmentView> {
    return this.appointments.one(ownerActor().command.orbitId, id);
  }

  @Post("office/appointments/:id/replace")
  @HttpCode(HttpStatus.OK)
  replace(@Param("id") id: string, @Body() body: unknown, @Req() req: Request): Promise<AppointmentView> {
    return this.appointments.replace(ownerActor(), id, body, expectedVersion(req));
  }

  @Post("office/appointments/:id/suspend")
  @HttpCode(HttpStatus.OK)
  suspend(@Param("id") id: string, @Body() body: unknown, @Req() req: Request): Promise<AppointmentView> {
    return this.appointments.change(ownerActor(), id, "suspend", body, expectedVersion(req));
  }

  @Post("office/appointments/:id/reinstate")
  @HttpCode(HttpStatus.OK)
  reinstate(@Param("id") id: string, @Body() body: unknown, @Req() req: Request): Promise<AppointmentView> {
    return this.appointments.change(ownerActor(), id, "reinstate", body, expectedVersion(req));
  }

  @Post("office/appointments/:id/revoke")
  @HttpCode(HttpStatus.OK)
  revoke(@Param("id") id: string, @Body() body: unknown, @Req() req: Request): Promise<AppointmentView> {
    return this.appointments.change(ownerActor(), id, "revoke", body, expectedVersion(req));
  }

  @Get("employees/:id/delegation-grants")
  grants(@Param("id") id: string): Promise<DelegationGrantView[]> {
    return this.appointments.grants(ownerActor().command.orbitId, id);
  }

  @Post("employees/:id/delegation-grants")
  grant(@Param("id") id: string, @Body() body: unknown): Promise<DelegationGrantView> {
    return this.appointments.grantDelegation(ownerActor(), id, body);
  }

  @Post("delegation-grants/:id/revoke")
  @HttpCode(HttpStatus.OK)
  async revokeGrant(@Param("id") id: string, @Req() req: Request): Promise<{ ok: true }> {
    await this.appointments.revokeDelegation(ownerActor(), id, expectedVersion(req));
    return { ok: true };
  }
}
