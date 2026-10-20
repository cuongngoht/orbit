// Skills and agents this plugin ships, as resources.
//
// ON or OFF is src/project/components.mjs `componentOn` -- the very answer the
// PreToolUse refusal gives -- so a skill the router offers is always one the
// hook lets start, and a switched-off one is never offered as usable. A shipped
// component is always runtime-ready: it is on the disk the plugin runs from.
//
// `context.components()` is what src/resources/plugin.mjs read off the tree;
// `context.env` and `context.plugin` are what the switch is read through.
import { componentOn } from "../../project/components.mjs";
import { resource } from "../model.mjs";

export const componentProvider = (family, kind) => ({
  family,
  list: (context) => context.components().filter((c) => c.kind === kind).map((c) => component(c, context)),
});

function component(c, context) {
  const on = componentOn({ kind: c.kind, name: c.name }, context.env, context.plugin);
  const ready = context.componentReady?.(c) ?? true;
  return resource(c.kind, { ...c.routing, id: c.name, source: "plugin", ownership: "plugin", enabled: on, runtimeReady: ready, available: on && ready, state: !ready ? "unavailable-in-host" : on ? "ready" : "switched-off" });
}

// The skills family is the shipped skills AND this project's generated playbooks (src/skill-factory/), each
// with its own `project:` key -- one family, so nothing that reads the registry keeps a second list. A
// generated row arrives already shaped by the composition root's `projectSkills` thunk; a thunk that throws
// lists none of its own and leaves the shipped skills listed.
function generated(context) {
  try { return (context.projectSkills?.() ?? []).map((row) => resource("skill", row)); }
  catch { return []; }
}

const shippedSkills = componentProvider("skills", "skill");

export const skillProvider = { family: "skills", list: (context) => [...shippedSkills.list(context), ...generated(context)] };
export const agentProvider = componentProvider("agents", "agent");
