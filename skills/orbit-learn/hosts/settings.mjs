// Native option transport is confined to the host boundary.
import { Refused } from "../../../src/errors.mjs";
import { effectiveSettings } from '../../../src/host/config.mjs';
import { hostStore } from '../../../src/host/store.mjs';
import { stateRooms } from '../../../src/store/control.mjs';
import { storeBase } from '../../../src/project/repository.mjs';
import { realIo } from '../../../src/store/io.mjs';
import { hostSession } from '../../../src/memory/session.mjs';
export function hostEnvironment(env, host) {
  if (host?.protocol !== 2) return env;
  const clean = optionEnvironment(env, host.name);
  const desired = settingsOf(clean, host.name);
  return { ...clean, ...Object.fromEntries(Object.entries(effectiveSettings(clean, desired)).map(([key, value]) => [`ORBIT_${key.toUpperCase()}`, value ? 'on' : 'off'])), ORBIT_HOST: host.name, ORBIT_HOST_PROTOCOL: '2', ORBIT_HOST_MEMORY: 'off' };
}
function settingsOf(env, id) {
  try { return hostStore(stateRooms(storeBase(env)), realIo(), id).read().settings ?? {}; }
  catch { return {}; }
}
export const SUPPORTED = Object.freeze(['claude:1', 'codex:2', 'antigravity:2', 'grok:2']);
export function commandEnvironment(env, argv) {
  const id = onlyFlag(argv, 'host') ?? env.ORBIT_HOST;
  const protocol = onlyFlag(argv, 'protocol') ?? env.ORBIT_HOST_PROTOCOL;
  if (!id && !protocol) return nativeShell(env);
  if (!SUPPORTED.includes(`${id}:${protocol ?? '1'}`)) throw new Refused('unsupported host/protocol selection');
  return hostEnvironment(env, { name: id, protocol: protocol === '2' ? 2 : 1 });
}

// A shell a host hands its own tools that says which session it belongs to (1.8.9). Grok Build's carries
// GROK_SESSION_ID (measured on grok 1.0.62), so a Orbit command its agent runs binds itself to that session -- what
// Claude Code's session environment file does for its shell -- and the agent never has to type a binding. Only when
// nothing named a host: an explicit ORBIT_HOST or --host always wins.
const NATIVE_SHELLS = [{ host: 'grok', session: (env) => env.GROK_SESSION_ID }];
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
function nativeShell(env) {
  const row = NATIVE_SHELLS.find((r) => SESSION_ID.test(r.session(env) ?? ''));
  if (!row) return env;
  return { ...hostEnvironment(env, { name: row.host, protocol: 2 }), ORBIT_SESSION: hostSession(row.host, row.session(env)) };
}
function onlyFlag(argv, name) {
  const values = [...new Set(argv.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3)))];
  if (values.length > 1) throw new Refused('conflicting host/protocol selection');
  return values[0];
}

export const optionEnvironment = (env, host) => host === 'claude' ? env : Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('CLAUDE_PLUGIN_OPTION_')));
