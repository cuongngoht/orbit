// A skill's DEPENDENCIES, derived: what it provides, what it needs and can use
// -- capabilities, from catalog/components.json -- and who would provide each
// right now, as the resolver itself would decide (src/routing/explain.mjs).
//
// Nothing here is stored, and nothing maps a skill to a server: the skill names
// capabilities, a server provides them, and this view asks the resolver which
// meets which TODAY. Enable a server, disable one, change a policy, and the
// answer changes with it. A GET: nothing is connected to or started.
import { effectiveResourcesOf, explainNeeds } from "../core.mjs";
import { skillFile } from "./path.mjs";

export async function skillResources(ctx, id) {
  skillFile(ctx, id);
  const caps = await ctx.capabilities();
  const effective = effectiveResourcesOf({ ...ctx.world, capabilities: () => caps });
  const skill = effective.skills.find((s) => s.id === id) ?? { kind: "skill", id, available: false, state: "unknown", routing: { provides: [], needs: [], optional: [], signals: [], requiresSignal: false } };
  return { id, available: skill.available, state: skill.state, provides: skill.routing.provides, needs: explainNeeds(skill, effective) };
}
