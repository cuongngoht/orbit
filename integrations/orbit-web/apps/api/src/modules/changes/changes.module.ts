import { Controller, Get, Inject, Module, Param, Query } from "@nestjs/common";
import type { ChangesReport, FileDiff } from "@orbit-web/contracts";
import { ChangesService } from "./changes.service.js";
import { GitGateway } from "./git.gateway.js";

@Controller("sessions/:id/changes")
export class ChangesController {
  constructor(@Inject(ChangesService) private readonly changes: ChangesService) {}

  @Get()
  report(@Param("id") id: string): Promise<ChangesReport> {
    return this.changes.report(id);
  }

  @Get("file")
  file(@Param("id") id: string, @Query("path") path: unknown): Promise<FileDiff> {
    return this.changes.file(id, path);
  }
}

@Module({
  providers: [GitGateway, ChangesService],
  controllers: [ChangesController],
  exports: [GitGateway, ChangesService],
})
export class ChangesModule {}
