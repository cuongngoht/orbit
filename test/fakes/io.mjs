import { sep } from "node:path";
// The filesystem the lesson store talks through, in memory -- and able to fail
// on demand.
//
// Concurrency and crash-safety cannot be tested against a real disk without
// timing games, so `mkdir` can be told to throw EEXIST for the first N calls (a
// second writer holding the lock), `rename` can be told to throw EBUSY (Windows,
// with an indexer holding the file), and `sleep` ticks a fake clock instead of
// waiting. Nothing in the suite sleeps.
const slashed = (path) => String(path).replace(/\\/g, "/");

export function fakeIo(opts = {}) {
  const files = new Map();
  const dirs = new Set();
  const notes = [];
  const state = { mkdirFails: opts.mkdirFails ?? 0, renameFails: opts.renameFails ?? 0, slept: 0, nowMs: opts.nowMs ?? 0 };
  return { files, dirs, notes, state, ...api(files, dirs, notes, state, opts) };
}

const api = (files, dirs, notes, state, opts) => ({
  ...reading(files, dirs, state, opts),
  ...writing(files, dirs, state),
  note: (f) => notes.push(f),
  host: opts.host ?? "laptop-a",
  pid: opts.pid ?? 1234,
  sleep: (ms) => {
    state.slept += ms;
    state.nowMs += ms;
  },
  now: opts.now ?? (() => "2026-09-20T00:00:00.000Z"),
  nowMs: () => state.nowMs,
  backoff: opts.backoff,
  staleMs: opts.staleMs,
});

const reading = (files, dirs, state, opts) => ({
  exists: (p) => files.has(p) || dirs.has(p),
  read: (p) => files.get(p) ?? null,
  mtime: (p) => (dirs.has(p) || files.has(p) ? (opts.mtimes?.[p] ?? state.nowMs) : null),
  size: (p) => (files.has(p) ? Buffer.byteLength(files.get(p)) : null),
  // Either separator names the same directory, as it does on a real Windows disk.
  list: (p) => [...new Set([...files.keys()].filter((f) => slashed(f).startsWith(`${slashed(p)}/`)).map((f) => f.slice(p.length + 1)).filter((n) => !n.includes("/") && !n.includes("\\")))],
  bytes: (p) => (files.has(p) ? Buffer.from(files.get(p)) : null),
  readFrom: (p, offset, max) => (files.has(p) ? sliced(Buffer.from(files.get(p)), offset, max) : null),
  kind: (p) => ((opts.symlinks ?? []).includes(p) ? "symlink" : files.has(p) ? "file" : dirs.has(p) ? "dir" : null),
});

// What src/store/io.mjs readFrom answers: the bytes in the window, where the next read starts, and
// how big the file was when it was read.
const sliced = (b, offset, max) => ((buffer) => ({ buffer, next: offset + buffer.length, size: b.length }))(b.subarray(offset, offset + max));

function writing(files, dirs, state) {
  const write = (p, text) => {
    files.set(p, text);
    return p;
  };
  return { write, writePrivate: (p, text) => writtenPrivate(files, state, write, p, text), ...mutating(files, dirs, state, write) };
}

// What src/store/io.mjs writePrivate does on a disk: a NEW file only its owner reads -- one already there is an
// EEXIST, never overwritten -- remembered in `state.private` so a test can see which files were made that way.
function writtenPrivate(files, state, write, p, text) {
  if (files.has(p)) throw Object.assign(new Error("EEXIST"), { code: "EEXIST" });
  (state.private ??= new Set()).add(p);
  return write(p, text);
}

const mutating = (files, dirs, state, write) => ({
  append: (p, text) => write(p, `${files.get(p) ?? ""}${text}`),
  mkdir: (p) => made(dirs, state, p),
  ensureDir: (p) => dirs.add(p),
  // What src/store/io.mjs ensurePrivateDir does: the directory exists, and a test can see it was made private.
  ensurePrivateDir: (p) => (state.privateDirs ??= new Set()).add(p) && dirs.add(p) && p,
  copy: (a, b) => write(b, files.get(a) ?? ""),
  rename: (a, b) => moved(files, dirs, state, a, b),
  remove: (p) => dropped(files, dirs, p),
  removeFile: (p) => files.delete(p),
});

function made(dirs, state, p) {
  if (state.mkdirFails-- > 0) throw Object.assign(new Error("EEXIST"), { code: "EEXIST" });
  if (dirs.has(p)) throw Object.assign(new Error("EEXIST"), { code: "EEXIST" });
  dirs.add(p);
}

// A file, or a directory with everything under it -- a rename moves both. A
// directory cannot be renamed onto one that exists, as on a real disk.
// A child of p on this platform's disk: `/` everywhere, and `\\` on Windows,
// where the engine's join() builds every path the fake is asked about.
const under = (k, p) => k === p || k.startsWith(`${p}/`) || k.startsWith(`${p}${sep}`);

function moved(files, dirs, state, a, b) {
  if (state.renameFails-- > 0) throw Object.assign(new Error("EBUSY"), { code: "EBUSY" });
  if (dirs.has(a) && dirs.has(b)) throw Object.assign(new Error("ENOTEMPTY"), { code: "ENOTEMPTY" });
  for (const d of [...dirs].filter((k) => under(k, a))) movedDir(dirs, d, b + d.slice(a.length));
  for (const f of [...files.keys()].filter((k) => under(k, a))) files.set(b + f.slice(a.length), files.get(f));
  for (const f of [...files.keys()].filter((k) => under(k, a))) files.delete(f);
}

function movedDir(dirs, from, to) {
  dirs.delete(from);
  dirs.add(to);
}

function dropped(files, dirs, p) {
  dirs.delete(p);
  for (const f of [...files.keys()]) if (under(f, p)) files.delete(f);
}
