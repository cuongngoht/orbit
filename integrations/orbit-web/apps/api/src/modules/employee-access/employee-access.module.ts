// What an employee may use of the account's connectors: the grants, their page, and the broker that asks GitHub and
// Azure DevOps on an employee's behalf (bound as the Office's CONNECTOR_TOOLS).
import { Module } from "@nestjs/common";
import { GovernanceModule } from "../governance/governance.module.js";
import { SourcesModule } from "../sources/sources.module.js";
import { ConnectorBroker } from "./connector-broker.js";
import { EmployeeAccessController } from "./employee-access.controller.js";
import { EmployeeAccessService } from "./employee-access.service.js";
import { ConnectionGrantStore } from "./grants.store.js";

@Module({
  imports: [GovernanceModule, SourcesModule],
  providers: [ConnectionGrantStore, EmployeeAccessService, ConnectorBroker],
  controllers: [EmployeeAccessController],
  exports: [ConnectorBroker],
})
export class EmployeeAccessModule {}
