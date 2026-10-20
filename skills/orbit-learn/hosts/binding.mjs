import { hostSession } from '../../../src/memory/session.mjs';
export function binding(host, id) {
  const session = hostSession(host, id);
  if (!session) return 'Orbit runtime affinity unavailable: native session identity missing.';
  return `For each Orbit shell invocation bind ORBIT_HOST=${host} ORBIT_HOST_PROTOCOL=2 ORBIT_SESSION=${session}. Resolve the plugin root from the actual SKILL.md location; a hook export does not persist into shell tools.`;
}
