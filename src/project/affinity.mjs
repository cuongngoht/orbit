import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { short } from '../hash.mjs';
import { Refused } from '../errors.mjs';
export function affinityPaths(paths, env) {
  if (env.ORBIT_HOST_PROTOCOL !== '2') return paths;
  if (!/^[a-z][a-z0-9-]*:[a-f0-9]{16}$/.test(env.ORBIT_SESSION ?? '') || !env.ORBIT_SESSION.startsWith(`${env.ORBIT_HOST}:`)) throw new Refused('isolated host commands require ORBIT_SESSION (the hashed session from Orbit)');
  const base = paths.sessionDir ?? join(tmpdir(), `orbit-runtime-${short(paths.root, 12)}`);
  return { ...paths, isolated: true, sessionDir: join(base, 'agents', short(env.ORBIT_SESSION, 24)) };
}
