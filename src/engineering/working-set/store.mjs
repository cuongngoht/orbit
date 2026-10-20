// Where working sets are kept, and the port over them: one append-only file
// per session, in a directory src/project/runtime.mjs `workingSetDir` names.
//
// Appended, never rewritten: PostToolUse hooks run in the background and in
// parallel, and a one-line append is the one write two of them cannot tear.
// A torn line from a killed process is dropped on read and the file survives.
//
// Bounded twice. A session file stops growing at MAX_BYTES and says so once
// (`truncated`), because a runaway loop of tool calls must not become a disk
// problem. And sessions EXPIRE: the first line of a new session prunes every
// file older than TTL_MS. This is temporary memory by design -- what is worth
// keeping becomes an engineering fact, through reconciliation, or it goes.
import { join } from "node:path";
import { short } from "../../hash.mjs";
import { withLock } from "../../store/lock.mjs";

export const MAX_BYTES = 256 * 1024;
export const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function createWorkingSet(dir, io) {
  const fileOf = (session) => join(dir, `${short(String(session), 16)}.jsonl`);
  return { dir, append: (session, line) => coordinated(io, dir, fileOf(session), line), read: (session) => linesOf(io.read(fileOf(session))), latest: () => latest(io, dir) };
}

function coordinated(io, dir, file, line) {
  io.ensureDir(dir);
  return withLock(dir, () => appended(io, dir, file, line), { ...io, backoff: [5, 10, 20, 40, 80, 160, 320] });
}

function appended(io, dir, file, line) {
  if (!io.exists(file)) pruned(io, dir);
  if (line.delivery && linesOf(io.read(file)).some((l) => l.delivery === line.delivery && l.ev === line.ev)) return;
  const size = String(io.read(file) ?? "").length;
  if (size >= MAX_BYTES) return truncatedOnce(io, file);
  io.append(file, `${JSON.stringify(line)}\n`);
}

function truncatedOnce(io, file) {
  if (String(io.read(file)).trimEnd().endsWith('"ev":"truncated"}')) return;
  io.append(file, `${JSON.stringify({ t: io.now(), ev: "truncated" })}\n`);
}

function pruned(io, dir) {
  const old = sessions(io, dir).filter((n) => io.nowMs() - (io.mtime(join(dir, n)) ?? io.nowMs()) > TTL_MS);
  for (const n of old) io.removeFile(join(dir, n));
}

const sessions = (io, dir) => io.list(dir).filter((n) => n.endsWith(".jsonl"));

// The session most recently written to -- what a shell command, which has no
// session of its own, means by "the session I am working in".
function latest(io, dir) {
  const newest = sessions(io, dir).sort((a, b) => (io.mtime(join(dir, b)) ?? 0) - (io.mtime(join(dir, a)) ?? 0))[0];
  return newest ? linesOf(io.read(join(dir, newest))) : [];
}

const linesOf = (text) => String(text ?? "").split("\n").filter(Boolean).map(parsed).filter(Boolean);

function parsed(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
