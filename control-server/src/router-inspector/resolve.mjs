// The Router Inspector: the Effective Resource Registry as the prompt router
// SEES it, and everything the router would decide for a prompt typed here --
// intent, the requirement graph with every candidate weighed (eligibility,
// policy verdict, why not), what was selected, what needs approval, what is
// blocked or missing, and the order it would use them in.
//
// The view is the router's own -- Orbit's records and the saved host snapshot,
// never a live read -- because an inspector that looked somewhere else than the
// router would be inspecting something else. The prompt is routed in memory
// and dropped: not logged, not stored, not echoed back. Nothing is executed;
// the answer says so.
import { effectiveResourcesOf, formatDecision, route, summarize, TEXT_LIMIT } from "../core.mjs";
import { invalid } from "../errors.mjs";

export async function routerView(ctx) {
  const caps = await ctx.capabilities();
  return effectiveResourcesOf({ ...ctx.world, capabilities: () => caps });
}

export async function routerResources(ctx) {
  const effective = await routerView(ctx);
  return { version: effective.version, summary: summarize(effective), resources: effective, problems: effective.problems };
}

export async function resolvePrompt(ctx, body) {
  const decision = route(promptOf(body), await routerView(ctx));
  return { decision, context: formatDecision(decision, { callVia: "node <plugin>/cli/mcp.mjs call" }), executed: false };
}

function promptOf(body) {
  if (typeof body?.prompt !== "string" || !body.prompt.trim()) throw invalid("INVALID_PROMPT", "send { \"prompt\": \"…\" } with the text to route");
  return body.prompt.slice(0, TEXT_LIMIT);
}
