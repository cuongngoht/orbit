import { join } from "node:path";
import { Refused } from "../errors.mjs";
import { contained } from "../project/boundary.mjs";
import { scrubFields } from "../scrub.mjs";
import { checkedId } from "../store/id.mjs";
import { withLock } from "../store/lock.mjs";
import { FREE_TEXT, GOAL_SCHEMA, KINDS } from "./vocab.mjs";
import { journalLine } from "./journal.mjs";

export const DIR = "goals";
export const JOURNAL = "journal.jsonl";
export const ID_SPEC = { type: "string", pattern: "^goal-[0-9a-f]{12}$" };

const BUSY = "another session is writing this goal — try again in a moment";

export const goalPaths = (root) => ({ root: join(root, DIR) });

export const isGoalId = (id) => new RegExp(ID_SPEC.pattern).test(String(id ?? ""));

export function createGoals(root, io) {
  const paths = goalPaths(root);
  const dirOf = (id) => contained(paths.root, join(paths.root, checkedId(id, ID_SPEC)));
  return { root, paths, host: io.host, now: () => io.now(), dirOf, append: (id, kind, record) => appended(io, dirOf(id), kind, record), begin: (id, record) => begun(io, dirOf(id), record), read: (id) => readJournal(io, dirOf(id)), exists: (id) => io.exists(join(dirOf(id), JOURNAL)), journalFile: (id) => join(dirOf(id), JOURNAL), list: () => listed(io, paths), transact: (id, fn) => locked(io, dirOf(id), fn, BUSY) };
}

function locked(io, dir, fn, busy) {
  io.ensureDir(dir);
  return withLock(dir, fn, io, busy);
}

function tornTail(io, file) {
  const text = io.read(file);
  return text && !text.endsWith("\n") ? "\n" : "";
}

function keptRecord(kind, record) {
  const allowed = KINDS[kind];
  return scrubFields(Object.fromEntries(allowed.filter((k) => record[k] !== undefined).map((k) => [k, record[k]])), FREE_TEXT);
}

function appended(io, dir, kind, record) {
  if (!KINDS[kind]) throw new Refused(`a goal keeps no "${kind}" record — it keeps ${Object.keys(KINDS).join(", ")}`);
  const file = join(dir, JOURNAL);
  const line = { at: io.now(), ...keptRecord(kind, record), kind };
  io.append(file, `${tornTail(io, file)}${JSON.stringify(line)}\n`);
  return line;
}

function begun(io, dir, record) {
  if (io.exists(join(dir, JOURNAL))) throw new Refused(`goal ${record.id} already exists`);
  io.ensureDir(dir);
  return appended(io, dir, "created", record);
}

function readJournal(io, dir) {
  const text = io.read(join(dir, JOURNAL));
  return text === null ? null : text.split(/\r?\n/).filter(Boolean).map(journalLine).filter(Boolean);
}

function listed(io, paths) {
  return io.list(paths.root).filter(isGoalId).sort();
}
