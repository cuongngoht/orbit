// THE ACCOUNT'S CONNECTORS, AS AN EMPLOYEE'S TOOLS: what an employee was let use of GitHub's and Azure DevOps' sign-ins
// (Settings → Connectors) appears among its tools, and each call is made by Orbit Web with that sign-in -- the sign-in
// never enters the employee's sandbox. The tool door asks this port; the modules that hold the sign-ins answer it.
import type { GovernanceContext } from "../../../modules/auth/principal.js";
import type { ToolAnswer, ToolSpec } from "./tools.service.js";

export const CONNECTOR_TOOLS = Symbol("CONNECTOR_TOOLS");

export interface ConnectorTools {
  // The tools an employee's grants open now (none without one).
  tools(orbitId: string, employeeId: string): Promise<ToolSpec[]>;
  // Whether a tool name is one of these (granted or not: a call of one not granted is refused, saying why).
  owns(name: string): boolean;
  call(ctx: GovernanceContext, orbitId: string, employeeId: string, name: string, args: Record<string, unknown>): Promise<ToolAnswer>;
}
