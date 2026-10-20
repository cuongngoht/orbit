
export const PREFIX = "ORBIT_";

export const varName = (suffix) => PREFIX + suffix;

export function fromEnv(env, suffix) {
  return env[PREFIX + suffix];
}

export function sourceName(env, suffix) {
  if (env[PREFIX + suffix] !== undefined) return PREFIX + suffix;
  return null;
}

export const PLUGIN_OPTION = "CLAUDE_PLUGIN_OPTION_";

const WORDS = { on: true, true: true, 1: true, yes: true, off: false, false: false, 0: false, no: false };

const reading = (value) => WORDS[String(value ?? "").trim().toLowerCase()];

export function switchOf(env, suffix, key, fallback) {
  const orbit = reading(fromEnv(env, suffix));
  if (orbit !== undefined) return orbit;
  const plugin = reading(env[PLUGIN_OPTION + key.toUpperCase()]);
  if (plugin !== undefined) return plugin;
  return fallback;
}
