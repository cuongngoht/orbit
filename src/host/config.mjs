import { switchOf } from '../project/env.mjs';
import { Refused } from '../errors.mjs';
// `live`: Orbit Live for this host -- the status line it shows and the session mark its shell commands carry,
// so a viewer can tell this session's task from another's (src/live/association.mjs).
// `engineering_observe`: on by default since 1.8.9 -- the observer runs at a milestone only, bounded per session,
// and proposes nothing stronger than "observed"; a person turns it off here or with ORBIT_ENGINEERING_OBSERVE=off.
export const DEFAULTS = { trace: true, working_set: true, engineering_observe: true, prompt_router: true, host_memory: true, live: true };
export const validSetting = (key) => Object.hasOwn(DEFAULTS, key) || /^(skill|agent)_[a-z0-9_]+$/.test(key);
export function validateSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Refused('host settings must be an object');
  for (const [key, value] of Object.entries(settings)) if (!validSetting(key) || typeof value !== 'boolean') throw new Refused('invalid host setting');
  return settings;
}
export function effectiveSettings(env, desired = {}) {
  const keys = [...new Set([...Object.keys(DEFAULTS), ...Object.keys(desired)])];
  return Object.fromEntries(keys.map((key) => [key, switchOf(env, key.toUpperCase(), key, desired[key] ?? DEFAULTS[key] ?? true)]));
}
