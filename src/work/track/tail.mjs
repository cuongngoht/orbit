// A SESSION'S WORKING SET, as the port a work's reader asks (1.8.8): the BOUNDED tail of one session's own file, and the
// sessions that have one. The working set (src/engineering/working-set/) keeps one file per session -- the host's hooks
// append what each tool did, never an argument or a file's contents -- capped at MAX_BYTES, so a tail of the same size
// is the whole file at most and `partial` is true only when the file outgrew it. Nothing is written and nothing is
// created: a directory that is not there is no sessions.
import { join } from "node:path";
import { safeName } from "../../project/paths.mjs";

export const TAIL_BYTES = 256 * 1024;

const FILE = /^[a-f0-9]{16}\.jsonl$/;

const markOf = (name) => name.slice(0, -".jsonl".length);

function tailOf(io, file) {
  const size = io.size(file);
  if (!size) return { text: "", cut: false, partial: false };
  const got = io.readFrom(file, Math.max(0, size - TAIL_BYTES), TAIL_BYTES);
  return got ? { text: got.buffer.toString("utf8"), cut: size > TAIL_BYTES, partial: size > TAIL_BYTES } : null;
}

const mtimeOf = (io, dir) => (name) => io.mtime(join(dir, name)) ?? 0;

const newestFirst = (io, dir) => io.list(dir).filter((n) => FILE.test(n)).sort((a, b) => mtimeOf(io, dir)(b) - mtimeOf(io, dir)(a));

// `source`: the working set's own word for why it may be empty (src/live/session.mjs SOURCES): `ok` when nothing is known to be wrong.
export const workingSetOf = (io, dir, source = "ok") => ({ source, tail: (mark) => (FILE.test(`${mark}.jsonl`) ? tailOf(io, join(dir, `${mark}.jsonl`)) : null), sessions: () => newestFirst(io, dir).map(markOf) });

// Where the hooks keep a checkout's working sets on a machine, for a reader that knows the project's store, the machine's name and
// the checkout's id and nothing else -- Orbit Control, which opens no repository (src/project/repository.mjs `paths` spells the same
// room: runtime/<host>/sessions/<checkout>/working-set; test/work-track-read.test.mjs holds the two equal). A protocol-2 host
// isolates a session's working set in a room of its own, which only that session's commands can name, so Control does not read it.
export const workingSetRoom = (storeRoot, host, checkoutId) => join(storeRoot, "runtime", safeName(host), "sessions", String(checkoutId).slice(0, 16), "working-set");
