// What an employee may use of the account's connectors and MCP servers: the grants, their page, and the brokers that
// ask GitHub, Azure DevOps and the MCP servers on an employee's behalf (together the Office's CONNECTOR_TOOLS).
import { Module } from "@nestjs/common";
import { ChangesModule } from "../changes/changes.module.js";
import { GovernanceModule } from "../governance/governance.module.js";
import { McpServersModule } from "../mcp-servers/mcp-servers.module.js";
import { SourcesModule } from "../sources/sources.module.js";
import { ConnectorBroker } from "./connector-broker.js";
import { ConnectorWrites } from "./connector-writes.js";
import { EmployeeAccessController } from "./employee-access.controller.js";
import { EmployeeAccessService } from "./employee-access.service.js";
import { EmployeeTools } from "./employee-tools.js";
import { ConnectionGrantStore } from "./grants.store.js";
import { KnowledgeBroker } from "./knowledge-broker.js";
import { MissionRepositoryGrants } from "./mission-repositories.js";
import { RepositoryBundler } from "./repository-bundler.js";

@Module({
  imports: [GovernanceModule, SourcesModule, McpServersModule, ChangesModule],
  providers: [ConnectionGrantStore, EmployeeAccessService, ConnectorBroker, ConnectorWrites, KnowledgeBroker, EmployeeTools, MissionRepositoryGrants, RepositoryBundler],
  controllers: [EmployeeAccessController],
  exports: [EmployeeTools, MissionRepositoryGrants, RepositoryBundler],
})
export class EmployeeAccessModule {}
