// Binding the machine store to a real directory on a real machine.
//
// Resolving it touches the filesystem and can end in Blocked, so it is asked
// LAZILY and never at startup: src/run/context.mjs holds a thunk, and a command
// that keeps nothing -- `query dsl` printing a table out of two .mjs files --
// never calls it and so cannot be stopped by a read-only home. A run does call
// it, because a run's own evidence lives here now; that is honest, and it is
// better than what it replaces, which was an untyped ENOENT out of mkdirSync.
//
// It answers WHERE and WITH WHAT, and nothing about what is kept there. What
// rooms the store has is each subsystem's own business: src/learn/store.mjs
// names the lessons' layout, src/architecture/store.mjs names architecture's,
// src/memory/store.mjs names the ledger's, and none has to know the others
// exist.
import { accessSync, constants, existsSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { homedir } from "node:os";
import { Blocked, Refused } from "../errors.mjs";
import { realIo } from "./io.mjs";
import { writeAtomic } from "./atomic.mjs";
import { withLock } from "./lock.mjs";
import { STORE_LAYOUT, STORE_FILE } from "../project/paths.mjs";
import { guardedIo } from "./guard.mjs";
import { prepareRepository, repositoryStore } from "./repository.mjs";

export function machineContext(ctx, env = process.env, deps = {}) {
  const sink = { note: () => {} };
  const io = deps.io ?? realIo({ note: (f) => sink.note(f) });
  const found = repositoryStore(ctx.project);
  return writableContext(found, io, sink);
}

// Reads never stamp. The first writer labels the store under a lock, including
// writers bound before that directory existed. Raw IO avoids recursive stamping.
function writableContext(store, io, sink) {
  const target = guardedIo(store.root, io);
  const prepare = () => prepareStore(store, io, target);
  return { store, io: { ...target, ...preparedWriters(target, prepare) }, sink, prepare };
}

// The writers that make a file, each of which labels the store first.
const preparedWriters = (target, prepare) => Object.fromEntries(["write", "append", "writePrivate"].map((name) => [name, (...args) => (prepare(), target[name](...args))]));

function prepareStore(store, raw, target) {
  prepareRepository(store, raw);
  return stampStore(store, target);
}

function stampStore(store, io) {
  const file = join(store.root, STORE_FILE);
  if (io.exists(file)) return;
  io.ensureDir(store.root);
  return withLock(store.root, () => writeStamp(store, file, io), io);
}

function writeStamp(store, file, io) {
  if (io.exists(file)) return;
  return writeAtomic(file, `${JSON.stringify({ layout: STORE_LAYOUT, key: store.key, at: io.now() }, null, 2)}\n`, io, false);
}

// Walked rather than asked of git: a child process spawning git to decide where
// to put a file would be slower and would need git to be installed at all.
export function insideRepo(dir) {
  let at = realPath(nearest(resolvePath(dir)));
  while (dirname(at) !== at) {
    if (existsSync(join(at, ".git"))) return at;
    at = dirname(at);
  }
  return null;
}


const realPath = (p) => (existsSync(p) ? realpathSync(p) : resolvePath(p));

// Can we write there, or make it? Asked of the nearest directory that exists, so
// a store that has never been created is judged on whether it COULD be.
export function writable(dir) {
  const at = nearest(resolvePath(dir));
  try {
    if (!statSync(at).isDirectory()) return false;
    accessSync(at, constants.W_OK);
  } catch {
    return false;
  }
  return true;
}

function nearest(dir) {
  let at = dir;
  while (!existsSync(at) && dirname(at) !== at) at = dirname(at);
  return at;
}
