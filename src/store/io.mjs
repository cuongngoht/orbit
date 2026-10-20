// Every filesystem call the lesson store makes, in one injectable object.
//
// The store has to be provably safe when two sessions write at once and when a
// process dies mid-write, and neither is testable against a real disk without
// timing games. So nothing under src/learn/ imports node:fs: it takes an `io` --
// the real one here, and a fake in test/fakes/io.mjs that can be told to fail
// exactly where it matters.
//
// `sleep` is synchronous on purpose. The rest of this engine is synchronous fs,
// and a promise here would turn every caller async for nothing. Atomics.wait on a
// SharedArrayBuffer is the only zero-dependency way to block for a fixed time;
// tests inject a clock tick instead, so the suite never actually waits.
import { appendFileSync, closeSync, copyFileSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { hostname } from "node:os";
import { contained } from "../project/boundary.mjs";

export function sleepSync(ms) {
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, ms);
}

export function realIo(deps = {}) {
  const note = deps.note ?? (() => {});
  const who = { host: deps.host ?? hostname(), pid: deps.pid ?? process.pid, sleep: deps.sleep ?? sleepSync, note };
  return { ...clock(deps), ...readers(), ...writers(), ...who };
}

const clock = (deps) => ({ now: deps.now ?? (() => new Date().toISOString()), nowMs: deps.nowMs ?? Date.now });

// Reading never creates. A project nobody has analysed leaves nothing behind --
// the rule src/memory/index.mjs already follows.
const readers = () => ({
  exists: (p) => existsSync(p),
  read: (p) => (existsSync(p) ? readFileSync(p, "utf8") : null),
  mtime: (p) => (existsSync(p) ? statSync(p).mtimeMs : null),
  // How big a file is, without reading it: an append-only log checks its cap on
  // every event, and reading megabytes to count them would cost more than it keeps.
  size: (p) => (existsSync(p) ? statSync(p).size : null),
  list: (p) => (existsSync(p) ? readdirSync(p) : []),
  // The bytes as they are, for a hash or a copy that must not pass through a
  // text decoding; and what an entry IS, without following a link.
  bytes: (p) => (existsSync(p) ? readFileSync(p) : null),
  kind: (p) => entryKind(p),
  // Bytes from `offset` on, at most `maxBytes`, without reading what came before: a follower
  // (src/store/follow.mjs) reads only what is new. Bytes, not text: a multibyte character can
  // straddle the window, and only whole lines are ever decoded. `size` is the file's size at the
  // moment of the read, so a caller tells "nothing more" (next === size) from "the window was full".
  readFrom: (p, offset, maxBytes) => (existsSync(p) ? rangeOf(p, offset, maxBytes) : null),
});

function rangeOf(path, offset, maxBytes) {
  const fd = openSync(path, "r");
  try { return ranged(fd, fstatSync(fd).size, offset, maxBytes); }
  finally { closeSync(fd); }
}

function ranged(fd, size, offset, maxBytes) {
  const length = Math.max(0, Math.min(maxBytes, size - offset));
  const buffer = Buffer.alloc(length);
  const read = length > 0 ? readSync(fd, buffer, 0, length, offset) : 0;
  return { buffer: buffer.subarray(0, read), next: offset + read, size };
}

const KINDS = [["symlink", (s) => s.isSymbolicLink()], ["dir", (s) => s.isDirectory()], ["file", (s) => s.isFile()], ["other", () => true]];

function entryKind(path) {
  try { return ((s) => KINDS.find(([, is]) => is(s))[0])(lstatSync(path)); }
  catch { return null; }
}

const writers = () => ({
  write: (p, text) => wrote(p, text),
  append: (p, text) => added(p, text),
  mkdir: (p) => mkdirSync(p),
  ensureDir: (p) => mkdirSync(p, { recursive: true }),
  copy: (a, b) => copyFileSync(a, contained(dirname(b), b)),
  rename: (a, b) => renameSync(a, b),
  remove: (p) => rmSync(p, { recursive: true, force: true }),
  removeFile: (p) => rmSync(p, { force: true }),
});

function wrote(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(contained(dirname(path), path), text);
  return path;
}

// One file per machine, appended -- the ledger's trick, for the same reason: two
// testers never write the same line, and reading merges every machine's file.
function added(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(contained(dirname(path), path), text);
  return path;
}
