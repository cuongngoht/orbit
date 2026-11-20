// WHO MAY OPEN A CHAT (ownership.service.ts), held on every chat route (session-access.guard.ts), and the one place its
// owner says who else may: GET/PUT /api/sessions/:id/access.
import { Body, Controller, Get, Inject, Module, Param, Put } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { checkUpdateAccess, type AccessList } from "@orbit-web/contracts";
import { accepted } from "../../common/errors.js";
import { ClaudeAuthModule } from "../claude-auth/claude-auth.module.js";
import { OwnershipService, requireIdentity } from "./ownership.service.js";
import { SessionAccessGuard } from "./session-access.guard.js";

@Controller("sessions/:id/access")
export class SessionAccessController {
  constructor(@Inject(OwnershipService) private readonly ownership: OwnershipService) {}

  @Get()
  async list(@Param("id") id: string): Promise<AccessList> {
    const identity = await this.ownership.viewer();
    return this.ownership.accessList(this.ownership.require(id, identity, "open"), identity);
  }

  @Put()
  async update(@Param("id") id: string, @Body() body: unknown): Promise<AccessList> {
    const identity = requireIdentity(await this.ownership.viewer());
    const people = accepted(checkUpdateAccess(body)).people;
    return this.ownership.share(this.ownership.require(id, identity, "owner"), people, identity);
  }
}

@Module({
  imports: [ClaudeAuthModule],
  providers: [OwnershipService, { provide: APP_GUARD, useClass: SessionAccessGuard }],
  controllers: [SessionAccessController],
  exports: [OwnershipService],
})
export class AccessModule {}
