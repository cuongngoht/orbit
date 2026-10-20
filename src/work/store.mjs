// WHERE a work lives: one room in the project's machine store, beside the requirements, the
// sources and the knowledge -- and never in a repository.
//
//   <store>/work/<id>/journal.jsonl      append-only: every need, binding, receipt, settling,
//                                        invalidation and checkpoint, in order
//   <store>/work/<id>/.lock              one writer at a time
//
// The journal is APPEND-ONLY and that is the whole guarantee "resume where it stopped" rests
// on: nothing here rewrites or deletes a line, and every view of a work is a fold over the
// file (src/work/model.mjs). A record passes an allow-list per kind and the scrub on the way
// in, so a field nobody declared -- or a token somebody pasted into an objective -- never
// reaches the disk.
//
// A work's id is the requirement's, spelled for work: the same hash as the root's, so
// "continue PBI 4312" finds the work started on it without anything being listed or searched.
import { join } from "node:path";
import { Refused } from "../errors.mjs";
import { contained } from "../project/boundary.mjs";
import { scrubFields } from "../scrub.mjs";
import { checkedId } from "../store/id.mjs";
import { withLock } from "../store/lock.mjs";
import { FREE_TEXT, KINDS, WORK_SCHEMA } from "./vocab.mjs";

export const DIR = "work";
export const JOURNAL = "journal.jsonl";
export const ID_SPEC = { type: "string", pattern: "^w-[0-9a-f]{12}$" };

const BUSY = "another session is writing this work — try again in a moment";

export const workPaths = (root) => ({ root: join(root, DIR) });

// The work started on a requirement: its id is the root's, spelled for work.
export const workOf = (rootId) => `w-${String(rootId).slice("req-".length)}`;

// And back: the requirement a work stands on.
export const rootOf = (workId) => `req-${String(workId).slice("w-".length)}`;

export function createWorks(root, io) {
  const paths = workPaths(root);
  const dirOf = (id) => contained(paths.root, join(paths.root, checkedId(id, ID_SPEC)));
  return { root, paths, host: io.host, dirOf, append: (id, kind, record) => appended(io, dirOf(id), kind, record), read: (id) => readJournal(io, dirOf(id)), exists: (id) => io.exists(join(dirOf(id), JOURNAL)), stamp: (id) => io.mtime(join(dirOf(id), JOURNAL)), list: () => listed(io, paths), create: (meta) => created(io, dirOf, meta), byRoot: (rootId) => byRoot(io, dirOf, rootId), transact: (id, fn) => transact(io, dirOf(id), fn) };
}

// A work is written one writer at a time: ids inside it are counted, and two writers
// counting at once would hand out the same one.
function transact(io, dir, fn) {
  io.ensureDir(dir);
  return withLock(dir, fn, io, BUSY);
}

// A process killed mid-append leaves a line with no end. Appending straight after it would
// glue the next record onto the fragment, and the tolerant reader below would drop BOTH --
// so a torn tail is ended first: the fragment stays unreadable, everything after it survives.
function tornTail(io, file) {
  const text = io.read(file);
  return text && !text.endsWith("\n") ? "\n" : "";
}

function appended(io, dir, kind, record) {
  if (!KINDS[kind]) throw new Refused(`a work keeps no "${kind}" record — it keeps ${Object.keys(KINDS).join(", ")}`);
  const kept = scrubFields(Object.fromEntries(KINDS[kind].filter((k) => record[k] !== undefined).map((k) => [k, record[k]])), FREE_TEXT);
  io.append(join(dir, JOURNAL), `${tornTail(io, join(dir, JOURNAL))}${JSON.stringify({ at: record.at ?? io.now(), ...kept, kind })}\n`);
  return { kind, ...kept };
}

const parsedLine = (line) => {
  try { return JSON.parse(line); }
  catch { return null; }
};

// A torn last line is dropped, never fatal -- and a work nobody started is null, not an error.
function readJournal(io, dir) {
  const text = io.read(join(dir, JOURNAL));
  return text === null ? null : text.split(/\r?\n/).filter(Boolean).map(parsedLine).filter(Boolean);
}

function created(io, dirOf, meta) {
  if (!meta?.id) throw new Refused("a work needs an id");
  const dir = dirOf(meta.id);
  io.ensureDir(dir);
  return withLock(dir, () => begun(io, dir, meta), io, BUSY);
}

function begun(io, dir, meta) {
  if (io.exists(join(dir, JOURNAL))) throw new Refused(`work ${meta.id} already exists`);
  return appended(io, dir, "created", { schema: WORK_SCHEMA, ...meta });
}

const byRoot = (io, dirOf, rootId) => {
  const id = workOf(rootId);
  return io.exists(join(dirOf(id), JOURNAL)) ? id : null;
};

const listed = (io, paths) => io.list(paths.root).filter((id) => new RegExp(ID_SPEC.pattern).test(id)).sort();
