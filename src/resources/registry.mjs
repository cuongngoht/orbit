// The EFFECTIVE RESOURCE REGISTRY: every skill, agent, MCP server, CLI tool and
// capability usable here, composed from one provider per family.
//
// It is the only answer to "what can be used right now", and it has exactly two
// readers that must never disagree: the prompt router (cli/router-hook.mjs)
// and Orbit Control (control-server/). Neither reads a plugin manifest, a host's
// MCP configuration or a PATH itself -- a provider does, through whatever the
// composition root bound into `context`.
//
// A PROVIDER is `{ family, list(context) => resource[] }`, and it is isolated:
// one that throws, or answers something that is not a list, leaves ITS family
// empty and says so in `problems`, while every other family is still answered.
// A router that lost its MCP snapshot must still know its skills.
import { FAMILIES, REGISTRY_VERSION } from "./model.mjs";

export function getEffectiveResources(context, providers) {
  const lists = providers.map((p) => listed(p, context));
  const empty = Object.fromEntries(FAMILIES.map((f) => [f.family, []]));
  return { version: REGISTRY_VERSION, ...empty, ...Object.fromEntries(lists.map((l) => [l.family, l.items])), problems: lists.flatMap((l) => l.problems) };
}

function listed(provider, context) {
  try { return { family: provider.family, items: aList(provider.list(context)), problems: [] }; }
  catch { return { family: provider.family, items: [], problems: [{ family: provider.family, why: "its provider failed, so nothing of this kind is known right now" }] }; }
}

function aList(items) {
  if (!Array.isArray(items)) throw new TypeError("a provider answers a list");
  return items;
}

// Every resource of every family, in reading order.
export const everyResource = (effective) => FAMILIES.flatMap((f) => effective?.[f.family] ?? []);

// Per family: how many there are, how many somebody wants, how many are usable,
// and how many the resolver may consider.
export function summarize(effective) {
  return FAMILIES.map((f) => counted(f, effective?.[f.family] ?? []));
}

const counted = (f, items) => ({ family: f.family, total: items.length, enabled: items.filter((r) => r.enabled).length, available: items.filter((r) => r.available).length, eligible: items.filter((r) => r.eligible).length });
