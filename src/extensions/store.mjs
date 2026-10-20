// WHERE a project's own QC tools live: a room in the machine store, beside the
// lessons and the architecture facts, and OUTSIDE every repository.
//
//   <store-root>/qc-tools/
//     registry.json          what exists, and what is known about each
//     <tool-id>/
//       extension.json       the manifest
//       capability.mjs       …and whatever modules it declares
//       tests/
//
// The store root is ALREADY keyed by project (src/project/repository.mjs appends the
// project key), so project isolation costs nothing here: project A's tools are in
// project A's room and there is no code path that could reach project B's. That
// is the same reasoning that put the ledger here, and it is why this is a room
// rather than a new storage mechanism -- the locks, the atomic writes and the
// containment guard already exist and already work.
//
// What is NOT here is anything a repository would hold. A generated QC tool is
// this plugin's, it churns as a project changes, and it is full of one tenant's
// particulars -- so it obeys the same rule the ledger does: never a working tree,
// not even somewhere gitignored.
import { join } from "node:path";
import { contained } from "../project/boundary.mjs";
import { writeAtomic } from "../store/atomic.mjs";
import { withLock } from "../store/lock.mjs";
import { MANIFEST_FILE } from "./contract.mjs";

export const DIR = "qc-tools";
export const REGISTRY_FILE = "registry.json";

export const qcToolPaths = (root) => ({
  root: join(root, DIR),
  registry: join(root, DIR, REGISTRY_FILE),
});

export function createQcTools(root, io) {
  const paths = qcToolPaths(root);
  const c = { paths, io };
  return { root, paths, dirOf: (id) => dirOf(c, id), manifestOf: (id) => manifestOf(c, id), readManifest: (id) => io.read(manifestOf(c, id)), readFile: (file) => io.read(file), ids: () => ids(c), ...registryApi(c), ...writeApi(c) };
}

// Every path an id can produce is held INSIDE the room, by the same guard the
// draft store uses. An id is a field with a pattern, so "../../.ssh" cannot be
// one -- and this is the belt to those braces, because the id may have been read
// off a registry.json somebody edited by hand.
const dirOf = (c, id) => contained(c.paths.root, join(c.paths.root, String(id)));

const manifestOf = (c, id) => join(dirOf(c, id), MANIFEST_FILE);

// Reading never creates. A project that has generated nothing leaves nothing
// behind -- the rule every other room in this store already follows.
function ids(c) {
  const listed = c.io.list(c.paths.root).filter((n) => c.io.exists(join(c.paths.root, n, MANIFEST_FILE)));
  return listed.sort();
}

const registryApi = (c) => ({
  entries: () => entries(c),
  entry: (id) => entries(c).find((e) => e.id === id) ?? null,
});

// The registry is an INDEX, not the truth: each tool's own extension.json is.
// So an unreadable index costs the index and nothing else, and the loader walks
// the directories regardless -- a tool whose manifest is on disk is loadable
// whether or not anybody remembered to write the index line.
function entries(c) {
  const raw = c.io.read(c.paths.registry);
  try { return raw ? JSON.parse(raw).tools ?? [] : []; }
  catch { return []; }
}

const writeApi = (c) => ({
  save: (id, file, text) => saved(c, id, file, text),
  record: (entry) => record(c, entry),
  remove: (id) => c.io.remove(dirOf(c, id)),
});

function saved(c, id, file, text) {
  const dir = dirOf(c, id);
  c.io.ensureDir(dir);
  return writeAtomic(contained(dir, join(dir, file)), text, c.io);
}

// The room has to EXIST before anything can lock it, and the first tool a
// project ever registers is the call that creates it.
function record(c, entry) {
  c.io.ensureDir(c.paths.root);
  return withLock(c.paths.root, () => recorded(c, entry), c.io);
}

// Under a lock, because two sessions registering two tools at once would
// otherwise each write the index they read. One entry per id, replaced in place,
// so a re-verification updates a row rather than appending a second story.
function recorded(c, entry) {
  const rest = entries(c).filter((e) => e.id !== entry.id);
  const tools = [...rest, entry].sort((a, b) => (a.id < b.id ? -1 : 1));
  return writeAtomic(c.paths.registry, `${JSON.stringify({ tools }, null, 2)}\n`, c.io);
}
