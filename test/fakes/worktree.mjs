// The working tree of a checkout, in memory -- and able to say what was
// written to it, because the interesting question about the Environment Writer
// is which files it touched and which it left alone.
//
// `files` is what is on disk now. A path ending in `/` in `symlinks` is a link
// (never read, never written through), and `bigger` names a file the real port
// would call too large to be text.
export function fakeWorktree(files = {}, opts = {}) {
  const state = { files: { ...files }, symlinks: new Set(opts.symlinks ?? []), writes: [], reads: 0 };
  return { root: opts.root ?? "/repo", state, ...api(state) };
}

const api = (state) => ({
  read: (rel) => (state.reads++, state.symlinks.has(rel) ? null : state.files[rel] ?? null),
  exists: (rel) => rel in state.files || state.symlinks.has(rel) || directory(state, rel),
  list: (rel) => children(state, rel),
  write: (rel, text) => written(state, rel, text),
  edit: (rel, text) => void (state.files[rel] = text),
});

const directory = (state, rel) => Object.keys(state.files).some((p) => p.startsWith(`${rel}/`));

function written(state, rel, text) {
  if (state.symlinks.has(rel)) throw new Error(`${rel} is a symlink; it is not written through`);
  state.writes.push(rel);
  state.files[rel] = text;
  return rel;
}

// Immediate children of a directory, files and directories alike, sorted.
function children(state, rel) {
  const prefix = rel === "." || rel === "" ? "" : `${rel}/`;
  const names = Object.keys(state.files).filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length).split("/")[0]);
  return [...new Set(names)].sort();
}
