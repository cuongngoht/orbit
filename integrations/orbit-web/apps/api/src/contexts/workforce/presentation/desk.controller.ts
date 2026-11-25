// GOVERNANCE → EMPLOYEE DESKS, an employee's desk looked into and cleaned up (DeskService). The owner's routes (the
// session's account; a clean carries the session's CSRF token and names the desk's version it was chosen at).
//
//   GET   /api/employees/:id/desk?dir=          one folder of the desk, the biggest first
//   GET   /api/employees/:id/desk/file?path=    a file's first 512 KiB, as text when it is text
//   POST  /api/employees/:id/desk/clean         named paths, everything but the toolbox, the cache   (If-Match: desk version)
import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { DeskCleanResult, DeskFile, DeskTree } from "@orbit-web/contracts";
import type { Request } from "express";
import { ownerActor } from "../../shared/application/commands.js";
import { expectedVersion } from "../../shared/presentation/http.js";
import { DeskService } from "../application/desk.service.js";

@Controller()
export class DeskController {
  constructor(@Inject(DeskService) private readonly desks: DeskService) {}

  @Get("employees/:id/desk")
  tree(@Param("id") id: string, @Query("dir") dir: unknown): Promise<DeskTree> {
    return this.desks.tree(ownerActor(), id, dir);
  }

  @Get("employees/:id/desk/file")
  file(@Param("id") id: string, @Query("path") path: unknown): Promise<DeskFile> {
    return this.desks.file(ownerActor(), id, path);
  }

  @Post("employees/:id/desk/clean")
  @HttpCode(HttpStatus.OK)
  clean(@Param("id") id: string, @Body() body: unknown, @Req() req: Request): Promise<DeskCleanResult> {
    return this.desks.clean(ownerActor(), id, body, expectedVersion(req));
  }
}
