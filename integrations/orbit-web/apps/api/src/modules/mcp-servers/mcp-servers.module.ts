// THE ACCOUNT'S MCP SERVERS: the registry (kept in the account's settings, credentials in the credential store), how
// Orbit Web asks a server (mcp-client.ts), and where it may connect (MCP_ADDRESS_POLICY: the public internet, and the
// internal ranges the installation named).
import { Module } from "@nestjs/common";
import type { AppConfig } from "../../config/config.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { ConnectionsModule } from "../connections/connections.module.js";
import { GovernanceModule } from "../governance/governance.module.js";
import { MCP_ADDRESS_POLICY, mcpAddressPolicy } from "./mcp-client.js";
import { McpRegistry } from "./mcp-registry.js";
import { McpServersController } from "./mcp-servers.controller.js";

@Module({
  imports: [GovernanceModule, ConnectionsModule],
  providers: [McpRegistry, { provide: MCP_ADDRESS_POLICY, useFactory: (config: AppConfig) => mcpAddressPolicy(config.governance.egressPrivateAllow), inject: [APP_CONFIG] }],
  controllers: [McpServersController],
  exports: [McpRegistry],
})
export class McpServersModule {}
