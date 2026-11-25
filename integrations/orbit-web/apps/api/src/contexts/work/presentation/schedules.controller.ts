// RECURRING WORK's routes (the owner's): schedules, their occurrences, and a person's word on a delivery.
//
//   GET   /api/schedules                         every schedule, with its next runs and its last occurrence
//   POST  /api/schedules                         create one
//   POST  /api/schedules/preview                 { rule } → the next runs it would make
//   PATCH /api/schedules/:id                     a new revision (If-Match), pause or resume
//   GET   /api/schedules/:id/occurrences         what each period came to
//   POST  /api/deliveries/:id/resolve            { outcome: delivered | resend, reason }
import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post, Req } from "@nestjs/common";
import type { DeliveryView, OccurrenceView, ScheduleRun, ScheduleView } from "@orbit-web/contracts";
import type { Request } from "express";
import { ownerActor } from "../../shared/application/commands.js";
import { expectedVersion } from "../../shared/presentation/http.js";
import { DeliveriesService } from "../application/deliveries.service.js";
import { SchedulesService } from "../application/schedules.service.js";

@Controller()
export class SchedulesController {
  constructor(
    @Inject(SchedulesService) private readonly schedules: SchedulesService,
    @Inject(DeliveriesService) private readonly deliveries: DeliveriesService,
  ) {}

  @Get("schedules")
  list(): Promise<ScheduleView[]> {
    return this.schedules.list(ownerActor().command.orbitId);
  }

  @Post("schedules")
  create(@Body() body: unknown): Promise<ScheduleView> {
    return this.schedules.create(ownerActor(), body);
  }

  @Post("schedules/preview")
  @HttpCode(HttpStatus.OK)
  preview(@Body() body: unknown): ScheduleRun[] {
    ownerActor();
    return this.schedules.preview(body);
  }

  @Patch("schedules/:id")
  update(@Param("id") id: string, @Body() body: unknown, @Req() req: Request): Promise<ScheduleView> {
    return this.schedules.update(ownerActor(), id, body, expectedVersion(req));
  }

  @Get("schedules/:id/occurrences")
  occurrences(@Param("id") id: string): Promise<OccurrenceView[]> {
    return this.schedules.occurrences(ownerActor().command.orbitId, id);
  }

  @Post("deliveries/:id/resolve")
  @HttpCode(HttpStatus.OK)
  resolve(@Param("id") id: string, @Body() body: unknown): Promise<DeliveryView> {
    return this.deliveries.resolve(ownerActor(), id, body);
  }
}
