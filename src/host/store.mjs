import { join } from 'node:path';
import { readState, writeState } from '../store/control.mjs';
import { withLock } from '../store/lock.mjs';
import { Refused } from '../errors.mjs';
import { validateSettings } from './config.mjs';
const idOf = (id) => /^[a-z][a-z0-9-]{0,47}$/.test(id) ? id : refused();
const refused = () => { throw new Refused('invalid host identity'); };
export function hostStore(rooms, io, id) {
  const dir = join(rooms.hosts, idOf(id));
  return { read: () => readState(io, join(dir, 'settings.json'), { revision: 0, settings: {} }), update: (settings, revision) => locked(dir, io, () => updated(dir, io, settings, revision)), observe: (observation) => locked(dir, io, () => observed(dir, io, observation)), status: () => readState(io, join(dir, 'observed.json'), { observedAt: null }) };
}
function locked(dir, io, fn) {
  io.ensureDir(dir);
  return withLock(dir, fn, { ...io, backoff: [5, 10, 20] });
}
function updated(dir, io, settings, revision) {
  const file = join(dir, 'settings.json');
  const current = readState(io, file, { revision: 0 });
  if (current.revision !== revision) throw new Refused('host settings changed; read the current revision');
  writeState(io, file, { revision: revision + 1, settings: validateSettings(settings) });
  return revision + 1;
}
// `root` is where the host last loaded this plugin from -- what a host's status line command, which no plugin
// variable reaches, needs to find the installed engine. Re-derived by the host's own hook on every session start
// and verified on every use, never trusted as a receipt; an observation that does not carry one keeps the last.
function observed(dir, io, observation) {
  const before = readState(io, join(dir, 'observed.json'), {});
  const kept = { observedAt: io.now(), protocol: observation.protocol, version: observation.version, engineVersion: observation.engineVersion, event: observation.event, root: observation.root ?? before.root ?? null };
  return writeState(io, join(dir, 'observed.json'), kept);
}
