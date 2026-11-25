// GET/PUT /api/employees/:id/access: what an employee may use of the account's connectors (GitHub's and Azure DevOps'
// sign-ins of Settings → Connectors), read and changed by a signed-in person of its account.
import { Body, Controller, Get, Inject, Param, Put } from "@nestjs/common";
import type { EmployeeAccess } from "@orbit-web/contracts";
import { ownerActor } from "../../contexts/shared/application/commands.js";
import { EmployeeAccessService } from "./employee-access.service.js";

@Controller("employees/:id/access")
export class EmployeeAccessController {
  constructor(@Inject(EmployeeAccessService) private readonly access: EmployeeAccessService) {}

  @Get()
  view(@Param("id") id: string): Promise<EmployeeAccess> {
    return this.access.view(ownerActor().command.orbitId, id);
  }

  @Put()
  update(@Param("id") id: string, @Body() body: unknown): Promise<EmployeeAccess> {
    return this.access.update(ownerActor(), id, body);
  }
}
