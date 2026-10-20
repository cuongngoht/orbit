import { hostStore } from './store.mjs';
import { DEFAULTS, effectiveSettings } from './config.mjs';
export function hostsView(catalog, rooms, io, envFor = () => ({})) {
  return catalog.map((host) => view(host, hostStore(rooms, io, host.id), envFor(host.id)));
}
function view(host, store, env) {
  const settings = store.read();
  const observation = store.status();
  const desired = { ...DEFAULTS, ...settings.settings };
  const effective = effectiveSettings(env, settings.settings);
  return { ...host, installed: 'unknown', configured: 'unknown', observed: Boolean(observation.observedAt), lastObserved: observation.observedAt, version: observation.version ?? null, engineVersion: observation.engineVersion ?? null, desired, effective: { ...effective, host_memory: effective.host_memory && host.capabilities.nativeMemory, prompt_router: effective.prompt_router && host.capabilities.promptRouter }, revision: settings.revision, health: 'unknown', diagnostic: settings.unreadable ?? observation.unreadable ?? null };
}
