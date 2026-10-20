// WHERE a task lives: one room in the project's machine store, beside the work, the
// requirements and the knowledge -- and never in a repository.
//
//   <store>/tasks/<id>/journal.jsonl     append-only: the task's ONLY state, every line in order
//   <store>/tasks/<id>/.lock             one writer per task at a time
//   <store>/tasks/.lock                  one creator per project at a time, so "one active task
//                                        per work and checkout" is checked and kept in one step
//
// The journal is APPEND-ONLY and every view of a task is a fold over it (src/task/model.mjs):
// nothing here rewrites or deletes a line, and nothing is kept beside it to drift. A record
// passes an allow-list per kind and the scrub on the way in, so a field nobody declared -- or a
// token somebody pasted into an objective -- never reaches the disk. The pattern is
// src/work/store.mjs's, kept as its own copy because a task is not a work.
import { join } from "node:path";
import { Refused } from "../errors.mjs";
import { contained } from "../project/boundary.mjs";
import { scrubFields } from "../scrub.mjs";
import { checkedId } from "../store/id.mjs";
import { withLock } from "../store/lock.mjs";
import { FREE_TEXT, KINDS } from "./vocab.mjs";

export const DIR = "tasks";
export const JOURNAL = "journal.jsonl";
export const ID_SPEC = { type: "string", pattern: "^tsk-[a-f0-9]{12}$" };

const BUSY = "another session is writing this task — try again in a moment";
const CREATING = "another session is starting a task in this project — try again in a moment";

export const taskPaths = (root) => ({ root: join(root, DIR) });

export const isTaskId = (id) => new RegExp(ID_SPEC.pattern).test(String(id ?? ""));

export function createTasks(root, io) {
  const paths = taskPaths(root);
  const dirOf = (id) => contained(paths.root, join(paths.root, checkedId(id, ID_SPEC)));
  return { root, paths, host: io.host, now: () => io.now(), dirOf, ...journalOf(io, dirOf), list: () => listed(io, paths), transact: (id, fn) => locked(io, dirOf(id), fn, BUSY), creating: (fn) => locked(io, paths.root, fn, CREATING) };
}

const journalOf = (io, dirOf) => ({ append: (id, kind, record) => appended(io, dirOf(id), kind, record), begin: (id, record) => begun(io, dirOf(id), record), read: (id) => readJournal(io, dirOf(id)), exists: (id) => io.exists(join(dirOf(id), JOURNAL)), journalFile: (id) => join(dirOf(id), JOURNAL) });

// A task is written one writer at a time: ids inside it are counted, and two writers counting
// at once would hand out the same one.
function locked(io, dir, fn, busy) {
  io.ensureDir(dir);
  return withLock(dir, fn, io, busy);
}

// A process killed mid-append leaves a line with no end. Appending straight after it would glue
// the next record onto the fragment, and the tolerant reader below would drop BOTH -- so a torn
// tail is ended first: the fragment stays unreadable, everything after it survives.
function tornTail(io, file) {
  const text = io.read(file);
  return text && !text.endsWith("\n") ? "\n" : "";
}

// `at` is always the store's own clock: a caller cannot date a line.
function appended(io, dir, kind, record) {
  if (!KINDS[kind]) throw new Refused(`a task keeps no "${kind}" record — it keeps ${Object.keys(KINDS).join(", ")}`);
  const kept = scrubFields(Object.fromEntries(KINDS[kind].fields.filter((k) => record[k] !== undefined).map((k) => [k, record[k]])), FREE_TEXT);
  const line = { at: io.now(), ...kept, kind };
  io.append(join(dir, JOURNAL), `${tornTail(io, join(dir, JOURNAL))}${JSON.stringify(line)}\n`);
  return line;
}

// The first line of a task, written once: a task that already has a journal is refused.
function begun(io, dir, record) {
  if (io.exists(join(dir, JOURNAL))) throw new Refused(`task ${record.id} already exists`);
  io.ensureDir(dir);
  return appended(io, dir, "created", record);
}

const parsedLine = (line) => {
  try { return JSON.parse(line); }
  catch { return null; }
};

// The ONE reading of a journal line: what the whole-file reader keeps, and what a live follower
// keeps (src/store/follow.mjs) -- one definition, so a line's index can never differ between them.
export const journalLine = (line) => ((r) => (r && typeof r === "object" && typeof r.kind === "string" ? r : null))(parsedLine(line));

// A torn or garbled line is dropped, never fatal -- and a task nobody started is null.
function readJournal(io, dir) {
  const text = io.read(join(dir, JOURNAL));
  return text === null ? null : text.split(/\r?\n/).filter(Boolean).map(journalLine).filter(Boolean);
}

const listed = (io, paths) => io.list(paths.root).filter(isTaskId).sort();
