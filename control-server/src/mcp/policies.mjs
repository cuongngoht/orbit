// Workflow EXCEPTIONS to MCP policy: for one skill and one capability, allow ·
// approval · deny -- the most specific rule there is (src/policy.mjs). A PUT
// behind the token replaces the whole table, validated first; a resource's own
// policy is set on the resource (PUT /mcp/managed/:id/policy). No roles, no
// users: a capability-first policy with a few named exceptions.
import { setWorkflows } from "../core.mjs";
import { mcpPolicies } from "./read.mjs";
import { manageCtx, operated } from "./view.mjs";

export async function setWorkflowExceptions(ctx, body) {
  await operated("INVALID_POLICY", () => setWorkflows(manageCtx(ctx), body?.workflows));
  return mcpPolicies(ctx);
}
