// Explicit administration of one owned entry. No automatic installation and no
// changes to another owner's hooks. A receipt is written before publication.
import { dirname, isAbsolute, join } from 'node:path';
import { sha } from '../hash.mjs';
import { Refused } from '../errors.mjs';
import { contained } from '../project/boundary.mjs';
import { withLock } from '../store/lock.mjs';
import { writeAtomic } from '../store/atomic.mjs';
import { readState, writeState } from '../store/control.mjs';
export function inspectSetup(io, target) {
  if (!isAbsolute(target)) throw new Refused('setup target must be absolute');
  contained(dirname(target), target);
  const text = io.read(target) ?? '{}';
  const document = parsedDocument(text);
  return { revision: sha(text), document };
}
export function applySetup(io, rooms, request) {
  const receipt = join(rooms.hosts, 'installations', `${sha(request.target)}.json`);
  io.ensureDir(dirname(request.target));
  return withLock(dirname(request.target), () => applied(io, receipt, request), io);
}
function applied(io, receipt, request) {
  const current = checkedTarget(io, request);
  const previous = current.document[request.key];
  if (previous && !request.replace) throw new Refused('an owned hook entry already exists; explicit replacement is required');
  return published(io, receipt, request, current, previous);
}
function published(io, receipt, request, current, previous) {
  const old = readState(io, receipt, {});
  const doc = { target: request.target, key: request.key, previous: old.target && JSON.stringify(previous) === JSON.stringify(old.installed) ? old.previous : previous, installed: request.entry, state: 'pending' };
  writeState(io, `${receipt}.backup-${io.nowMs()}`, { target: request.target, document: current.document, revision: current.revision });
  writeState(io, receipt, doc);
  return installed(io, receipt, request, current, doc);
}
function installed(io, receipt, request, current, doc) {
  writeAtomic(request.target, `${JSON.stringify({ ...current.document, [request.key]: request.entry }, null, 2)}\n`, io);
  writeState(io, receipt, { ...doc, state: 'installed' });
  return request.entry;
}

export function removeSetup(io, rooms, target, revision) {
  const receipt = join(rooms.hosts, 'installations', `${sha(target)}.json`);
  const owned = readState(io, receipt, {});
  if (owned.unreadable || owned.target !== target) throw new Refused('no readable installation receipt owns this target');
  return withLock(dirname(target), () => removed(io, target, revision, owned), io);
}
function removed(io, target, revision, owned) {
  const current = inspectSetup(io, target);
  if (current.revision !== revision || JSON.stringify(current.document[owned.key]) !== JSON.stringify(owned.installed)) throw new Refused('owned hooks changed; inspect before removing');
  delete current.document[owned.key];
  if (owned.previous) current.document[owned.key] = owned.previous;
  return writeAtomic(target, `${JSON.stringify(current.document, null, 2)}\n`, io);
}

function parsedDocument(text) {
  try {
    const doc = JSON.parse(text);
    if (doc && typeof doc === 'object' && !Array.isArray(doc)) return doc;
  } catch { /* Report no native configuration content. */ }
  throw new Refused('hook configuration must be a JSON object');
}

function checkedTarget(io, request) {
  const current = inspectSetup(io, request.target);
  if (request.conflicts?.(current.document)?.length) throw new Refused('another Orbit hook entry is active in this target; disable it before setup');
  if (current.revision !== request.revision) throw new Refused('hook configuration changed; inspect and render again');
  return current;
}
