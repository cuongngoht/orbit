// An APPEND-ONLY journal: the only state a mission has. Every view of a mission is a fold over it
// (src/mission/fold.mjs); nothing here rewrites or deletes a line, and nothing is kept beside it to drift.
//
// A record passes an allow-list per kind and the scrub on the way in, so a field nobody declared -- or a token
// somebody pasted into a summary -- never reaches the disk. `at` is always the store's own clock: a caller cannot date
// a line. The pattern is src/task/store.mjs's, kept as its own copy because a mission is not a task.
//
//   createJournal(io, dir, { kinds, freeText, noun, busy })
//     -> { dir, file, exists, read, append(kind, record), begin(kind, record), transact(fn) }
import { join } from "node:path";
import { Refused } from "../../../src/errors.mjs";
import { scrubFields } from "../../../src/scrub.mjs";
import { withLock } from "../../../src/store/lock.mjs";
import { journalLine } from "./line.mjs";
import { oneLine, refused } from "./text.mjs";

export const JOURNAL = "journal.jsonl";

export function createJournal(io, dir, spec) {
  const file = join(dir, JOURNAL);
  return { dir, file, exists: () => io.exists(file), read: () => readJournal(io, file), append: (kind, record) => appended(io, file, spec, kind, record), begin: (kind, record) => begun(io, file, spec, kind, record), transact: (fn) => locked(io, dir, fn, spec.busy) };
}

// One writer at a time: ids inside a journal are counted, and two writers counting at once would hand out one twice.
function locked(io, dir, fn, busy) {
  io.ensureDir(dir);
  return withLock(dir, fn, io, busy);
}

// A process killed mid-append leaves a line with no end; it is ended first, so the next record is not glued onto it.
const tornTail = (io, file) => ((text) => (text && !text.endsWith("\n") ? "\n" : ""))(io.read(file));

const keptOf = (spec, kind, record) => Object.fromEntries(spec.kinds[kind].fields.filter((k) => record?.[k] !== undefined && record?.[k] !== null).map((k) => [k, record[k]]));

const flattened = (kept, spec) => Object.fromEntries(Object.entries(kept).map(([k, v]) => [k, spec.freeText.includes(k) && typeof v === "string" ? oneLine(v) : v]));

function appended(io, file, spec, kind, record) {
  if (!spec.kinds[kind]) throw refused(Refused, "KIND_UNKNOWN", `a ${spec.noun} journal keeps no "${kind}" line`);
  const line = { at: io.now(), ...flattened(scrubFields(keptOf(spec, kind, record), spec.freeText), spec), kind };
  io.append(file, `${tornTail(io, file)}${JSON.stringify(line)}\n`);
  return line;
}

function begun(io, file, spec, kind, record) {
  if (io.exists(file)) throw refused(Refused, "ALREADY_EXISTS", `this ${spec.noun} already has a journal`);
  return appended(io, file, spec, kind, record);
}

function readJournal(io, file) {
  const text = io.read(file);
  return text === null ? null : text.split(/\r?\n/).filter(Boolean).map(journalLine).filter(Boolean);
}
