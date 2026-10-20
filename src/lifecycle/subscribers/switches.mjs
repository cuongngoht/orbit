// One switch per skill and per agent this plugin ships, so a person testing the
// plugin can turn any of them off without uninstalling it.
//
// The switches live in the host's plugin settings (`userConfig` in
// .claude-plugin/plugin.json, one boolean each, `skill_<name>` / `agent_<name>`)
// and reach this hook as CLAUDE_PLUGIN_OPTION_<KEY>. The host itself cannot turn
// one plugin skill off, so the refusal happens HERE, on the host's pre-tool
// event, the moment the host is about to start one.
//
// Unset means ON, and that is the whole default rule: a host that
// never sends the options -- an install that has no settings dialog at all --
// runs every skill and agent exactly as before. An exported ORBIT_<KEY> beats the
// setting on one machine, the precedence src/project/env.mjs `switchOf` states.
//
// WHETHER a component is on is src/project/components.mjs `componentOn`, the
// same answer the prompt router reads, so a skill the router offers is a skill
// this hook lets start. What a host's JSON calls the component, and how a
// refusal is spelled back to it, are the host adapter's (`invokes`,
// `formatDeny`). A name in another plugin's namespace is not ours to switch.
import { componentOn, switchKey } from "../../project/components.mjs";

export { switchKey };

export const switches = {
  name: "switches",
  on: ["pre-tool"],
  records: false,
  run: (event, world) => refusal(event.invokes, world),
};

function refusal(invokes, world) {
  if (componentOn(invokes, world.env, world.plugin)) return null;
  const key = switchKey(invokes, world.plugin);
  return world.host.formatDeny?.(reason(invokes, key, world.plugin), world.input) ?? null;
}

const reason = (invokes, key, plugin) =>
  `${invokes.name} is switched off in the ${plugin} plugin's settings (${key}). Turn it back on under /plugin → ${plugin} → Configure options, or export ORBIT_${key.toUpperCase()}=on on this machine.`;
