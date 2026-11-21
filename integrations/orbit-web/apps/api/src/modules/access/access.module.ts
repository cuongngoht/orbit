// WHO MAY OPEN A CHAT (ownership.service.ts), held on every chat route (session-access.guard.ts, through the global
// gate), and the one place its owner says who else may: GET/PUT /api/sessions/:id/access.
import { Body, Controller, Get, Inject, Module, Param, Put } from "@nestjs/common";
import { checkUpdateAccess, type AccessList } from "@orbit-web/contracts";
import { accepted } from "../../common/errors.js";
import { viewer } from "../../common/request-scope.js";
import { OwnershipService } from "./ownership.service.js";
import { SessionAccessCheck } from "./session-access.guard.js";

@Controller("sessions/:id/access")
export class SessionAccessController {
  constructor(@Inject(OwnershipService) private readonly ownership: OwnershipService) {}

  @Get()
  async list(@Param("id") id: string): Promise<AccessList> {
    const who = viewer();
    return this.ownership.accessList(await this.ownership.require(id, who, "open"), who);
  }

  @Put()
  async update(@Param("id") id: string, @Body() body: unknown): Promise<AccessList> {
    const who = viewer();
    const people = accepted(checkUpdateAccess(body)).people;
    return this.ownership.share(await this.ownership.require(id, who, "owner"), people, who);
  }
}

@Module({
  providers: [OwnershipService, SessionAccessCheck],
  controllers: [SessionAccessController],
  exports: [OwnershipService],
})
export class AccessModule {}
