// Whether one of this plugin's skills or agents is switched ON -- asked in ONE
// place, because two readers ask it and must never disagree: the PreToolUse
// refusal (src/lifecycle/subscribers/switches.mjs) and the prompt router's view
// of what is usable (src/resources/providers/components.mjs). A router that
// recommended a skill the hook then refused would be two stories about one
// setting.
//
// The key is the component's name inside its kind, `skill_<name>` /
// `agent_<name>`, with the plugin's own prefix dropped, and it reads through
// src/project/env.mjs `switchOf`: an exported ORBIT_<KEY> beats the plugin
// setting, which beats the default. Unset is ON.
import { switchOf } from "./env.mjs";
import { PLUGIN_ID, canonicalSkill, skillSwitchKey } from "./naming.mjs";

const KEY = /^[a-z][a-z0-9_]*$/;
const PLUGINS = new Set([PLUGIN_ID]);

export function switchKey(invokes, plugin) {
  if (!invokes?.name) return null;
  if (!pluginNamespace(String(invokes.name))) return null;
  return mappedOrDerived(invokes, localName(String(invokes.name)));
}

function mappedOrDerived(invokes, local) {
  const mapped = skillSwitchKey(canonicalSkill(local));
  if (mapped) return mapped;
  return derivedKey(invokes.kind, local);
}

function pluginNamespace(name) {
  const [local, namespace] = name.split(":").reverse();
  return namespace === undefined || PLUGINS.has(namespace);
}

function localName(name) {
  return name.split(":").reverse()[0];
}

function derivedKey(kind, local) {
  const resolved = canonicalSkill(local);
  const key = `${kind}_${unprefixed(resolved, PLUGIN_ID)}`.replace(/-/g, "_");
  return KEY.test(key) ? key : null;
}

const unprefixed = (local, plugin) => (local.startsWith(`${plugin}-`) ? local.slice(plugin.length + 1) : local);

// A component this plugin cannot name a switch for is not one it may refuse.
export function componentOn(invokes, env, plugin) {
  const key = switchKey(invokes, plugin);
  return !key || switchOf(env ?? {}, key.toUpperCase(), key, true);
}
