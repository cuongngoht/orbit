// What an employee may use of the account's connectors and MCP servers: the grants, their page, and the brokers that
// ask GitHub, Azure DevOps and the MCP servers on an employee's behalf (together the Office's CONNECTOR_TOOLS).
import { Module } from "@nestjs/common";
import { GovernanceModule } from "../governance/governance.module.js";
import { McpServersModule } from "../mcp-servers/mcp-servers.module.js";
import { SourcesModule } from "../sources/sources.module.js";
import { ConnectorBroker } from "./connector-broker.js";
import { EmployeeAccessController } from "./employee-access.controller.js";
import { EmployeeAccessService } from "./employee-access.service.js";
import { EmployeeTools } from "./employee-tools.js";
import { ConnectionGrantStore } from "./grants.store.js";
import { KnowledgeBroker } from "./knowledge-broker.js";

@Module({
  imports: [GovernanceModule, SourcesModule, McpServersModule],
  providers: [ConnectionGrantStore, EmployeeAccessService, ConnectorBroker, KnowledgeBroker, EmployeeTools],
  controllers: [EmployeeAccessController],
  exports: [EmployeeTools],
})
export class EmployeeAccessModule {}
