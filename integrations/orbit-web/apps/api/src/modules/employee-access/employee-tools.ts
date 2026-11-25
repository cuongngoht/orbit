// WHAT AN EMPLOYEE'S GRANTS OPEN, as one set of tools (CONNECTOR_TOOLS): the account's connectors (GitHub, Azure DevOps)
// and its MCP servers -- each tool answered by the one that owns its name.
import { Inject, Injectable } from "@nestjs/common";
import type { ConnectorTools } from "../../contexts/execution/application/connector-tools.port.js";
import type { ToolAnswer, ToolSpec } from "../../contexts/execution/application/tools.service.js";
import type { GovernanceContext } from "../auth/principal.js";
import { ConnectorBroker } from "./connector-broker.js";
import { KnowledgeBroker } from "./knowledge-broker.js";

@Injectable()
export class EmployeeTools implements ConnectorTools {
  private readonly parts: ConnectorTools[];

  constructor(@Inject(ConnectorBroker) connectors: ConnectorBroker, @Inject(KnowledgeBroker) knowledge: KnowledgeBroker) {
    this.parts = [connectors, knowledge];
  }

  async tools(orbitId: string, employeeId: string): Promise<ToolSpec[]> {
    return (await Promise.all(this.parts.map((p) => p.tools(orbitId, employeeId)))).flat();
  }

  owns(name: string): boolean {
    return this.parts.some((p) => p.owns(name));
  }

  call(ctx: GovernanceContext, orbitId: string, employeeId: string, name: string, args: Record<string, unknown>): Promise<ToolAnswer> {
    const part = this.parts.find((p) => p.owns(name));
    if (part === undefined) return Promise.resolve({ text: `${name} is not a tool of the account's connectors.`, isError: true });
    return part.call(ctx, orbitId, employeeId, name, args);
  }
}
