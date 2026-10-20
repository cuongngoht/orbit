// The PROJECT REGISTRY: which projects and checkouts Orbit knows on this
// machine, and what it last said about each.
//
// A checkout is KNOWN because it was BOUND -- Orbit was deliberately used from
// it, and src/project/repository.mjs wrote `state/checkouts/<id>.json` the
// first time anything was kept for it. That directory is the registry's
// membership, so there is no second list to fall out of step with it, and no
// directory anywhere is ever scanned for repositories: a machine's home folder
// is nobody's business, and Orbit Control opening must cost a directory listing,
// not a crawl.
//
// What a binding cannot say -- a project's name, when a checkout was last seen,
// a line about where it stands -- is kept beside it, one document per project
// (`state/projects/<key>.json`, schema-stamped like every machine document). It
// is a SUMMARY: the words a page shows without touching the checkout. The
// truth about a checkout is its own facts and its own live state, and a
// summary that has gone stale says when it was written.
//
// Both rooms live under <storeBase>, outside every project's store root, so
// they are written with the raw io a composition root holds -- the way tool
// state and connections are -- never with a project's guarded one.
import { basename, join } from "node:path";
import { Refused } from "../errors.mjs";
import { readState, writeState } from "./control.mjs";
import { withLock } from "./lock.mjs";

export const REGISTRY_SCHEMA = 1;

// A forget refused because the directory is there after all: a thing that moved since it was listed.
export const CHECKOUT_PRESENT = "CHECKOUT_PRESENT";

const BINDING_FILE = /\.json$/;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ID = /^[a-f0-9]{16,64}$/;

// `rooms` is src/store/control.mjs `stateRooms(storeBase)`.
export function createRegistry(rooms, io) {
  return { list: () => projectsOf(rooms, io), find: (key, id) => located(projectsOf(rooms, io), key, id), note: (key, id, change) => noted(rooms, io, key, id, change), forget: (key, id) => forgotten(rooms, io, key, id) };
}

function bindingsOf(rooms, io) {
  return io.list(rooms.checkouts).filter((n) => BINDING_FILE.test(n)).map((n) => bindingFrom(n, io.read(join(rooms.checkouts, n)))).filter(Boolean);
}

function bindingFrom(name, text) {
  const doc = parsed(text);
  const id = name.replace(BINDING_FILE, "");
  if (!ID.test(id) || !KEY.test(doc?.key ?? "") || typeof doc?.root !== "string") return null;
  return { id, key: doc.key, root: doc.root };
}

function parsed(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

const docFile = (rooms, key) => join(rooms.projects, `${key}.json`);

const readDoc = (rooms, io, key) => readState(io, docFile(rooms, key), { key, name: null, checkouts: {} }, REGISTRY_SCHEMA);

// Not Map.groupBy: this engine runs on Node 20, which does not have it.
const groupedByKey = (bindings) => bindings.reduce((groups, b) => groups.set(b.key, [...(groups.get(b.key) ?? []), b]), new Map());

function projectsOf(rooms, io) {
  return [...groupedByKey(bindingsOf(rooms, io))].map(([key, bound]) => projectOf(key, bound, readDoc(rooms, io, key), io)).sort(byName);
}

function projectOf(key, bound, doc, io) {
  const checkouts = bound.map((b) => checkoutOf(b, doc.checkouts?.[b.id], io)).sort((a, b) => a.root.localeCompare(b.root));
  return { key, name: doc.name ?? basename(bound[0].root), checkouts };
}

const checkoutOf = (b, kept, io) => ({ id: b.id, root: b.root, exists: io.exists(b.root), host: kept?.host ?? null, lastSeen: kept?.lastSeen ?? null, summary: kept?.summary ?? null });

const byName = (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.key.localeCompare(b.key);

function located(projects, key, id) {
  const project = projects.find((p) => p.key === key) ?? null;
  const checkout = project?.checkouts.find((c) => c.id === id) ?? null;
  return checkout ? { project, checkout } : null;
}

// { name?, host, at, summary? } -> the kept document. A summary is MERGED over
// what was said before, so a command that knows one thing does not erase the
// rest; and the whole write is under one lock because two commands in two
// sessions finish at the same moment more often than anybody expects. A PROJECT's
// name is the first one it was given: two checkouts of one repository are named by
// whichever directory they sit in, and the name must not flip to the other's every
// time the other is the one that last ran something.
function noted(rooms, io, key, id, change) {
  io.ensureDir(rooms.projects);
  return withLock(rooms.projects, () => saved(rooms, io, key, id, change), io, "the project registry is being written by another session");
}

function saved(rooms, io, key, id, change) {
  const doc = readDoc(rooms, io, key);
  const was = doc.checkouts?.[id] ?? {};
  const kept = { ...was, host: change.host ?? was.host ?? null, lastSeen: change.at, summary: { ...was.summary, ...change.summary } };
  const next = { key, name: doc.name ?? change.name ?? null, checkouts: { ...doc.checkouts, [id]: kept } };
  return writeState(io, docFile(rooms, key), next, REGISTRY_SCHEMA);
}

// A PERSON's: a checkout whose directory is gone leaves the list -- its line in the project's
// document, then its binding, and nothing else. What Orbit kept about it in the store stays where it
// is, a second act if anybody wants the space. A checkout that is still there is refused: using
// Orbit from it would bind it again, so forgetting it would only be a lie for a while.
function forgotten(rooms, io, key, id) {
  const found = forgettable(located(projectsOf(rooms, io), key, id), key, id);
  io.ensureDir(rooms.projects);
  withLock(rooms.projects, () => dropped(rooms, io, key, id), io, "the project registry is being written by another session");
  return found;
}

function forgettable(found, key, id) {
  if (!found) throw new Refused(`no checkout ${String(id).slice(0, 12)} of ${key} is known on this machine`);
  if (found.checkout.exists) throw Object.assign(new Refused("its directory is still there, and Orbit would know it again the next time it is used from it: only a checkout whose directory is gone is forgotten"), { code: CHECKOUT_PRESENT });
  return found;
}

// The document first: one from a newer engine refuses the write, and then the binding is still there.
function dropped(rooms, io, key, id) {
  const doc = readDoc(rooms, io, key);
  if (doc.checkouts?.[id] || doc.unreadable) writeState(io, docFile(rooms, key), { ...doc, checkouts: without(doc.checkouts ?? {}, id) }, REGISTRY_SCHEMA);
  io.removeFile(join(rooms.checkouts, `${id}.json`));
}

const without = (map, id) => Object.fromEntries(Object.entries(map).filter(([k]) => k !== id));
